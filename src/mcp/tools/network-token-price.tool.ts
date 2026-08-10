import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { toToolResult } from '../utils/tool-result.util';
import { createToolLogger } from '../utils/tool-logging.util';

const TOOL_NAME = 'network.token_price';
const logger = createToolLogger(TOOL_NAME);

const DESCRIPTION =
  'Get a spot token price from a public market API (CoinGecko). Free — no payment or ' +
  'wallet needed. Defaults to ETH/USD.';

export function registerTokenPriceTool(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Get token spot price',
      description: DESCRIPTION,
      inputSchema: {
        symbol: z
          .string()
          .optional()
          .describe(
            'CoinGecko token id (e.g. "ethereum", "bitcoin", "solana"). Defaults to "ethereum".',
          ),
        vsCurrency: z
          .string()
          .optional()
          .describe('Quote currency code. Defaults to "usd".'),
      },
      outputSchema: {
        symbol: z.string().optional(),
        vsCurrency: z.string().optional(),
        price: z.number().optional(),
        source: z.string().optional().describe('e.g. "coingecko".'),
        error: z.string().optional(),
        message: z.string().optional(),
      },
      annotations: {
        title: 'Get token spot price',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ symbol, vsCurrency }): Promise<CallToolResult> => {
      const data = await execute(symbol, vsCurrency);
      return toToolResult(data);
    },
  );
}

export async function execute(
  symbolRaw: string | undefined,
  vsCurrencyRaw: string | undefined,
): Promise<Record<string, unknown>> {
  const symbol = symbolRaw?.trim()
    ? symbolRaw.trim().toLowerCase()
    : 'ethereum';
  const vsCurrency = vsCurrencyRaw?.trim()
    ? vsCurrencyRaw.trim().toLowerCase()
    : 'usd';

  const url = new URL('https://api.coingecko.com/api/v3/simple/price');
  url.searchParams.set('ids', symbol);
  url.searchParams.set('vs_currencies', vsCurrency);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return {
        error: 'PRICE_LOOKUP_FAILED',
        message: `Price API request failed with status ${response.status}.`,
      };
    }

    const body = (await response.json()) as Record<
      string,
      Record<string, number>
    >;
    const price = body?.[symbol]?.[vsCurrency];
    if (typeof price !== 'number') {
      return {
        error: 'PRICE_NOT_FOUND',
        message: `No price found for symbol "${symbol}" in "${vsCurrency}".`,
      };
    }

    return { symbol, vsCurrency, price, source: 'coingecko' };
  } catch (error) {
    logger.warn(
      `price lookup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      error: 'PRICE_LOOKUP_FAILED',
      message: `Price API call failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
