import { ConfigService } from '@nestjs/config';
import { execute, registerMarketCryptoTool } from './market-crypto.tool';
import * as x402Relay from '../utils/x402-relay.util';
import { WalletTrackingService } from '../services/wallet-tracking.service';

function createConfig(): ConfigService {
  return {
    get: (_key: string, defaultValue?: string) => defaultValue ?? '',
  } as ConfigService;
}

function createWalletTrackingMock() {
  return { recordPaidCall: jest.fn().mockResolvedValue(undefined) };
}

function asWalletTrackingService(
  mock: ReturnType<typeof createWalletTrackingMock>,
): WalletTrackingService {
  return mock as unknown as WalletTrackingService;
}

describe('registerMarketCryptoTool', () => {
  it('registers under the market.crypto dot-notation name', () => {
    const server = { registerTool: jest.fn() };
    registerMarketCryptoTool(
      server as never,
      createConfig(),
      asWalletTrackingService(createWalletTrackingMock()),
    );
    expect(server.registerTool.mock.calls[0][0]).toBe('market.crypto');
  });

  it('never mentions the upstream vendor name in its own description', () => {
    const server = { registerTool: jest.fn() };
    registerMarketCryptoTool(
      server as never,
      createConfig(),
      asWalletTrackingService(createWalletTrackingMock()),
    );
    const config = server.registerTool.mock.calls[0][1] as {
      description: string;
      title: string;
    };
    const urlLike = /https?:\/\/|\b[a-z0-9-]+\.(app|com|io|xyz|dev|net)\b/i;
    expect(config.description).not.toMatch(urlLike);
    expect(config.title).not.toMatch(urlLike);
  });
});

describe('market.crypto execute', () => {
  const config = createConfig();
  let walletTracking: ReturnType<typeof createWalletTrackingMock>;
  let getSpy: jest.SpyInstance;
  let postSpy: jest.SpyInstance;

  beforeEach(() => {
    walletTracking = createWalletTrackingMock();
    getSpy = jest.spyOn(x402Relay, 'callUpstreamRelayEndpoint');
    postSpy = jest.spyOn(x402Relay, 'callUpstreamRelayEndpointJson');
  });

  afterEach(() => jest.restoreAllMocks());

  it('rejects search without q, without calling upstream', async () => {
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        action: 'search',
      },
    );
    expect(result.isError).toBe(true);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('dispatches search to GET /api/crypto/search', async () => {
    getSpy.mockResolvedValue({ status: 'ok', result: { coins: [] } });
    await execute(config, asWalletTrackingService(walletTracking), {
      action: 'search',
      q: 'btc',
    });
    expect(getSpy).toHaveBeenCalledWith(
      config,
      '/api/crypto/search',
      { q: 'btc' },
      { paymentPayload: undefined },
    );
  });

  it('dispatches token_prices to POST /api/token/prices', async () => {
    postSpy.mockResolvedValue({ status: 'ok', result: [] });
    const tokens = [{ chain: 'base', token_address: '0xabc' }];
    await execute(config, asWalletTrackingService(walletTracking), {
      action: 'token_prices',
      tokens,
    });
    expect(postSpy).toHaveBeenCalledWith(
      config,
      '/api/token/prices',
      { tokens },
      { paymentPayload: undefined },
    );
  });

  it('rejects an empty tokens array for token_prices without calling upstream', async () => {
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        action: 'token_prices',
        tokens: [],
      },
    );
    expect(result.isError).toBe(true);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('surfaces a paymentRequired challenge as a non-error result', async () => {
    getSpy.mockResolvedValue({
      status: 'paymentRequired',
      paymentRequired: { x402Version: 2, accepts: [] },
    });
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        action: 'trending',
      },
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      paymentRequired: { x402Version: 2, accepts: [] },
    });
    expect(walletTracking.recordPaidCall).not.toHaveBeenCalled();
  });

  it('surfaces an upstream error as isError', async () => {
    getSpy.mockResolvedValue({
      status: 'error',
      error: { error: 'UPSTREAM_RELAY_ERROR', message: 'boom' },
    });
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        action: 'trending',
      },
    );
    expect(result.isError).toBe(true);
  });

  it('records the paid call and passes through the result when a paymentPayload is supplied', async () => {
    getSpy.mockResolvedValue({ status: 'ok', result: { coins: ['btc'] } });
    const paymentPayload = { x402Version: 2, accepted: {}, payload: {} };
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        action: 'trending',
        paymentPayload,
      },
    );

    expect(walletTracking.recordPaidCall).toHaveBeenCalledWith({
      toolName: 'market.crypto',
      paymentPayload,
    });
    expect(result.structuredContent).toEqual({ coins: ['btc'] });
  });

  it('wraps a non-object upstream result (e.g. an array) as { data }', async () => {
    getSpy.mockResolvedValue({ status: 'ok', result: ['btc', 'eth'] });
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        action: 'trending',
      },
    );
    expect(result.structuredContent).toEqual({ data: ['btc', 'eth'] });
  });
});
