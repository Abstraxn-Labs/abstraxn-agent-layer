import { z } from 'zod';
import type { ConfigService } from '@nestjs/config';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  BLOCKNUMBER_CHAIN_ENUM,
  isEvmChainSlug,
  isSolanaChainSlug,
  listResolvableEvmChains,
  resolveEvmRpcUrl,
  resolveSolanaRpcUrl,
  SOLANA_CHAIN_SLUGS,
} from '../utils/chain-registry.util';
import { toToolResult } from '../utils/tool-result.util';
import { createToolLogger, logToolFailure } from '../utils/tool-logging.util';

const TOOL_NAME = 'network.blocknumber';
const logger = createToolLogger(TOOL_NAME);

const DESCRIPTION =
  'Read the current chain head — EVM block number or Solana slot — for a supported network. ' +
  'Free, read-only, no wallet needed.\n\n' +
  'Use this to confirm a network is progressing before submitting a transaction, correlate ' +
  'off-chain events with on-chain height, or choose a safe starting point when scanning logs.\n\n' +
  `Pass \`chain\` as one of: ${BLOCKNUMBER_CHAIN_ENUM.filter((c) => c !== 'all').join(', ')}. ` +
  'Omit `chain` (or pass `all`) to query every resolvable chain in one call.';

export function registerBlocknumberTool(
  server: McpServer,
  configService: ConfigService,
): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Get current block number / slot',
      description: DESCRIPTION,
      inputSchema: {
        chain: z
          .enum(BLOCKNUMBER_CHAIN_ENUM)
          .optional()
          .describe(
            `Blockchain network, or "all" (default) for every supported chain. One of: ${BLOCKNUMBER_CHAIN_ENUM.join(', ')}`,
          ),
      },
      outputSchema: {
        chain: z.string().optional(),
        blockNumber: z
          .string()
          .optional()
          .describe('Hex-encoded EVM block number.'),
        blockNumberDecimal: z.string().optional(),
        slot: z.number().int().optional().describe('Solana slot number.'),
        blocks: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Per-chain results, present for multi-chain queries.'),
        error: z.string().optional(),
        message: z.string().optional(),
      },
      annotations: {
        title: 'Get current block number / slot',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ chain }): Promise<CallToolResult> => {
      const data = await execute(configService, chain);
      return toToolResult(data);
    },
  );
}

export async function execute(
  configService: ConfigService,
  chain: string | undefined,
): Promise<Record<string, unknown>> {
  if (!chain || chain === 'all') {
    return executeAll(configService);
  }
  if (isSolanaChainSlug(chain)) {
    return solanaSlot(configService, chain);
  }
  if (isEvmChainSlug(chain)) {
    return evmBlockNumber(configService, chain);
  }
  return { error: 'UNSUPPORTED_CHAIN', message: chain };
}

/**
 * Queried concurrently, not sequentially — this is a free, unauthenticated tool, so the
 * worst-case latency of one call must stay bounded by a single RPC timeout (~12s), not by the
 * number of configured chains (sequential awaits would let one call occupy a request handler
 * for minutes if several RPCs are slow).
 */
async function executeAll(
  configService: ConfigService,
): Promise<Record<string, unknown>> {
  const entries = await Promise.all([
    ...listResolvableEvmChains(configService).map(
      async (slug) =>
        [slug, await evmBlockNumber(configService, slug, true)] as const,
    ),
    ...SOLANA_CHAIN_SLUGS.map(
      async (slug) => [slug, await solanaSlot(configService, slug)] as const,
    ),
  ]);

  return { blocks: Object.fromEntries(entries) };
}

async function evmBlockNumber(
  configService: ConfigService,
  chain: string,
  quiet?: boolean,
): Promise<Record<string, unknown>> {
  const rpcUrl = resolveEvmRpcUrl(configService, chain);
  if (!rpcUrl) {
    return quiet
      ? { error: 'CHAIN_RPC_UNAVAILABLE', chain }
      : {
          error: 'CHAIN_RPC_UNAVAILABLE',
          message: `No RPC URL for "${chain}".`,
        };
  }
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_blockNumber',
        params: [],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    const body = (await res.json()) as {
      result?: string;
      error?: { message: string };
    };
    if (body.error) {
      return { chain, error: body.error.message };
    }
    const hex = body.result ?? '0x0';
    return {
      chain,
      blockNumber: hex,
      blockNumberDecimal: BigInt(hex).toString(),
    };
  } catch (err: unknown) {
    const msg = logToolFailure(logger, `eth_blockNumber ${chain}`, err);
    return { chain, error: `RPC failed: ${msg}` };
  }
}

async function solanaSlot(
  configService: ConfigService,
  chain: 'solana' | 'solana-devnet',
): Promise<Record<string, unknown>> {
  const rpc = resolveSolanaRpcUrl(configService, chain);
  try {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSlot',
        params: [{ commitment: 'confirmed' }],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    const body = (await res.json()) as {
      result?: number;
      error?: { message: string };
    };
    if (body.error) {
      return { chain, error: body.error.message };
    }
    return { chain, slot: body.result ?? 0 };
  } catch (err: unknown) {
    const msg = logToolFailure(logger, `getSlot ${chain}`, err);
    return { chain, error: `RPC failed: ${msg}` };
  }
}
