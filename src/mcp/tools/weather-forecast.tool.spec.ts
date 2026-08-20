import { ConfigService } from '@nestjs/config';
import { execute, registerWeatherForecastTool } from './weather-forecast.tool';

function createConfig(overrides: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string, defaultValue?: string) =>
      overrides[key] ?? defaultValue ?? '',
  } as ConfigService;
}

function weatherApiResponse(
  body: unknown,
  init: { ok?: boolean; status?: number } = {},
) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: () => Promise.resolve(body),
  } as Response;
}

/** Mirrors the tool's own UTC "yesterday" computation, kept independent so the test doesn't just echo the implementation. */
function yesterdayUtcIsoDate(): string {
  const now = new Date();
  const yesterday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
  );
  return yesterday.toISOString().slice(0, 10);
}

describe('registerWeatherForecastTool', () => {
  it('registers under the weather.forecast dot-notation name', () => {
    const server = { registerTool: jest.fn() };
    registerWeatherForecastTool(server as never, createConfig());
    expect(server.registerTool.mock.calls[0][0]).toBe('weather.forecast');
  });

  it('never mentions the upstream vendor name in its own description', () => {
    const server = { registerTool: jest.fn() };
    registerWeatherForecastTool(server as never, createConfig());
    const config = server.registerTool.mock.calls[0][1] as {
      description: string;
      title: string;
    };
    const urlLike = /https?:\/\/|\b[a-z0-9-]+\.(app|com|io|xyz|dev|net)\b/i;
    expect(config.description).not.toMatch(urlLike);
    expect(config.title).not.toMatch(urlLike);
  });
});

describe('weather.forecast execute', () => {
  const configWithKey = createConfig({
    WEATHERAPI_KEY: 'test-key',
    WEATHERAPI_BASE_URL: 'https://api.weatherapi.com/v1',
  });
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('rejects a missing q without calling the provider', async () => {
    global.fetch = jest.fn();
    const result = await execute(configWithKey, { action: 'current' });
    expect(result.isError).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only q without calling the provider', async () => {
    global.fetch = jest.fn();
    const result = await execute(configWithKey, {
      action: 'current',
      q: '   ',
    });
    expect(result.isError).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns WEATHERAPI_KEY_REQUIRED as a non-error result when the key is unset', async () => {
    global.fetch = jest.fn();
    const result = await execute(createConfig(), {
      action: 'current',
      q: 'Paris',
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(
      expect.objectContaining({ error: 'WEATHERAPI_KEY_REQUIRED' }),
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns WEATHERAPI_BASE_URL_REQUIRED as a non-error result when the base URL is unset', async () => {
    global.fetch = jest.fn();
    const result = await execute(createConfig({ WEATHERAPI_KEY: 'test-key' }), {
      action: 'current',
      q: 'Paris',
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(
      expect.objectContaining({ error: 'WEATHERAPI_BASE_URL_REQUIRED' }),
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects astronomy without a date, without calling the provider', async () => {
    global.fetch = jest.fn();
    const result = await execute(configWithKey, {
      action: 'astronomy',
      q: 'Paris',
    });
    expect(result.isError).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects history with a malformed date, without calling the provider', async () => {
    global.fetch = jest.fn();
    const result = await execute(configWithKey, {
      action: 'history',
      q: 'Paris',
      date: '08-20-2026',
    });
    expect(result.isError).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects a well-formatted history date that is not yesterday (UTC), without calling the provider', async () => {
    global.fetch = jest.fn();
    const result = await execute(configWithKey, {
      action: 'history',
      q: 'Paris',
      date: '2000-01-01',
    });
    expect(result.isError).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("dispatches history to /history.json using yesterday's UTC date", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(weatherApiResponse({ forecast: {} }));
    const yesterday = yesterdayUtcIsoDate();
    const result = await execute(configWithKey, {
      action: 'history',
      q: 'Paris',
      date: yesterday,
    });

    expect(result.isError).toBeUndefined();
    const requestedUrl = new URL(
      (global.fetch as jest.Mock).mock.calls[0][0] as string,
    );
    expect(requestedUrl.pathname).toBe('/v1/history.json');
    expect(requestedUrl.searchParams.get('dt')).toBe(yesterday);
  });

  it('dispatches current to /current.json with the key and q set', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(weatherApiResponse({ location: {}, current: {} }));
    await execute(configWithKey, { action: 'current', q: 'Paris' });

    const requestedUrl = new URL(
      (global.fetch as jest.Mock).mock.calls[0][0] as string,
    );
    expect(requestedUrl.pathname).toBe('/v1/current.json');
    expect(requestedUrl.searchParams.get('key')).toBe('test-key');
    expect(requestedUrl.searchParams.get('q')).toBe('Paris');
  });

  it('passes days/aqi/alerts through for forecast', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(weatherApiResponse({ forecast: {} }));
    await execute(configWithKey, {
      action: 'forecast',
      q: 'Paris',
      days: 3,
      aqi: true,
      alerts: true,
    });

    const requestedUrl = new URL(
      (global.fetch as jest.Mock).mock.calls[0][0] as string,
    );
    expect(requestedUrl.pathname).toBe('/v1/forecast.json');
    expect(requestedUrl.searchParams.get('days')).toBe('3');
    expect(requestedUrl.searchParams.get('aqi')).toBe('yes');
    expect(requestedUrl.searchParams.get('alerts')).toBe('yes');
  });

  it('dispatches astronomy to /astronomy.json with dt set from date', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(weatherApiResponse({ astronomy: {} }));
    await execute(configWithKey, {
      action: 'astronomy',
      q: 'Paris',
      date: '2026-08-19',
    });

    const requestedUrl = new URL(
      (global.fetch as jest.Mock).mock.calls[0][0] as string,
    );
    expect(requestedUrl.pathname).toBe('/v1/astronomy.json');
    expect(requestedUrl.searchParams.get('dt')).toBe('2026-08-19');
  });

  it('returns the raw provider payload as structuredContent on success', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(weatherApiResponse({ location: { name: 'Paris' } }));
    const result = await execute(configWithKey, {
      action: 'search',
      q: 'Paris',
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ location: { name: 'Paris' } });
  });

  it("wraps a bare array response (search.json's real shape) as { data }", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        weatherApiResponse([{ name: 'Paris' }, { name: 'Paris, TX' }]),
      );
    const result = await execute(configWithKey, { action: 'search', q: 'Par' });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      data: [{ name: 'Paris' }, { name: 'Paris, TX' }],
    });
  });

  it('surfaces a provider error payload as a non-error result carrying the error code', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      weatherApiResponse(
        {
          error: {
            code: 2007,
            message: 'API key has exceeded calls per month quota.',
          },
        },
        { ok: false, status: 403 },
      ),
    );
    const result = await execute(configWithKey, {
      action: 'current',
      q: 'Paris',
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      error: 'WEATHER_PROVIDER_ERROR',
      code: 2007,
      message: 'API key has exceeded calls per month quota.',
    });
  });

  it('surfaces a network failure as an error field, not a thrown exception', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout'));
    const result = await execute(configWithKey, {
      action: 'marine',
      q: 'Paris',
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      error: 'WEATHER_REQUEST_FAILED',
      message: 'timeout',
    });
  });

  it('classifies a non-JSON error body as a provider error, not a request failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.reject(new SyntaxError('Unexpected token in JSON')),
    });
    const result = await execute(configWithKey, {
      action: 'current',
      q: 'Paris',
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      error: 'WEATHER_PROVIDER_ERROR',
      message: 'Weather request failed with status 503.',
    });
  });

  it('rejects an out-of-enum action instead of returning undefined', async () => {
    global.fetch = jest.fn();
    const result = await execute(configWithKey, {
      action: 'unsupported-action',
      q: 'Paris',
    });
    expect(result.isError).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
