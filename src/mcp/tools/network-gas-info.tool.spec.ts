import { ConfigService } from '@nestjs/config';
import { execute, registerGasInfoTool } from './network-gas-info.tool';
import * as gasIntegration from '../integrations/gas.integration';

function createConfig(overrides: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string, defaultValue?: string) =>
      overrides[key] ?? defaultValue ?? '',
  } as ConfigService;
}

describe('registerGasInfoTool', () => {
  it('registers under the network.gas_info dot-notation name', () => {
    const server = { registerTool: jest.fn() };
    registerGasInfoTool(server as never, createConfig());
    expect(server.registerTool.mock.calls[0][0]).toBe('network.gas_info');
  });
});

describe('network.gas_info execute', () => {
  afterEach(() => jest.restoreAllMocks());

  it('rejects an invalid chain', async () => {
    const result = await execute(createConfig(), 'bitcoin');
    expect(result).toEqual({
      error: 'INVALID_CHAIN',
      message: expect.stringContaining('Unknown chain "bitcoin"'),
    });
  });

  it('returns fetched gas info for a valid chain', async () => {
    jest.spyOn(gasIntegration, 'fetchGasInfo').mockResolvedValue({
      chain: 'base',
      gasPrice: '1000000000',
      gasPriceGwei: '1',
      maxFeePerGas: '2000000000',
      maxPriorityFeePerGas: '100000000',
      supportsEip1559: true,
      timestamp: 1_700_000_000_000,
    });

    const result = await execute(createConfig(), 'base');
    expect(result).toEqual(
      expect.objectContaining({
        chain: 'base',
        gasPriceGwei: '1',
        supportsEip1559: true,
      }),
    );
  });

  it('surfaces an RPC failure as an error field', async () => {
    jest
      .spyOn(gasIntegration, 'fetchGasInfo')
      .mockRejectedValue(new Error('rpc exploded'));

    const result = await execute(createConfig(), 'base');
    expect(result).toEqual({
      chain: 'base',
      error: 'RPC_FAILED',
      message: 'rpc exploded',
    });
  });
});
