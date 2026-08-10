import { z } from 'zod';
import type { ConfigService } from '@nestjs/config';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { isAddress } from 'viem';
import { EVM_CHAIN_ENUM } from '../utils/chain-registry.util';
import { parseEvmChainArg, resolveEvmClient } from '../utils/evm-chain.util';
import {
  fetchTokenInfo,
  resolveTokenContractAddress,
} from '../integrations/token-info.integration';
import { toToolResult } from '../utils/tool-result.util';
import { createToolLogger, logToolFailure } from '../utils/tool-logging.util';

const TOOL_NAME = 'network.token_info';
const logger = createToolLogger(TOOL_NAME);

const DESCRIPTION =
  'Read ERC-20 token metadata — name, symbol, decimals, total supply — for a token contract ' +
  'on an EVM chain. Free, read-only.\n\n' +
  'Pass `token` as a contract address (0x…) or symbol `USDC` / `USDC.e` on chains where a ' +
  'lookup is configured. This server never holds a caller wallet, so no balance is ever ' +
  `returned — only public token metadata. Both \`chain\` and \`token\` are required. ` +
  `Supported chains: ${EVM_CHAIN_ENUM.join(', ')}.`;

export function registerTokenInfoTool(
  server: McpServer,
  configService: ConfigService,
): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Get ERC-20 token info',
      description: DESCRIPTION,
      inputSchema: {
        chain: z
          .enum(EVM_CHAIN_ENUM)
          .describe('EVM network for the token contract.'),
        token: z
          .string()
          .describe(
            'ERC-20 contract address (0x…) or symbol USDC / USDC.e where configured for the chain.',
          ),
      },
      outputSchema: {
        chain: z.string().optional(),
        tokenAddress: z.string().optional(),
        name: z.string().optional(),
        symbol: z.string().optional(),
        decimals: z.number().int().optional(),
        totalSupply: z
          .string()
          .optional()
          .describe('Raw total supply (base units).'),
        totalSupplyFormatted: z.string().optional(),
        timestamp: z.number().optional(),
        error: z.string().optional(),
        message: z.string().optional(),
      },
      annotations: {
        title: 'Get ERC-20 token info',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ chain, token }): Promise<CallToolResult> => {
      const data = await execute(configService, chain, token);
      return toToolResult(data);
    },
  );
}

export async function execute(
  configService: ConfigService,
  chain: string,
  tokenRaw: string,
): Promise<Record<string, unknown>> {
  const chainResult = parseEvmChainArg(chain);
  if (chainResult.ok === false) {
    return chainResult.error as Record<string, unknown>;
  }

  const token = tokenRaw.trim();
  if (!token) {
    return {
      error: 'MISSING_TOKEN',
      message: 'Pass token: ERC-20 contract address or symbol (USDC, USDC.e).',
    };
  }

  const tokenAddress = resolveTokenContractAddress(chainResult.chain, token);
  if (!tokenAddress || !isAddress(tokenAddress)) {
    return {
      error: 'INVALID_TOKEN',
      message: `Could not resolve token "${token}" on ${chainResult.chain}. Use a 0x contract address or USDC / USDC.e.`,
      chain: chainResult.chain,
    };
  }

  const clientResult = resolveEvmClient(configService, chainResult.chain);
  if (clientResult.ok === false) {
    return clientResult.error as Record<string, unknown>;
  }

  try {
    return (await fetchTokenInfo(
      clientResult.rpcUrl,
      chainResult.chain,
      tokenAddress,
    )) as unknown as Record<string, unknown>;
  } catch (err: unknown) {
    const msg = logToolFailure(
      logger,
      `${chainResult.chain} ${tokenAddress}`,
      err,
    );
    return {
      chain: chainResult.chain,
      tokenAddress,
      error: 'RPC_FAILED',
      message: msg,
    };
  }
}
