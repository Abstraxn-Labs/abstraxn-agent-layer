import { ConfigService } from '@nestjs/config';
import { execute, registerWeb3LookupTool } from './web3-lookup.tool';
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

describe('registerWeb3LookupTool', () => {
  it('registers under the web3.lookup dot-notation name', () => {
    const server = { registerTool: jest.fn() };
    registerWeb3LookupTool(
      server as never,
      createConfig(),
      asWalletTrackingService(createWalletTrackingMock()),
    );
    expect(server.registerTool.mock.calls[0][0]).toBe('web3.lookup');
  });

  it('never mentions the upstream vendor name in its own description', () => {
    const server = { registerTool: jest.fn() };
    registerWeb3LookupTool(
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

describe('web3.lookup execute', () => {
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

  it('rejects wallet_balances without chain/address', async () => {
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        action: 'wallet_balances',
      },
    );
    expect(result.isError).toBe(true);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('dispatches wallet_balances to POST /api/wallet/balances', async () => {
    postSpy.mockResolvedValue({ status: 'ok', result: { balances: [] } });
    await execute(config, asWalletTrackingService(walletTracking), {
      action: 'wallet_balances',
      chain: 'ethereum',
      address: '0xabc',
    });
    expect(postSpy).toHaveBeenCalledWith(
      config,
      '/api/wallet/balances',
      { chain: 'ethereum', address: '0xabc' },
      { paymentPayload: undefined },
    );
  });

  it('dispatches ens_resolve to GET /api/ens/resolve', async () => {
    getSpy.mockResolvedValue({ status: 'ok', result: { address: '0xabc' } });
    await execute(config, asWalletTrackingService(walletTracking), {
      action: 'ens_resolve',
      name: 'vitalik.eth',
    });
    expect(getSpy).toHaveBeenCalledWith(
      config,
      '/api/ens/resolve',
      { name: 'vitalik.eth' },
      { paymentPayload: undefined },
    );
  });

  it('rejects tx_simulate missing required fields', async () => {
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        action: 'tx_simulate',
        network_id: '8453',
      },
    );
    expect(result.isError).toBe(true);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('records the paid call when a paymentPayload is supplied', async () => {
    getSpy.mockResolvedValue({ status: 'ok', result: { address: '0xabc' } });
    const paymentPayload = { x402Version: 2, accepted: {}, payload: {} };
    await execute(config, asWalletTrackingService(walletTracking), {
      action: 'ens_resolve',
      name: 'vitalik.eth',
      paymentPayload,
    });
    expect(walletTracking.recordPaidCall).toHaveBeenCalledWith({
      toolName: 'web3.lookup',
      paymentPayload,
    });
  });

  it('surfaces a paymentRequired challenge as a non-error result', async () => {
    getSpy.mockResolvedValue({
      status: 'paymentRequired',
      paymentRequired: { x402Version: 2 },
    });
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        action: 'ens_resolve',
        name: 'vitalik.eth',
      },
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      paymentRequired: { x402Version: 2 },
    });
  });
});
