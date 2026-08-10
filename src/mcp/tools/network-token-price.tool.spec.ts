import { execute, registerTokenPriceTool } from './network-token-price.tool';

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('registerTokenPriceTool', () => {
  it('registers under the network.token_price dot-notation name', () => {
    const server = { registerTool: jest.fn() };
    registerTokenPriceTool(server as never);
    expect(server.registerTool.mock.calls[0][0]).toBe('network.token_price');
  });
});

describe('network.token_price execute', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('defaults to ethereum/usd when no arguments are given', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ ethereum: { usd: 3000 } }));

    const result = await execute(undefined, undefined);
    expect(result).toEqual({
      symbol: 'ethereum',
      vsCurrency: 'usd',
      price: 3000,
      source: 'coingecko',
    });
  });

  it('uses a supplied symbol and currency', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ bitcoin: { eur: 60000 } }));

    const result = await execute('BITCOIN', 'EUR');
    expect(result).toEqual({
      symbol: 'bitcoin',
      vsCurrency: 'eur',
      price: 60000,
      source: 'coingecko',
    });
  });

  it('returns PRICE_NOT_FOUND when the API omits the requested price', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({}));

    const result = await execute('doesnotexist', 'usd');
    expect(result).toEqual(
      expect.objectContaining({ error: 'PRICE_NOT_FOUND' }),
    );
  });

  it('returns PRICE_LOOKUP_FAILED on a non-ok HTTP response', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({}, false));

    const result = await execute('ethereum', 'usd');
    expect(result).toEqual(
      expect.objectContaining({ error: 'PRICE_LOOKUP_FAILED' }),
    );
  });

  it('returns PRICE_LOOKUP_FAILED when fetch throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

    const result = await execute('ethereum', 'usd');
    expect(result).toEqual(
      expect.objectContaining({ error: 'PRICE_LOOKUP_FAILED' }),
    );
  });
});
