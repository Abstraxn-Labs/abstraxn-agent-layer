import { z } from 'zod';
import type { ConfigService } from '@nestjs/config';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { EVM_CHAIN_ENUM } from '../utils/chain-registry.util';
import { parseEvmChainArg, resolveEvmClient } from '../utils/evm-chain.util';
import { fetchGasInfo } from '../integrations/gas.integration';
import { toToolResult } from '../utils/tool-result.util';
import { createToolLogger, logToolFailure } from '../utils/tool-logging.util';

const TOOL_NAME = 'network.gas_info';
const logger = createToolLogger(TOOL_NAME);

const DESCRIPTION =
  'Get the current gas price and EIP-1559 fee hints for an EVM chain. Free, read-only, no ' +
  'wallet needed.\n\n' +
  'Use this to estimate transaction cost or explain fees to a user before they send a ' +
  `transaction. \`chain\` is required. Supported chains: ${EVM_CHAIN_ENUM.join(', ')}.`;

export function registerGasInfoTool(
  server: McpServer,
  configService: ConfigService,
): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Get gas price info',
      description: DESCRIPTION,
      inputSchema: {
        chain: z
          .enum(EVM_CHAIN_ENUM)
          .describe(`EVM network slug. One of: ${EVM_CHAIN_ENUM.join(', ')}`),
      },
      outputSchema: {
        chain: z.string().optional(),
        gasPrice: z.string().optional().describe('Current gas price in wei.'),
        gasPriceGwei: z
          .string()
          .optional()
          .describe('Current gas price in gwei.'),
        maxFeePerGas: z.string().nullable().optional(),
        maxPriorityFeePerGas: z.string().nullable().optional(),
        supportsEip1559: z.boolean().optional(),
        timestamp: z
          .number()
          .optional()
          .describe('Unix ms timestamp of the reading.'),
        error: z.string().optional(),
        message: z.string().optional(),
      },
      annotations: {
        title: 'Get gas price info',
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
  chain: string,
): Promise<Record<string, unknown>> {
  const chainResult = parseEvmChainArg(chain);
  if (chainResult.ok === false) {
    return chainResult.error as Record<string, unknown>;
  }

  const clientResult = resolveEvmClient(configService, chainResult.chain);
  if (clientResult.ok === false) {
    return clientResult.error as Record<string, unknown>;
  }

  try {
    return (await fetchGasInfo(
      clientResult.client,
      clientResult.chain,
    )) as unknown as Record<string, unknown>;
  } catch (err: unknown) {
    const msg = logToolFailure(logger, chainResult.chain, err);
    return { chain: chainResult.chain, error: 'RPC_FAILED', message: msg };
  }
}
