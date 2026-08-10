import { ConfigService } from '@nestjs/config';
import { execute, registerTokenInfoTool } from './network-token-info.tool';
import * as tokenInfoIntegration from '../integrations/token-info.integration';

function createConfig(): ConfigService {
  return {
    get: (_key: string, defaultValue?: string) => defaultValue ?? '',
  } as ConfigService;
}

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

describe('registerTokenInfoTool', () => {
  it('registers under the network.token_info dot-notation name', () => {
    const server = { registerTool: jest.fn() };
    registerTokenInfoTool(server as never, createConfig());
    expect(server.registerTool.mock.calls[0][0]).toBe('network.token_info');
  });
});

describe('network.token_info execute', () => {
  afterEach(() => jest.restoreAllMocks());

  it('rejects an invalid chain', async () => {
    const result = await execute(createConfig(), 'bitcoin', 'USDC');
    expect(result).toEqual(expect.objectContaining({ error: 'INVALID_CHAIN' }));
  });

  it('rejects a missing token', async () => {
    const result = await execute(createConfig(), 'base', '   ');
    expect(result).toEqual(expect.objectContaining({ error: 'MISSING_TOKEN' }));
  });

  it('rejects an unresolvable symbol on a chain with no configured lookup', async () => {
    const result = await execute(createConfig(), 'monad', 'USDC');
    expect(result).toEqual(
      expect.objectContaining({ error: 'INVALID_TOKEN', chain: 'monad' }),
    );
  });

  it('resolves the USDC symbol on base and returns fetched metadata', async () => {
    jest.spyOn(tokenInfoIntegration, 'fetchTokenInfo').mockResolvedValue({
      chain: 'base',
      tokenAddress: USDC_BASE,
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      totalSupply: '1000000',
      totalSupplyFormatted: '1.0',
      timestamp: 1_700_000_000_000,
    });

    const result = await execute(createConfig(), 'base', 'USDC');
    expect(tokenInfoIntegration.fetchTokenInfo).toHaveBeenCalledWith(
      expect.any(String),
      'base',
      USDC_BASE,
    );
    expect(result).toEqual(
      expect.objectContaining({ symbol: 'USDC', decimals: 6 }),
    );
  });

  it('accepts a raw contract address directly', async () => {
    jest.spyOn(tokenInfoIntegration, 'fetchTokenInfo').mockResolvedValue({
      chain: 'base',
      tokenAddress: USDC_BASE,
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      totalSupply: '1',
      totalSupplyFormatted: '0.000001',
      timestamp: 0,
    });

    const result = await execute(createConfig(), 'base', USDC_BASE);
    expect(result).toEqual(
      expect.objectContaining({ tokenAddress: USDC_BASE }),
    );
  });

  it('surfaces an RPC failure as an error field', async () => {
    jest
      .spyOn(tokenInfoIntegration, 'fetchTokenInfo')
      .mockRejectedValue(new Error('rpc down'));

    const result = await execute(createConfig(), 'base', 'USDC');
    expect(result).toEqual(
      expect.objectContaining({ error: 'RPC_FAILED', message: 'rpc down' }),
    );
  });
});
