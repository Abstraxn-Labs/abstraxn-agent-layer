import { ConfigService } from '@nestjs/config';
import { execute, registerTravelSearchTool } from './travel-search.tool';
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

describe('registerTravelSearchTool', () => {
  it('registers under the travel.search dot-notation name', () => {
    const server = { registerTool: jest.fn() };
    registerTravelSearchTool(
      server as never,
      createConfig(),
      asWalletTrackingService(createWalletTrackingMock()),
    );
    expect(server.registerTool.mock.calls[0][0]).toBe('travel.search');
  });

  it('never mentions the upstream vendor name in its own description', () => {
    const server = { registerTool: jest.fn() };
    registerTravelSearchTool(
      server as never,
      createConfig(),
      asWalletTrackingService(createWalletTrackingMock()),
    );
    const config = server.registerTool.mock.calls[0][1] as {
      description: string;
    };
    expect(config.description).not.toMatch(
      /https?:\/\/|\b[a-z0-9-]+\.(app|com|io|xyz|dev|net)\b/i,
    );
  });
});

describe('travel.search execute', () => {
  const config = createConfig();
  let walletTracking: ReturnType<typeof createWalletTrackingMock>;
  let getSpy: jest.SpyInstance;

  beforeEach(() => {
    walletTracking = createWalletTrackingMock();
    getSpy = jest.spyOn(x402Relay, 'callUpstreamRelayEndpoint');
  });

  afterEach(() => jest.restoreAllMocks());

  it('rejects flight_search missing required fields', async () => {
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        action: 'flight_search',
      },
    );
    expect(result.isError).toBe(true);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('dispatches flight_search to GET /api/travel/flights', async () => {
    getSpy.mockResolvedValue({ status: 'ok', result: { flights: [] } });
    await execute(config, asWalletTrackingService(walletTracking), {
      action: 'flight_search',
      origin: 'JFK',
      destination: 'LAX',
      departureDate: '2026-09-01',
    });
    expect(getSpy).toHaveBeenCalledWith(
      config,
      '/api/travel/flights',
      expect.objectContaining({
        origin: 'JFK',
        destination: 'LAX',
        departureDate: '2026-09-01',
      }),
      { paymentPayload: undefined },
    );
  });

  it('rejects hotel_search missing required fields', async () => {
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        action: 'hotel_search',
        q: 'Paris',
      },
    );
    expect(result.isError).toBe(true);
  });

  it('dispatches hotel_search to GET /api/travel/hotels', async () => {
    getSpy.mockResolvedValue({ status: 'ok', result: { hotels: [] } });
    await execute(config, asWalletTrackingService(walletTracking), {
      action: 'hotel_search',
      q: 'Paris',
      checkInDate: '2026-09-01',
      checkOutDate: '2026-09-03',
    });
    expect(getSpy).toHaveBeenCalledWith(
      config,
      '/api/travel/hotels',
      expect.objectContaining({ q: 'Paris' }),
      { paymentPayload: undefined },
    );
  });

  it('records the paid call when a paymentPayload is supplied', async () => {
    getSpy.mockResolvedValue({ status: 'ok', result: { hotels: [] } });
    const paymentPayload = { x402Version: 2, accepted: {}, payload: {} };
    await execute(config, asWalletTrackingService(walletTracking), {
      action: 'hotel_search',
      q: 'Paris',
      checkInDate: '2026-09-01',
      checkOutDate: '2026-09-03',
      paymentPayload,
    });
    expect(walletTracking.recordPaidCall).toHaveBeenCalledWith({
      toolName: 'travel.search',
      paymentPayload,
    });
  });
});
