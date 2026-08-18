import { z } from 'zod';
import type { ConfigService } from '@nestjs/config';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { isAddress } from 'viem';
import {
  isSolanaChainSlug,
  resolveSolanaRpcUrl,
  type EvmChainSlug,
  type SolanaChainSlug,
} from '../utils/chain-registry.util';
import { parseEvmChainArg, resolveEvmClient } from '../utils/evm-chain.util';
import {
  TRANSFER_CHAIN_ENUM,
  isBiteCapableChain,
  isValidHexData,
  isValidSolanaAddress,
  normalizeEvmRecipient,
  parseHumanAmount,
  resolveEvmToken,
  resolveSolanaToken,
} from '../utils/transfer-chain.util';
import { buildEvmUnsignedTransferTx } from '../utils/evm-transfer-tx.util';
import { buildSolanaUnsignedTransferTx } from '../utils/solana-transfer-tx.util';
import { toToolResult } from '../utils/tool-result.util';
import { createToolLogger, logToolFailure } from '../utils/tool-logging.util';

const TOOL_NAME = 'network.prepare_transfer';
const logger = createToolLogger(TOOL_NAME);

const DESCRIPTION =
  'Build an **unsigned** native or token transfer transaction for a supported chain, from an ' +
  'explicit sender you provide. Free, read-only against the chain (nonce/gas/fees are read ' +
  'live) — this tool never signs, broadcasts, holds a key, or enforces any allowlist/spend ' +
  'limit. This server never binds a caller wallet, so `from` is always required.\n\n' +
  `Supported chains: ${TRANSFER_CHAIN_ENUM.join(', ')}.\n\n` +
  'Token (`token` field):\n' +
  "- Solana: 'SOL' (native, default) or 'USDC'.\n" +
  "- EVM: native symbol (default), 'USDC', 'USDC.e' where configured for the chain, or a raw " +
  '0x contract address (decimals are read live from the contract; `token_decimals` is only a ' +
  'fallback if that read fails).\n\n' +
  "Gas: the sender pays gas in the chain's native token once they sign — this server never " +
  'sponsors it.\n\n' +
  'Raw calldata (EVM only): pass `data` (hex, 0x-prefixed) with `to` as the contract call ' +
  'target and `amount` as the native value to send (use "0" for a pure call).\n\n' +
  'Privacy (`private`, EVM only): requests SKALE BITE encryption, only supported on ' +
  'skale-base-sepolia, where it defaults to true — pass `private: false` there for a plaintext ' +
  'transfer. Rejected on every other chain.';

export function registerPrepareTransferTool(
  server: McpServer,
  configService: ConfigService,
): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Prepare an unsigned transfer transaction',
      description: DESCRIPTION,
      inputSchema: {
        chain: z
          .enum(TRANSFER_CHAIN_ENUM)
          .describe(
            `Destination chain. One of: ${TRANSFER_CHAIN_ENUM.join(', ')}`,
          ),
        from: z
          .string()
          .describe('Sender address (0x for EVM, base58 for Solana).'),
        to: z
          .string()
          .describe('Recipient address (0x for EVM, base58 for Solana).'),
        amount: z
          .string()
          .describe(
            'Amount in human units (e.g. "0.1", "100"). Use "0" for a contract call that sends no native value.',
          ),
        token: z
          .string()
          .optional()
          .describe(
            "Token symbol (native/USDC/USDC.e) or EVM contract address. Omit for the chain's native token.",
          ),
        token_decimals: z
          .number()
          .int()
          .optional()
          .describe(
            'Fallback decimals for an EVM ERC-20 if a live decimals() read fails (default 18).',
          ),
        data: z
          .string()
          .optional()
          .describe(
            'Hex-encoded calldata for a raw EVM contract call (0x-prefixed). Requires `to` as the call target.',
          ),
        private: z
          .boolean()
          .optional()
          .describe(
            'Request BITE privacy encryption. Only valid on skale-base-sepolia (defaults true there); rejected elsewhere.',
          ),
      },
      outputSchema: {
        status: z.string().optional(),
        chain: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        token: z.string().optional(),
        tokenContract: z.string().nullable().optional(),
        amount: z.string().optional(),
        amountAtomic: z.string().optional(),
        decimals: z.number().int().optional(),
        transaction: z.record(z.string(), z.unknown()).optional(),
        execution: z.record(z.string(), z.unknown()).optional(),
        policy: z.record(z.string(), z.unknown()).optional(),
        error: z.string().optional(),
        message: z.string().optional(),
      },
      annotations: {
        title: 'Prepare an unsigned transfer transaction',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      chain,
      from,
      to,
      amount,
      token,
      token_decimals,
      data,
      private: privateFlag,
    }): Promise<CallToolResult> => {
      const result = await execute(
        configService,
        chain,
        from,
        to,
        amount,
        token,
        token_decimals,
        data,
        privateFlag,
      );
      return toToolResult(result);
    },
  );
}

function transferPolicyNote(): Record<string, unknown> {
  return {
    allowlistEnforced: false,
    spendLimitEnforced: false,
    note:
      'This tool only builds and returns an unsigned transaction — it never signs, ' +
      'broadcasts, or enforces any allowlist/spend limit. Enforce those in your own ' +
      'application if required.',
  };
}

export async function execute(
  configService: ConfigService,
  chain: string,
  fromRaw: string,
  toRaw: string,
  amountRaw: string,
  tokenArg: string | undefined,
  tokenDecimalsArg: number | undefined,
  dataArg: string | undefined,
  privateArg: boolean | undefined,
): Promise<Record<string, unknown>> {
  const from = fromRaw.trim();
  const to = toRaw.trim();
  const amount = amountRaw.trim();
  const token = tokenArg?.trim() || null;
  const tokenDecimals =
    typeof tokenDecimalsArg === 'number' && Number.isFinite(tokenDecimalsArg)
      ? tokenDecimalsArg
      : 18;
  const data = dataArg?.trim() || null;
  const wantsPrivateRaw = typeof privateArg === 'boolean' ? privateArg : null;

  if (!from) {
    return { error: 'MISSING_FROM', message: 'from is required.' };
  }
  if (!to) {
    return { error: 'MISSING_RECIPIENT', message: 'to is required.' };
  }
  if (!amount) {
    return { error: 'MISSING_AMOUNT', message: 'amount is required.' };
  }
  if (data && !isValidHexData(data)) {
    return {
      error: 'INVALID_DATA',
      message: 'data must be hex-encoded with a 0x prefix.',
    };
  }
  if (wantsPrivateRaw === true && !isBiteCapableChain(chain)) {
    return {
      error: 'UNSUPPORTED_PRIVACY',
      message: `Private (BITE) transfers are only supported on "skale-base-sepolia". Omit \`private\` or set it false for "${chain}".`,
    };
  }

  try {
    if (isSolanaChainSlug(chain)) {
      if (data) {
        return {
          error: 'UNSUPPORTED_DATA',
          message: 'Raw calldata (data) is not supported on Solana.',
        };
      }
      return await buildSolana(configService, chain, from, to, amount, token);
    }

    const chainResult = parseEvmChainArg(chain);
    if (chainResult.ok === false) {
      return chainResult.error as Record<string, unknown>;
    }

    return await buildEvm(
      configService,
      chainResult.chain as EvmChainSlug,
      from,
      normalizeEvmRecipient(to),
      amount,
      token,
      tokenDecimals,
      data,
      wantsPrivateRaw,
    );
  } catch (err: unknown) {
    const msg = logToolFailure(logger, `${chain} ${from} -> ${to}`, err);
    return { error: 'TRANSFER_BUILD_FAILED', message: msg };
  }
}

async function buildEvm(
  configService: ConfigService,
  chain: EvmChainSlug,
  from: string,
  to: string,
  amountRaw: string,
  tokenArg: string | null,
  tokenDecimalsArg: number,
  dataArg: string | null,
  privateArg: boolean | null,
): Promise<Record<string, unknown>> {
  if (!isAddress(from)) {
    return {
      error: 'INVALID_FROM',
      message: 'EVM from must be 0x + 40 hex chars.',
    };
  }
  if (!isAddress(to)) {
    return {
      error: 'INVALID_RECIPIENT',
      message: 'EVM to must be 0x + 40 hex chars (or a tempox0x… form).',
    };
  }

  const clientResult = resolveEvmClient(configService, chain);
  if (clientResult.ok === false) {
    return clientResult.error as Record<string, unknown>;
  }

  const isCustomCall = !!dataArg && dataArg !== '0x';
  const resolved = isCustomCall
    ? { tokenLabel: 'NATIVE_VALUE', contract: null, decimals: 18 }
    : await resolveEvmToken(
        clientResult.client,
        chain,
        tokenArg,
        tokenDecimalsArg,
      );
  if ('error' in resolved) {
    return { error: resolved.error, message: resolved.message };
  }

  const amountAtomic = parseHumanAmount(amountRaw || '0', resolved.decimals);
  if (!isCustomCall && amountAtomic <= 0n) {
    return {
      error: 'INVALID_AMOUNT',
      message: 'amount must be greater than zero for token transfers.',
    };
  }

  const wantsPrivate = isBiteCapableChain(chain) ? (privateArg ?? true) : false;

  const transaction = await buildEvmUnsignedTransferTx({
    client: clientResult.client,
    rpcUrl: clientResult.rpcUrl,
    intent: {
      chain,
      from,
      to,
      tokenContract: resolved.contract,
      amountAtomic,
      customData: isCustomCall ? dataArg : null,
    },
    encryptWithBite: wantsPrivate,
  });

  return {
    status: 'unsigned_transaction_ready',
    chain,
    from,
    to,
    token: isCustomCall ? 'CUSTOM_CALL' : resolved.tokenLabel,
    tokenContract: resolved.contract,
    amount: amountRaw,
    amountAtomic: amountAtomic.toString(),
    decimals: resolved.decimals,
    transaction,
    execution: {
      hint:
        "Sign this EIP-1559 transaction with the sender's EVM wallet and broadcast via " +
        'eth_sendRawTransaction or your wallet SDK.',
      format: transaction.type,
      gasNote: 'The sender pays gas in the chain native token after signing.',
      ...(wantsPrivate
        ? {
            privacyNote:
              'to/data are BITE-encrypted — sign and broadcast exactly as returned; the real ' +
              'destination and calldata only become visible after finality.',
          }
        : {}),
    },
    policy: transferPolicyNote(),
  };
}

async function buildSolana(
  configService: ConfigService,
  chain: SolanaChainSlug,
  from: string,
  to: string,
  amountRaw: string,
  tokenArg: string | null,
): Promise<Record<string, unknown>> {
  if (!isValidSolanaAddress(from)) {
    return {
      error: 'INVALID_FROM',
      message: 'Solana from must be a valid base58 address.',
    };
  }
  if (!isValidSolanaAddress(to)) {
    return {
      error: 'INVALID_RECIPIENT',
      message: 'Solana to must be a valid base58 address.',
    };
  }

  const resolved = resolveSolanaToken(chain, tokenArg);
  if ('error' in resolved) {
    return { error: resolved.error, message: resolved.message };
  }

  const amountAtomic = parseHumanAmount(amountRaw, resolved.decimals);
  if (amountAtomic <= 0n) {
    return {
      error: 'INVALID_AMOUNT',
      message: 'amount must be greater than zero.',
    };
  }

  const rpcUrl = resolveSolanaRpcUrl(configService, chain);
  const transaction = await buildSolanaUnsignedTransferTx({
    rpcUrl,
    intent: {
      chain,
      from,
      to,
      token: resolved.tokenLabel,
      mint: resolved.mint,
      amount: amountRaw,
      amountAtomic: amountAtomic.toString(),
      decimals: resolved.decimals,
    },
  });

  return {
    status: 'unsigned_transaction_ready',
    chain,
    from,
    to,
    token: resolved.tokenLabel,
    tokenContract: resolved.mint,
    amount: amountRaw,
    amountAtomic: amountAtomic.toString(),
    decimals: resolved.decimals,
    transaction,
    execution: {
      hint:
        "Sign the base64 transaction with the sender's Solana wallet (feePayer) and " +
        'broadcast via sendTransaction.',
      format: transaction.type,
      gasNote: 'The sender pays standard Solana network fees after signing.',
    },
    policy: transferPolicyNote(),
  };
}
