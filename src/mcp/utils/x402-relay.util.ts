import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PaymentPayload, PaymentRequired } from '@x402/core/types';
import {
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
} from '@x402/core/http';

const logger = new Logger('X402RelayClient');

export interface RelayPaymentOptions {
  paymentPayload?: PaymentPayload;
}

export type RelayCallResult =
  | { status: 'ok'; result: unknown }
  | { status: 'error'; error: { error: string; message: string } }
  | { status: 'paymentRequired'; paymentRequired: PaymentRequired };

/**
 * Base URL for the 3 payable relay tools (`market.crypto`, `web3.lookup`, `travel.search`).
 * Deliberately has no hardcoded default and no fallback — this repo is public, so the real
 * upstream never appears in source, only in a deployment's own untracked `.env`
 * (`UPSTREAM_RELAY_BASE_URL`, see .env.example). Always server-side config, never a tool
 * argument — accepting a URL from the caller here would be an SSRF vector.
 *
 * Deliberately a *separate* variable from `ENRICHMENT_RELAY_BASE_URL` (places.lookup /
 * social.profile_lookup) — that relays to a different upstream than this one, even though the
 * request/response mechanics are identical.
 */
export function resolveUpstreamRelayBaseUrl(
  configService: ConfigService,
): string {
  const configured = configService
    .get<string>('UPSTREAM_RELAY_BASE_URL', '')
    .trim();
  if (!configured) {
    throw new Error(
      'UPSTREAM_RELAY_BASE_URL is not set. This service ships with no default upstream — ' +
        "configure it in your deployment's own .env before calling market.crypto, web3.lookup, " +
        'or travel.search.',
    );
  }
  return configured;
}

/**
 * Base URL for the 2 payable enrichment relay tools (`places.lookup`, `social.profile_lookup`).
 * Same no-default, no-fallback reasoning as `resolveUpstreamRelayBaseUrl` — kept as its own env
 * var (`ENRICHMENT_RELAY_BASE_URL`) since these 2 tools relay to a different upstream than
 * `UPSTREAM_RELAY_BASE_URL`'s 3 tools.
 */
export function resolveEnrichmentRelayBaseUrl(
  configService: ConfigService,
): string {
  const configured = configService
    .get<string>('ENRICHMENT_RELAY_BASE_URL', '')
    .trim();
  if (!configured) {
    throw new Error(
      'ENRICHMENT_RELAY_BASE_URL is not set. This service ships with no default upstream — ' +
        "configure it in your deployment's own .env before calling places.lookup or " +
        'social.profile_lookup.',
    );
  }
  return configured;
}

/** Query param values here are always strings/numbers/booleans from a tool's own Zod schema. */
function stringifyQueryParam(value: string | number | boolean): string {
  return typeof value === 'string' ? value : String(value);
}

/**
 * The x402 spec's `resource.url` field is the upstream's own real endpoint URL (e.g.
 * "https://<upstream-host>/api/crypto/trending") — informational metadata, never read by the
 * signing flow (only `accepts[]` is). Reduced to a path so a caller never learns which vendor
 * sits behind this relay. Guards on the field being present at all: decoded challenge headers
 * are untrusted external data, not guaranteed to match the type exactly.
 */
function sanitizePaymentChallenge(challenge: PaymentRequired): PaymentRequired {
  const url = challenge.resource?.url;
  if (!url) {
    return challenge;
  }
  let sanitizedUrl = url;
  try {
    const parsed = new URL(url);
    sanitizedUrl = `${parsed.pathname}${parsed.search}`;
  } catch {
    // Not an absolute URL — the blanket redaction pass in redactUpstreamIdentity still covers it.
  }
  return {
    ...challenge,
    resource: { ...challenge.resource, url: sanitizedUrl },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Defense-in-depth: replaces every occurrence of the upstream's own host anywhere in a result
 * (nested objects/arrays/strings — error text, x402 `extensions`, or any other field the
 * upstream controls) with a generic placeholder. This service relays third-party data; it must
 * never reveal which vendor it relays from, even in a field `sanitizePaymentChallenge` doesn't
 * already handle. A stringify/replace/parse round-trip covers every nested string in one pass —
 * no need to hand-write a recursive walk over objects/arrays.
 */
function redactUpstreamIdentity<T>(value: T, host: string): T {
  if (!host) {
    return value;
  }
  const pattern = new RegExp(escapeRegExp(host), 'gi');
  return JSON.parse(JSON.stringify(value).replace(pattern, '[upstream]')) as T;
}

function buildUpstreamRelayUrl(
  baseUrl: string,
  path: string,
  params: Record<string, unknown> = {},
): string {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    url.searchParams.set(
      key,
      stringifyQueryParam(value as string | number | boolean),
    );
  }
  return url.toString();
}

/**
 * Shared request path for both GET+query-params and POST+JSON-body relay calls — payment-header
 * attachment, 402 decoding, and ok/error handling are identical either way; only the URL and the
 * presence of a body differ. Never signs a payment itself — the upstream service issues its own
 * x402 challenge and settles it against its own facilitator: no `paymentPayload` means an
 * unsigned probe that surfaces `{status: 'paymentRequired', ...}` on a 402; a supplied
 * `paymentPayload` gets attached as the `PAYMENT-SIGNATURE` (v2) or `X-PAYMENT` (v1) header on
 * the same call.
 */
async function doUpstreamRelayRequest(
  url: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
  options: RelayPaymentOptions,
): Promise<RelayCallResult> {
  const upstreamUrl = new URL(url);
  const path = upstreamUrl.pathname;
  const host = upstreamUrl.host;
  const paymentPayload = options.paymentPayload;
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (paymentPayload) {
    const encoded = encodePaymentSignatureHeader(paymentPayload);
    headers[
      paymentPayload.x402Version === 2 ? 'PAYMENT-SIGNATURE' : 'X-PAYMENT'
    ] = encoded;
  }

  try {
    const res = await fetch(url, {
      method: init.method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 402) {
      const header =
        res.headers.get('PAYMENT-REQUIRED') ??
        res.headers.get('payment-required');
      let challenge: PaymentRequired | null = null;
      if (header) {
        try {
          challenge = decodePaymentRequiredHeader(header);
        } catch (e) {
          logger.warn(
            `Could not decode upstream PAYMENT-REQUIRED header: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      if (!challenge) {
        return {
          status: 'error',
          error: {
            error: 'UPSTREAM_PAYMENT_CHALLENGE_UNDECODABLE',
            message:
              'Upstream returned 402 but no decodable PAYMENT-REQUIRED challenge was present.',
          },
        };
      }
      return redactUpstreamIdentity(
        {
          status: 'paymentRequired',
          paymentRequired: sanitizePaymentChallenge(challenge),
        },
        host,
      );
    }

    if (!res.ok) {
      const text = await res.text();
      return redactUpstreamIdentity(
        {
          status: 'error',
          error: {
            error: 'UPSTREAM_RELAY_ERROR',
            message: `Upstream request "${path}" failed (${res.status}): ${text}`,
          },
        },
        host,
      );
    }

    const result = (await res.json()) as unknown;
    return redactUpstreamIdentity({ status: 'ok', result }, host);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.warn(`Upstream relay call "${path}" failed: ${message}`);
    return redactUpstreamIdentity(
      {
        status: 'error',
        error: { error: 'UPSTREAM_RELAY_CALL_FAILED', message },
      },
      host,
    );
  }
}

/** Relays a GET REST call with query-string params. See `doUpstreamRelayRequest` for shared behavior. */
export async function callUpstreamRelayEndpoint(
  configService: ConfigService,
  path: string,
  params: Record<string, unknown>,
  options: RelayPaymentOptions,
): Promise<RelayCallResult> {
  const url = buildUpstreamRelayUrl(
    resolveUpstreamRelayBaseUrl(configService),
    path,
    params,
  );
  return doUpstreamRelayRequest(url, { method: 'GET' }, options);
}

/** Relays a POST REST call with a JSON body. See `doUpstreamRelayRequest` for shared behavior. */
export async function callUpstreamRelayEndpointJson(
  configService: ConfigService,
  path: string,
  body: Record<string, unknown>,
  options: RelayPaymentOptions,
): Promise<RelayCallResult> {
  const url = new URL(
    path,
    resolveUpstreamRelayBaseUrl(configService),
  ).toString();
  return doUpstreamRelayRequest(url, { method: 'POST', body }, options);
}

/** Relays a GET REST call to the enrichment upstream. See `doUpstreamRelayRequest` for shared behavior. */
export async function callEnrichmentRelayEndpoint(
  configService: ConfigService,
  path: string,
  params: Record<string, unknown>,
  options: RelayPaymentOptions,
): Promise<RelayCallResult> {
  const url = buildUpstreamRelayUrl(
    resolveEnrichmentRelayBaseUrl(configService),
    path,
    params,
  );
  return doUpstreamRelayRequest(url, { method: 'GET' }, options);
}

/** Relays a POST REST call with a JSON body to the enrichment upstream. See `doUpstreamRelayRequest` for shared behavior. */
export async function callEnrichmentRelayEndpointJson(
  configService: ConfigService,
  path: string,
  body: Record<string, unknown>,
  options: RelayPaymentOptions,
): Promise<RelayCallResult> {
  const url = new URL(
    path,
    resolveEnrichmentRelayBaseUrl(configService),
  ).toString();
  return doUpstreamRelayRequest(url, { method: 'POST', body }, options);
}
