import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { PaymentPayload } from '@x402/core/types';
import type { RelayCallResult } from './x402-relay.util';
import type { WalletTrackingService } from '../services/wallet-tracking.service';

/**
 * The SDK does not auto-mirror `structuredContent` into `content` — every tool handler must
 * supply both explicitly. All `outputSchema` fields across this service's tools are optional
 * (mirrors the original's `additionalProperties: true`), so a plain data object always validates.
 */
export function toToolResult(data: Record<string, unknown>): CallToolResult {
  return {
    structuredContent: data,
    content: [{ type: 'text', text: JSON.stringify(data) }],
  };
}

/** Same shape as `toToolResult`, with `isError: true` for genuine failures (bad input, RPC failure). */
export function toErrorToolResult(
  data: Record<string, unknown>,
): CallToolResult {
  return {
    structuredContent: data,
    content: [{ type: 'text', text: JSON.stringify(data) }],
    isError: true,
  };
}

/**
 * For the 3 relay tools, whose upstream JSON shape varies per `action` and is not guaranteed to
 * be a JSON object (e.g. a market-data listing comes back as an array) — `structuredContent`
 * must be an object per the MCP spec, so a non-object payload gets wrapped as `{ data }` while
 * `content` always carries the untouched raw JSON.
 */
export function toPassthroughToolResult(data: unknown): CallToolResult {
  const structured =
    data !== null && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : { data };
  return {
    structuredContent: structured,
    content: [{ type: 'text', text: JSON.stringify(data) }],
  };
}

/**
 * Shared tail for all 3 relay tools (`market.crypto`, `web3.lookup`, `travel.search`) once
 * they've dispatched their action to `callUpstreamRelayEndpoint`/`callUpstreamRelayEndpointJson`
 * — identical in each, previously duplicated verbatim across all three files.
 */
export async function finalizeRelayResult(
  result: RelayCallResult,
  toolName: string,
  paymentPayload: PaymentPayload | undefined,
  walletTrackingService: WalletTrackingService,
): Promise<CallToolResult> {
  if (result.status === 'paymentRequired') {
    return toToolResult({ paymentRequired: result.paymentRequired });
  }
  if (result.status === 'error') {
    return toErrorToolResult({ error: result.error });
  }

  if (paymentPayload) {
    await walletTrackingService.recordPaidCall({ toolName, paymentPayload });
  }
  return toPassthroughToolResult(result.result);
}
