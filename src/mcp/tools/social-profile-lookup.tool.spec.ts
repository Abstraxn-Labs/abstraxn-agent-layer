import { ConfigService } from '@nestjs/config';
import {
  execute,
  registerSocialProfileLookupTool,
} from './social-profile-lookup.tool';
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

describe('registerSocialProfileLookupTool', () => {
  it('registers under the social.profile_lookup dot-notation name', () => {
    const server = { registerTool: jest.fn() };
    registerSocialProfileLookupTool(
      server as never,
      createConfig(),
      asWalletTrackingService(createWalletTrackingMock()),
    );
    expect(server.registerTool.mock.calls[0][0]).toBe('social.profile_lookup');
  });

  it('never mentions an upstream vendor name in its own description', () => {
    const server = { registerTool: jest.fn() };
    registerSocialProfileLookupTool(
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
    expect(config.description.toLowerCase()).not.toContain('stableenrich');
  });
});

describe('social.profile_lookup execute', () => {
  const config = createConfig();
  let walletTracking: ReturnType<typeof createWalletTrackingMock>;
  let postSpy: jest.SpyInstance;

  beforeEach(() => {
    walletTracking = createWalletTrackingMock();
    postSpy = jest.spyOn(x402Relay, 'callEnrichmentRelayEndpointJson');
  });

  afterEach(() => jest.restoreAllMocks());

  it('rejects a missing records array', async () => {
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {},
    );
    expect(result.isError).toBe(true);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('rejects an empty records array', async () => {
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        records: [],
      },
    );
    expect(result.isError).toBe(true);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('rejects a record missing record_id', async () => {
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        records: [{ first_name: 'Ada' }],
      },
    );
    expect(result.isError).toBe(true);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('rejects a record with record_id but no name/email/phone', async () => {
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        records: [{ record_id: 'r1' }],
      },
    );
    expect(result.isError).toBe(true);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('treats an empty emails array as absent', async () => {
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        records: [{ record_id: 'r1', emails: [] }],
      },
    );
    expect(result.isError).toBe(true);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('treats whitespace-only email entries as absent', async () => {
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        records: [{ record_id: 'r1', emails: ['   '] }],
      },
    );
    expect(result.isError).toBe(true);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('accepts a fuzzy-match record (name + email) and dispatches to POST /api/social/profile-lookup', async () => {
    postSpy.mockResolvedValue({ status: 'ok', result: { matches: [] } });
    const records = [
      {
        record_id: 'r1',
        first_name: 'Ada',
        last_name: 'Lovelace',
        emails: ['ada@example.com'],
      },
    ];
    await execute(config, asWalletTrackingService(walletTracking), { records });
    expect(postSpy).toHaveBeenCalledWith(
      config,
      '/api/social/profile-lookup',
      { records, match_condition_fields: undefined },
      { paymentPayload: undefined },
    );
  });

  it('accepts a reverse-lookup record (phone-only, no name)', async () => {
    postSpy.mockResolvedValue({ status: 'ok', result: { matches: [] } });
    const records = [{ record_id: 'r1', phones: ['+15551234567'] }];
    await execute(config, asWalletTrackingService(walletTracking), { records });
    expect(postSpy).toHaveBeenCalledWith(
      config,
      '/api/social/profile-lookup',
      { records, match_condition_fields: undefined },
      { paymentPayload: undefined },
    );
  });

  it('passes match_condition_fields through untouched', async () => {
    postSpy.mockResolvedValue({ status: 'ok', result: { matches: [] } });
    const records = [{ record_id: 'r1', emails: ['ada@example.com'] }];
    await execute(config, asWalletTrackingService(walletTracking), {
      records,
      match_condition_fields: ['linkedin_url'],
    });
    expect(postSpy).toHaveBeenCalledWith(
      config,
      '/api/social/profile-lookup',
      { records, match_condition_fields: ['linkedin_url'] },
      { paymentPayload: undefined },
    );
  });

  it('records the paid call when a paymentPayload is supplied', async () => {
    postSpy.mockResolvedValue({ status: 'ok', result: { matches: [] } });
    const paymentPayload = { x402Version: 2, accepted: {}, payload: {} };
    await execute(config, asWalletTrackingService(walletTracking), {
      records: [{ record_id: 'r1', emails: ['ada@example.com'] }],
      paymentPayload,
    });
    expect(walletTracking.recordPaidCall).toHaveBeenCalledWith({
      toolName: 'social.profile_lookup',
      paymentPayload,
    });
  });

  it('surfaces a paymentRequired challenge as a non-error result', async () => {
    postSpy.mockResolvedValue({
      status: 'paymentRequired',
      paymentRequired: { x402Version: 2 },
    });
    const result = await execute(
      config,
      asWalletTrackingService(walletTracking),
      {
        records: [{ record_id: 'r1', emails: ['ada@example.com'] }],
      },
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      paymentRequired: { x402Version: 2 },
    });
  });
});
