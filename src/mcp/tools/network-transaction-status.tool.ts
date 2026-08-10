import { z } from 'zod';
import type { ConfigService } from '@nestjs/config';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { isHash } from 'viem';
import {
  EVM_CHAIN_SLUGS,
  isSolanaChainSlug,
  resolveSolanaRpcUrl,
  SOLANA_CHAIN_SLUGS,
} from '../utils/chain-registry.util';
import { parseEvmChainArg, resolveEvmClient } from '../utils/evm-chain.util';
import { fetchTransactionInfo } from '../integrations/evm-transaction.integration';
import {
  fetchSolanaTransactionStatus,
  isValidSolanaSignature,
} from '../integrations/solana-transaction.integration';
import { toToolResult } from '../utils/tool-result.util';
import { createToolLogger, logToolFailure } from '../utils/tool-logging.util';

const TOOL_NAME = 'network.transaction_status';
const logger = createToolLogger(TOOL_NAME);
const TX_STATUS_CHAINS = [...SOLANA_CHAIN_SLUGS, ...EVM_CHAIN_SLUGS] as const;

const DESCRIPTION =
  'Check the status of a transaction. Supports both EVM (transaction hash) and Solana ' +
  '(signature). Free, read-only.\n\n' +
  'Use this to confirm a transfer landed, debug a failed transaction, or report status to a ' +
  `user. Both \`chain\` and \`transaction_hash\` are required. Available chains: ${TX_STATUS_CHAINS.join(', ')}.`;

export function registerTransactionStatusTool(
  server: McpServer,
  configService: ConfigService,
): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Get transaction status',
      description: DESCRIPTION,
      inputSchema: {
        chain: z
          .enum(TX_STATUS_CHAINS)
          .describe(
            `Blockchain network. One of: ${TX_STATUS_CHAINS.join(', ')}`,
          ),
        transaction_hash: z
          .string()
          .describe(
            'Transaction hash (EVM, 0x + 64 hex) or Solana signature (base58).',
          ),
      },
      outputSchema: {
        chain: z.string().optional(),
        transaction_hash: z.string().optional(),
        status: z
          .string()
          .optional()
          .describe('e.g. "success", "failed", "not_found", "pending".'),
        from: z.string().optional(),
        to: z.string().nullable().optional(),
        value: z.string().optional(),
        gasUsed: z.string().nullable().optional(),
        gasPrice: z.string().nullable().optional(),
        blockNumber: z.string().nullable().optional(),
        blockNumberDecimal: z.string().nullable().optional(),
        timestamp: z.number().nullable().optional(),
        error: z.string().optional(),
        message: z.string().optional(),
      },
      annotations: {
        title: 'Get transaction status',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ chain, transaction_hash }): Promise<CallToolResult> => {
      const data = await execute(configService, chain, transaction_hash);
      return toToolResult(data);
    },
  );
}

export async function execute(
  configService: ConfigService,
  chain: string,
  transactionHashRaw: string,
): Promise<Record<string, unknown>> {
  const hashRaw = transactionHashRaw.trim();
  if (!hashRaw) {
    return {
      error: 'MISSING_TRANSACTION_HASH',
      message: 'Pass transaction_hash: EVM 0x hash or Solana signature.',
    };
  }

  if (isSolanaChainSlug(chain)) {
    return executeSolana(configService, chain, hashRaw);
  }

  const chainResult = parseEvmChainArg(chain);
  if (chainResult.ok === false) {
    return chainResult.error as Record<string, unknown>;
  }

  if (!isHash(hashRaw)) {
    return {
      error: 'INVALID_TRANSACTION_HASH',
      message: 'EVM transaction_hash must be 0x followed by 64 hex characters.',
    };
  }

  const clientResult = resolveEvmClient(configService, chainResult.chain);
  if (clientResult.ok === false) {
    return clientResult.error as Record<string, unknown>;
  }

  try {
    const info = await fetchTransactionInfo(
      clientResult.client,
      clientResult.chain,
      hashRaw,
    );
    return {
      chain: info.chain,
      transaction_hash: info.hash,
      status: info.status,
      from: info.from,
      to: info.to,
      value: info.value,
      gasUsed: info.gasUsed,
      gasPrice: info.gasPrice,
      blockNumber: info.blockNumber,
      blockNumberDecimal: info.blockNumberDecimal,
      timestamp: info.timestamp,
    };
  } catch (err: unknown) {
    const msg = logToolFailure(logger, `${chainResult.chain} ${hashRaw}`, err);
    if (msg.toLowerCase().includes('not found')) {
      return {
        chain: chainResult.chain,
        transaction_hash: hashRaw,
        status: 'not_found',
        error: 'TRANSACTION_NOT_FOUND',
        message: msg,
      };
    }
    return {
      chain: chainResult.chain,
      transaction_hash: hashRaw,
      error: 'RPC_FAILED',
      message: msg,
    };
  }
}

async function executeSolana(
  configService: ConfigService,
  chain: 'solana' | 'solana-devnet',
  signature: string,
): Promise<Record<string, unknown>> {
  if (!isValidSolanaSignature(signature)) {
    return {
      error: 'INVALID_TRANSACTION_HASH',
      message: 'Solana transaction_hash must be a base58 signature.',
    };
  }
  const rpc = resolveSolanaRpcUrl(configService, chain);
  try {
    return (await fetchSolanaTransactionStatus(
      rpc,
      chain,
      signature,
    )) as unknown as Record<string, unknown>;
  } catch (err: unknown) {
    const msg = logToolFailure(logger, `solana ${chain}`, err);
    return {
      chain,
      transaction_hash: signature,
      error: 'RPC_FAILED',
      message: msg,
    };
  }
}
