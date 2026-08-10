import { z } from 'zod';
import type { ConfigService } from '@nestjs/config';
import type { PaymentPayload } from '@x402/core/types';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  callUpstreamRelayEndpoint,
  callUpstreamRelayEndpointJson,
} from '../utils/x402-relay.util';
import { WalletTrackingService } from '../services/wallet-tracking.service';
import {
  finalizeRelayResult,
  toErrorToolResult,
} from '../utils/tool-result.util';

const TOOL_NAME = 'market.crypto';

const ACTION_ENUM = [
  'search',
  'price_feed',
  'market_data',
  'historical_data',
  'trending',
  'token_prices',
] as const;
type Action = (typeof ACTION_ENUM)[number];

type Dispatch =
  | { method: 'GET'; path: string; params: Record<string, unknown> }
  | { method: 'POST'; path: string; body: Record<string, unknown> };

const DESCRIPTION =
  'Crypto market-data lookups (CoinGecko-sourced pricing and market data), paid per call in ' +
  "USDC/USDm directly from the caller's own wallet via the x402 protocol — no Abstraxn account " +
  'needed. Pick one `action`:\n\n' +
  '- search ($0.001): fuzzy-search coins by name/symbol. Requires `q`. Call this first to ' +
  'resolve a coin id before using price_feed or historical_data, both of which need an id ' +
  '(e.g. "bitcoin"), not a ticker.\n' +
  '- price_feed ($0.001): current price (and optionally 24h change / market cap) for one or ' +
  'more coins. Requires `ids` (comma-separated coin ids). Optional `currencies` ' +
  '(comma-separated fiat codes, default "usd"), `include_24h` (default true), `include_mcap` ' +
  '(default false).\n' +
  '- market_data ($0.002): coins ranked by market cap (or another order) — use for "top N ' +
  'coins" / market overview questions. Optional `currency` (default "usd"), `category`, ' +
  '`order` (default "market_cap_desc"), `limit` (1-250, default 100), `page` (default 1).\n' +
  '- historical_data ($0.003): historical price/market cap/volume series for one coin. ' +
  'Requires `id`. Optional `currency` (default "usd"), `days` (lookback window or "max", ' +
  'default 30), `interval` (e.g. "daily").\n' +
  '- trending ($0.001): currently trending coins by search interest. No extra parameters.\n' +
  '- token_prices ($0.005): DEX-derived prices for up to 200 tokens in one call. Requires ' +
  '`tokens`, an array of `{chain, token_address}` objects.\n\n' +
  'Prices above are indicative — the exact charge for a given call is always whatever the ' +
  'live payment challenge specifies for that request. The first call (no `paymentPayload`) ' +
  'returns `paymentRequired`; retry with the same arguments plus `paymentPayload` to complete ' +
  'payment and get the real result.';

export function registerMarketCryptoTool(
  server: McpServer,
  configService: ConfigService,
  walletTrackingService: WalletTrackingService,
): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Crypto market data (pay-per-call)',
      description: DESCRIPTION,
      inputSchema: {
        action: z
          .enum(ACTION_ENUM)
          .describe('Which market-data operation to perform.'),
        q: z
          .string()
          .optional()
          .describe('search: coin name or symbol to search for, e.g. "btc".'),
        ids: z
          .string()
          .optional()
          .describe(
            'price_feed: comma-separated coin IDs, e.g. "bitcoin,ethereum".',
          ),
        currencies: z
          .string()
          .optional()
          .describe(
            'price_feed: comma-separated fiat currency codes, default "usd".',
          ),
        include_24h: z
          .boolean()
          .optional()
          .describe('price_feed: include 24h price change (default true).'),
        include_mcap: z
          .boolean()
          .optional()
          .describe('price_feed: include market cap (default false).'),
        currency: z
          .string()
          .optional()
          .describe(
            'market_data / historical_data: currency code, default "usd".',
          ),
        category: z
          .string()
          .optional()
          .describe(
            'market_data: category filter, e.g. "decentralized-finance-defi".',
          ),
        order: z
          .string()
          .optional()
          .describe('market_data: sort order, default "market_cap_desc".'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(250)
          .optional()
          .describe('market_data: max results, default 100.'),
        page: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('market_data: page number, default 1.'),
        id: z
          .string()
          .optional()
          .describe('historical_data: coin id, e.g. "bitcoin".'),
        days: z
          .string()
          .optional()
          .describe(
            'historical_data: lookback window in days, or "max". Default 30.',
          ),
        interval: z
          .string()
          .optional()
          .describe('historical_data: data granularity, e.g. "daily".'),
        tokens: z
          .array(z.object({ chain: z.string(), token_address: z.string() }))
          .max(200)
          .optional()
          .describe(
            'token_prices: array of {chain, token_address} pairs to price, max 200 entries.',
          ),
        paymentPayload: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            'x402 payment payload from a previous `paymentRequired` challenge. Omit on the first call.',
          ),
      },
      outputSchema: {
        paymentRequired: z.record(z.string(), z.unknown()).optional(),
        error: z.record(z.string(), z.unknown()).optional(),
      },
      annotations: {
        title: 'Crypto market data (pay-per-call)',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args): Promise<CallToolResult> => {
      return execute(configService, walletTrackingService, args);
    },
  );
}

export async function execute(
  configService: ConfigService,
  walletTrackingService: WalletTrackingService,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const action = args.action as Action;
  const paymentPayload = args.paymentPayload as PaymentPayload | undefined;
  const options = { paymentPayload };

  let dispatch: Dispatch;
  switch (action) {
    case 'search': {
      const q = typeof args.q === 'string' ? args.q.trim() : '';
      if (!q) {
        return toErrorToolResult({ error: 'q is required for action=search.' });
      }
      dispatch = { method: 'GET', path: '/api/crypto/search', params: { q } };
      break;
    }
    case 'price_feed': {
      const ids = typeof args.ids === 'string' ? args.ids.trim() : '';
      if (!ids) {
        return toErrorToolResult({
          error: 'ids is required for action=price_feed.',
        });
      }
      dispatch = {
        method: 'GET',
        path: '/api/crypto/price',
        params: {
          ids,
          currencies: args.currencies,
          include_24h:
            typeof args.include_24h === 'boolean'
              ? args.include_24h
              : undefined,
          include_mcap:
            typeof args.include_mcap === 'boolean'
              ? args.include_mcap
              : undefined,
        },
      };
      break;
    }
    case 'market_data': {
      dispatch = {
        method: 'GET',
        path: '/api/crypto/markets',
        params: {
          currency: args.currency,
          category: args.category,
          order: args.order,
          limit: args.limit,
          page: args.page,
        },
      };
      break;
    }
    case 'historical_data': {
      const id = typeof args.id === 'string' ? args.id.trim() : '';
      if (!id) {
        return toErrorToolResult({
          error: 'id is required for action=historical_data.',
        });
      }
      dispatch = {
        method: 'GET',
        path: '/api/crypto/history',
        params: {
          id,
          currency: args.currency,
          days: args.days,
          interval: args.interval,
        },
      };
      break;
    }
    case 'trending': {
      dispatch = { method: 'GET', path: '/api/crypto/trending', params: {} };
      break;
    }
    case 'token_prices': {
      if (!Array.isArray(args.tokens) || args.tokens.length === 0) {
        return toErrorToolResult({
          error:
            'tokens (a non-empty array of {chain, token_address}) is required for action=token_prices.',
        });
      }
      dispatch = {
        method: 'POST',
        path: '/api/token/prices',
        body: { tokens: args.tokens },
      };
      break;
    }
  }

  const result =
    dispatch.method === 'GET'
      ? await callUpstreamRelayEndpoint(
          configService,
          dispatch.path,
          dispatch.params,
          options,
        )
      : await callUpstreamRelayEndpointJson(
          configService,
          dispatch.path,
          dispatch.body,
          options,
        );

  return finalizeRelayResult(
    result,
    TOOL_NAME,
    paymentPayload,
    walletTrackingService,
  );
}
