import { z } from 'zod';
import type { ConfigService } from '@nestjs/config';
import type { PaymentPayload } from '@x402/core/types';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { callUpstreamRelayEndpoint } from '../utils/x402-relay.util';
import { WalletTrackingService } from '../services/wallet-tracking.service';
import {
  finalizeRelayResult,
  toErrorToolResult,
} from '../utils/tool-result.util';

const TOOL_NAME = 'travel.search';

const ACTION_ENUM = ['flight_search', 'hotel_search'] as const;
type Action = (typeof ACTION_ENUM)[number];

type Dispatch = {
  method: 'GET';
  path: string;
  params: Record<string, unknown>;
};

const DESCRIPTION =
  "Flight and hotel search, paid per call in USDC/USDm directly from the caller's own wallet " +
  'via the x402 protocol — no Abstraxn account needed. Pick one `action`:\n\n' +
  '- flight_search ($0.02): live flight fares via Google Flights. Requires `origin`, ' +
  '`destination`, `departureDate`. Optional `returnDate`, `adults`, `children`, `travelClass`, ' +
  '`stops`, `maxPrice`, `currency`.\n' +
  '- hotel_search ($0.02): live hotel prices/ratings via Google Hotels. Requires `q` ' +
  '(city or hotel name), `checkInDate`, `checkOutDate`. Optional `adults`, `children`, ' +
  '`sortBy`, `minPrice`, `maxPrice`, `hotelClass`, `currency`.\n\n' +
  'Prices above are indicative — the exact charge for a given call is always whatever the ' +
  'live payment challenge specifies for that request. The first call (no `paymentPayload`) ' +
  'returns `paymentRequired`; retry with the same arguments plus `paymentPayload` to complete ' +
  'payment and get the real result.';

export function registerTravelSearchTool(
  server: McpServer,
  configService: ConfigService,
  walletTrackingService: WalletTrackingService,
): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Flight / hotel search (pay-per-call)',
      description: DESCRIPTION,
      inputSchema: {
        action: z
          .enum(ACTION_ENUM)
          .describe('Which travel operation to perform.'),
        q: z
          .string()
          .optional()
          .describe(
            'hotel_search: city or hotel name to search for, e.g. "hotels in Paris".',
          ),
        origin: z
          .string()
          .optional()
          .describe('flight_search: departure airport IATA code, e.g. "JFK".'),
        destination: z
          .string()
          .optional()
          .describe('flight_search: arrival airport IATA code, e.g. "LAX".'),
        departureDate: z
          .string()
          .optional()
          .describe('flight_search: departure date, YYYY-MM-DD.'),
        returnDate: z
          .string()
          .optional()
          .describe(
            'flight_search: return date for round trips, YYYY-MM-DD. Optional.',
          ),
        adults: z
          .string()
          .optional()
          .describe(
            'flight_search / hotel_search: number of adult passengers/guests. Optional.',
          ),
        children: z
          .string()
          .optional()
          .describe(
            'flight_search / hotel_search: number of children. Optional.',
          ),
        travelClass: z
          .string()
          .optional()
          .describe(
            'flight_search: cabin class — 1=Economy, 2=Premium Economy, 3=Business, 4=First. Optional.',
          ),
        stops: z
          .string()
          .optional()
          .describe(
            'flight_search: stop preference — 0=nonstop only, 1=up to 1 stop, 2=up to 2 stops. Optional.',
          ),
        maxPrice: z
          .string()
          .optional()
          .describe(
            'flight_search / hotel_search: maximum price filter. Optional.',
          ),
        currency: z
          .string()
          .optional()
          .describe(
            'flight_search / hotel_search: currency code, default "USD".',
          ),
        checkInDate: z
          .string()
          .optional()
          .describe('hotel_search: check-in date, YYYY-MM-DD.'),
        checkOutDate: z
          .string()
          .optional()
          .describe('hotel_search: check-out date, YYYY-MM-DD.'),
        sortBy: z
          .string()
          .optional()
          .describe(
            'hotel_search: sort order — 3=lowest price, 8=highest rating, 13=most reviewed. Optional.',
          ),
        minPrice: z
          .string()
          .optional()
          .describe('hotel_search: minimum price per night filter. Optional.'),
        hotelClass: z
          .string()
          .optional()
          .describe('hotel_search: star rating filter, 2-5. Optional.'),
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
        title: 'Flight / hotel search (pay-per-call)',
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
    case 'flight_search': {
      const origin = typeof args.origin === 'string' ? args.origin.trim() : '';
      const destination =
        typeof args.destination === 'string' ? args.destination.trim() : '';
      const departureDate =
        typeof args.departureDate === 'string' ? args.departureDate.trim() : '';
      if (!origin || !destination || !departureDate) {
        return toErrorToolResult({
          error:
            'origin, destination, and departureDate are required for action=flight_search.',
        });
      }
      dispatch = {
        method: 'GET',
        path: '/api/travel/flights',
        params: {
          origin,
          destination,
          departureDate,
          returnDate: args.returnDate,
          adults: args.adults,
          children: args.children,
          travelClass: args.travelClass,
          stops: args.stops,
          maxPrice: args.maxPrice,
          currency: args.currency,
        },
      };
      break;
    }
    case 'hotel_search': {
      const q = typeof args.q === 'string' ? args.q.trim() : '';
      const checkInDate =
        typeof args.checkInDate === 'string' ? args.checkInDate.trim() : '';
      const checkOutDate =
        typeof args.checkOutDate === 'string' ? args.checkOutDate.trim() : '';
      if (!q || !checkInDate || !checkOutDate) {
        return toErrorToolResult({
          error:
            'q, checkInDate, and checkOutDate are required for action=hotel_search.',
        });
      }
      dispatch = {
        method: 'GET',
        path: '/api/travel/hotels',
        params: {
          q,
          checkInDate,
          checkOutDate,
          adults: args.adults,
          children: args.children,
          sortBy: args.sortBy,
          minPrice: args.minPrice,
          maxPrice: args.maxPrice,
          hotelClass: args.hotelClass,
          currency: args.currency,
        },
      };
      break;
    }
  }

  const result = await callUpstreamRelayEndpoint(
    configService,
    dispatch.path,
    dispatch.params,
    options,
  );

  return finalizeRelayResult(
    result,
    TOOL_NAME,
    paymentPayload,
    walletTrackingService,
  );
}
