import { z } from 'zod';
import type { ConfigService } from '@nestjs/config';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { toToolResult, toErrorToolResult } from '../utils/tool-result.util';
import { createToolLogger, logToolFailure } from '../utils/tool-logging.util';

const TOOL_NAME = 'weather.forecast';
const logger = createToolLogger(TOOL_NAME);

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

const ACTION_ENUM = [
  'current',
  'forecast',
  'astronomy',
  'search',
  'history',
  'marine',
] as const;
type Action = (typeof ACTION_ENUM)[number];

const DESCRIPTION =
  'Weather data from a global weather data provider — current conditions, short-range ' +
  'forecast, astronomy, historical, marine, and location search. Free, read-only, no wallet ' +
  'needed. Every action requires `q`, a location: a city name (e.g. "Paris"), "lat,lon" (e.g. ' +
  '"48.85,2.35"), a US/UK/Canadian postal code, or an IATA airport code. Pick one `action`:\n\n' +
  '- current: current conditions for `q`. Optional `aqi` (default false) adds basic air ' +
  'quality data.\n' +
  '- forecast: forecast for `q`. Optional `days` — this deployment runs on a data plan capped ' +
  'at 3 days, so only 1-3 is accepted; omit for the provider default. Optional `aqi`, `alerts` ' +
  '(default false, adds active weather alerts for the location where available).\n' +
  '- astronomy: sunrise/sunset/moonrise/moonset/moon phase for `q` on `date` (required, ' +
  'YYYY-MM-DD).\n' +
  '- search: resolve a fuzzy `q` into matching locations (name, region, country, lat/lon) — use ' +
  'this first if you only have an approximate place name and need to disambiguate.\n' +
  '- history: past weather for `q` on `date` (required, YYYY-MM-DD, must be yesterday). This ' +
  "deployment enforces a free-tier data plan that only allows yesterday's date — any other " +
  'date is rejected before a provider call is made.\n' +
  '- marine: marine/sailing conditions for `q`. This deployment runs on a data plan limited to ' +
  '1 day of data with no tide information.\n\n' +
  'Results are for general informational purposes only — do not use them as the sole basis for ' +
  'decisions involving personal safety, aviation, marine navigation, or emergency planning.';

export function registerWeatherForecastTool(
  server: McpServer,
  configService: ConfigService,
): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Weather forecast and current conditions',
      description: DESCRIPTION,
      inputSchema: {
        action: z
          .enum(ACTION_ENUM)
          .describe('Which weather operation to perform.'),
        q: z
          .string()
          .describe(
            'Location: city name, "lat,lon", postal code, or airport code. Required for every action.',
          ),
        days: z
          .number()
          .int()
          .min(1)
          .max(3)
          .optional()
          .describe(
            "forecast: number of forecast days (1-3 on this deployment's plan). Omit for the provider default.",
          ),
        date: z
          .string()
          .optional()
          .describe(
            'astronomy / history: date in YYYY-MM-DD format. Required for both.',
          ),
        aqi: z
          .boolean()
          .optional()
          .describe(
            'current / forecast / history: include basic air quality data (default false).',
          ),
        alerts: z
          .boolean()
          .optional()
          .describe(
            'forecast: include active weather alerts for the location (default false).',
          ),
      },
      outputSchema: {
        error: z.string().optional(),
        message: z.string().optional(),
      },
      annotations: {
        title: 'Weather forecast and current conditions',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args): Promise<CallToolResult> => {
      return execute(configService, args);
    },
  );
}

export async function execute(
  configService: ConfigService,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const action = args.action as Action;
  const q = typeof args.q === 'string' ? args.q.trim() : '';
  if (!q) {
    return toErrorToolResult({ error: 'q (a location) is required.' });
  }

  const apiKey = configService.get<string>('WEATHERAPI_KEY', '').trim();
  if (!apiKey) {
    return toToolResult({
      error: 'WEATHERAPI_KEY_REQUIRED',
      message:
        'Set WEATHERAPI_KEY in the service environment to enable weather.forecast.',
    });
  }
  const baseUrl = configService.get<string>('WEATHERAPI_BASE_URL', '').trim();
  if (!baseUrl) {
    return toToolResult({
      error: 'WEATHERAPI_BASE_URL_REQUIRED',
      message:
        'Set WEATHERAPI_BASE_URL in the service environment to enable weather.forecast.',
    });
  }

  switch (action) {
    case 'current':
      return dispatchCurrent(baseUrl, apiKey, q, args);
    case 'forecast':
      return dispatchForecast(baseUrl, apiKey, q, args);
    case 'astronomy':
      return dispatchAstronomy(baseUrl, apiKey, q, args);
    case 'search':
      return dispatchSearch(baseUrl, apiKey, q);
    case 'history':
      return dispatchHistory(baseUrl, apiKey, q, args);
    case 'marine':
      return dispatchMarine(baseUrl, apiKey, q);
    default:
      // action is typed as the exhaustive Action union, but execute() is exported and callable
      // directly (bypassing the tool's Zod schema), so an out-of-enum value must still resolve
      // to a clean tool error instead of falling through and returning undefined.
      return toErrorToolResult({
        error: `Unsupported action: ${String(action)}.`,
      });
  }
}

async function dispatchCurrent(
  baseUrl: string,
  apiKey: string,
  q: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  return toToolResult(
    await callWeatherApi(baseUrl, apiKey, 'current', {
      q,
      aqi: yesNo(args.aqi),
    }),
  );
}

async function dispatchForecast(
  baseUrl: string,
  apiKey: string,
  q: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  return toToolResult(
    await callWeatherApi(baseUrl, apiKey, 'forecast', {
      q,
      days: typeof args.days === 'number' ? String(args.days) : undefined,
      aqi: yesNo(args.aqi),
      alerts: yesNo(args.alerts),
    }),
  );
}

async function dispatchAstronomy(
  baseUrl: string,
  apiKey: string,
  q: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const date = typeof args.date === 'string' ? args.date.trim() : '';
  const dateErr = requireDateParam(date, 'astronomy');
  if (dateErr) return dateErr;
  return toToolResult(
    await callWeatherApi(baseUrl, apiKey, 'astronomy', { q, dt: date }),
  );
}

async function dispatchSearch(
  baseUrl: string,
  apiKey: string,
  q: string,
): Promise<CallToolResult> {
  return toToolResult(await callWeatherApi(baseUrl, apiKey, 'search', { q }));
}

async function dispatchHistory(
  baseUrl: string,
  apiKey: string,
  q: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const date = typeof args.date === 'string' ? args.date.trim() : '';
  const dateErr = requireHistoryDate(date);
  if (dateErr) return dateErr;
  return toToolResult(
    await callWeatherApi(baseUrl, apiKey, 'history', {
      q,
      dt: date,
      aqi: yesNo(args.aqi),
    }),
  );
}

async function dispatchMarine(
  baseUrl: string,
  apiKey: string,
  q: string,
): Promise<CallToolResult> {
  return toToolResult(await callWeatherApi(baseUrl, apiKey, 'marine', { q }));
}

function requireDateParam(date: string, action: Action): CallToolResult | null {
  if (!date) {
    return toErrorToolResult({
      error: `date (YYYY-MM-DD) is required for action=${action}.`,
    });
  }
  if (!DATE_FORMAT.test(date)) {
    return toErrorToolResult({
      error: `date must be in YYYY-MM-DD format for action=${action}.`,
    });
  }
  return null;
}

function yesNo(value: unknown): string | undefined {
  return typeof value === 'boolean' ? (value ? 'yes' : 'no') : undefined;
}

/**
 * Some WeatherAPI account states (e.g. an active trial on an otherwise free-tier key) return
 * history well outside the "yesterday only" free-tier window instead of rejecting it, so this
 * boundary is enforced here rather than left to the provider. UTC keeps it deterministic
 * regardless of server deployment timezone.
 */
function yesterdayUtcIsoDate(): string {
  const now = new Date();
  const yesterday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
  );
  return yesterday.toISOString().slice(0, 10);
}

function requireHistoryDate(date: string): CallToolResult | null {
  const formatErr = requireDateParam(date, 'history');
  if (formatErr) return formatErr;
  const yesterday = yesterdayUtcIsoDate();
  if (date !== yesterday) {
    return toErrorToolResult({
      error: `date must be ${yesterday} (yesterday, UTC) for action=history on this deployment's free-tier plan.`,
    });
  }
  return null;
}

function buildWeatherApiUrl(
  baseUrl: string,
  apiKey: string,
  endpoint: string,
  params: Record<string, string | undefined>,
): URL {
  const url = new URL(`${baseUrl}/${endpoint}.json`);
  url.searchParams.set('key', apiKey);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

/**
 * A non-2xx response (WAF block, plain-text rate-limit page, empty body) isn't guaranteed to be
 * valid JSON, so parsing is wrapped separately — a parse failure there must still resolve to a
 * provider-error classification carrying the real status, not the generic network-failure catch
 * in callWeatherApi. Logged (not silently swallowed) so an upstream format change is visible in
 * server logs instead of just showing up as a vague error to the caller.
 */
async function parseWeatherApiResponse(
  response: Response,
  endpoint: string,
): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (err: unknown) {
    logToolFailure(
      logger,
      `weather.forecast:${endpoint} (parsing response)`,
      err,
    );
    body = undefined;
  }
  const bodyObject =
    body !== null && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : undefined;

  if (!response.ok) {
    const providerError = bodyObject?.error as
      { code?: number; message?: string } | undefined;
    return {
      error: 'WEATHER_PROVIDER_ERROR',
      code: providerError?.code,
      message:
        providerError?.message ??
        `Weather request failed with status ${response.status}.`,
    };
  }
  // search.json returns a bare array of matches, not an object — structuredContent must be an
  // object, so wrap any non-object payload the same way the relay tools' passthrough does.
  return bodyObject ?? { data: body };
}

/**
 * Never log or interpolate the URL built here — it carries `key` (the provider API key) as a
 * query param. Only the endpoint name and the caught error's message are passed to the logger.
 */
async function callWeatherApi(
  baseUrl: string,
  apiKey: string,
  endpoint: string,
  params: Record<string, string | undefined>,
): Promise<Record<string, unknown>> {
  const url = buildWeatherApiUrl(baseUrl, apiKey, endpoint, params);
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    });
    return await parseWeatherApiResponse(response, endpoint);
  } catch (err: unknown) {
    const message = logToolFailure(logger, `weather.forecast:${endpoint}`, err);
    return { error: 'WEATHER_REQUEST_FAILED', message };
  }
}
