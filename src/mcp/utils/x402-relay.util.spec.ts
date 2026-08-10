import { ConfigService } from '@nestjs/config';
import {
  callUpstreamRelayEndpoint,
  callUpstreamRelayEndpointJson,
  resolveUpstreamRelayBaseUrl,
} from './x402-relay.util';

jest.mock('@x402/core/http', () => ({
  decodePaymentRequiredHeader: jest.fn(),
  encodePaymentSignatureHeader: jest.fn(() => 'encoded-signature'),
}));

const { decodePaymentRequiredHeader } = jest.requireMock('@x402/core/http');

function createConfig(overrides: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string, defaultValue?: string) =>
      overrides[key] ?? defaultValue ?? '',
  } as ConfigService;
}

describe('resolveUpstreamRelayBaseUrl', () => {
  it('throws when UPSTREAM_RELAY_BASE_URL is not configured', () => {
    expect(() => resolveUpstreamRelayBaseUrl(createConfig())).toThrow(
      /UPSTREAM_RELAY_BASE_URL is not set/,
    );
  });

  it('honors an env override', () => {
    expect(
      resolveUpstreamRelayBaseUrl(
        createConfig({ UPSTREAM_RELAY_BASE_URL: 'https://relay.example' }),
      ),
    ).toBe('https://relay.example');
  });
});

describe('callUpstreamRelayEndpoint', () => {
  const config = createConfig({
    UPSTREAM_RELAY_BASE_URL: 'https://relay.example',
  });
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('returns ok with the parsed JSON body on a 200 response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Headers(),
      json: () => Promise.resolve({ hello: 'world' }),
    });

    const result = await callUpstreamRelayEndpoint(
      config,
      '/api/crypto/trending',
      {},
      {},
    );
    expect(result).toEqual({ status: 'ok', result: { hello: 'world' } });
  });

  it('decodes a 402 PAYMENT-REQUIRED header into a paymentRequired result', async () => {
    const challenge = { x402Version: 2, accepts: [] };
    decodePaymentRequiredHeader.mockReturnValue(challenge);
    const headers = new Headers({ 'PAYMENT-REQUIRED': 'encoded-challenge' });
    global.fetch = jest.fn().mockResolvedValue({
      status: 402,
      ok: false,
      headers,
      json: () => Promise.resolve({}),
    });

    const result = await callUpstreamRelayEndpoint(
      config,
      '/api/crypto/trending',
      {},
      {},
    );
    expect(result).toEqual({
      status: 'paymentRequired',
      paymentRequired: challenge,
    });
    expect(decodePaymentRequiredHeader).toHaveBeenCalledWith(
      'encoded-challenge',
    );
  });

  it('never leaks the configured upstream host in the paymentRequired challenge', async () => {
    // Uses the same host as `config` above (relay.example, not a real vendor) — redaction is
    // driven entirely by whatever UPSTREAM_RELAY_BASE_URL resolves to at request time, never by
    // a hardcoded vendor name, so a placeholder host here proves the same thing a real one would.
    const challenge = {
      x402Version: 2,
      resource: {
        url: 'https://relay.example/api/crypto/trending',
        description: 'Trending coins',
      },
      accepts: [
        {
          scheme: 'exact',
          network: 'eip155:8453',
          extra: { note: 'billed via relay.example support desk' },
        },
      ],
    };
    decodePaymentRequiredHeader.mockReturnValue(challenge);
    const headers = new Headers({ 'PAYMENT-REQUIRED': 'encoded-challenge' });
    global.fetch = jest.fn().mockResolvedValue({
      status: 402,
      ok: false,
      headers,
      json: () => Promise.resolve({}),
    });

    const result = await callUpstreamRelayEndpoint(
      config,
      '/api/crypto/trending',
      {},
      {},
    );

    expect(result.status).toBe('paymentRequired');
    const serialized = JSON.stringify(result);
    expect(serialized.toLowerCase()).not.toContain('relay.example');
    if (result.status === 'paymentRequired') {
      expect(result.paymentRequired.resource?.url).toBe('/api/crypto/trending');
      expect(result.paymentRequired.accepts[0].extra?.note).toBe(
        'billed via [upstream] support desk',
      );
    }
  });

  it('returns an error when a 402 has no decodable challenge header', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 402,
      ok: false,
      headers: new Headers(),
      json: () => Promise.resolve({}),
    });

    const result = await callUpstreamRelayEndpoint(
      config,
      '/api/crypto/trending',
      {},
      {},
    );
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.error).toBe('UPSTREAM_PAYMENT_CHALLENGE_UNDECODABLE');
    }
  });

  it('returns an error for a non-2xx, non-402 response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 500,
      ok: false,
      headers: new Headers(),
      text: () => Promise.resolve('upstream exploded'),
    });

    const result = await callUpstreamRelayEndpoint(
      config,
      '/api/crypto/trending',
      {},
      {},
    );
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.error).toBe('UPSTREAM_RELAY_ERROR');
      expect(result.error.message).toContain('upstream exploded');
    }
  });

  it('returns an error when fetch itself throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

    const result = await callUpstreamRelayEndpoint(
      config,
      '/api/crypto/trending',
      {},
      {},
    );
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.error).toBe('UPSTREAM_RELAY_CALL_FAILED');
    }
  });

  it('drops undefined/null/empty query params but keeps real values', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Headers(),
      json: () => Promise.resolve({}),
    });
    global.fetch = fetchMock;

    await callUpstreamRelayEndpoint(
      config,
      '/api/crypto/price',
      {
        ids: 'bitcoin',
        currencies: undefined,
        include_24h: null,
        include_mcap: '',
      },
      {},
    );

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get('ids')).toBe('bitcoin');
    expect(calledUrl.searchParams.has('currencies')).toBe(false);
    expect(calledUrl.searchParams.has('include_24h')).toBe(false);
    expect(calledUrl.searchParams.has('include_mcap')).toBe(false);
  });
});

describe('callUpstreamRelayEndpointJson', () => {
  const config = createConfig({
    UPSTREAM_RELAY_BASE_URL: 'https://relay.example',
  });
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('POSTs a JSON body and attaches PAYMENT-SIGNATURE for a v2 payload', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Headers(),
      json: () => Promise.resolve({ ok: true }),
    });
    global.fetch = fetchMock;

    const paymentPayload = {
      x402Version: 2,
      accepted: {},
      payload: {},
    } as never;
    await callUpstreamRelayEndpointJson(
      config,
      '/api/token/prices',
      { tokens: [] },
      { paymentPayload },
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['PAYMENT-SIGNATURE']).toBe('encoded-signature');
    expect(JSON.parse(init.body)).toEqual({ tokens: [] });
  });
});
