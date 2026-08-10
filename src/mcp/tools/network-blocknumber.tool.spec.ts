import { ConfigService } from '@nestjs/config';
import { execute, registerBlocknumberTool } from './network-blocknumber.tool';

function createConfig(overrides: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string, defaultValue?: string) =>
      overrides[key] ?? defaultValue ?? '',
  } as ConfigService;
}

function jsonRpcResponse(result: unknown) {
  return { json: () => Promise.resolve({ result }) } as Response;
}

describe('registerBlocknumberTool', () => {
  it('registers under the network.blocknumber dot-notation name', () => {
    const server = { registerTool: jest.fn() };
    registerBlocknumberTool(server as never, createConfig());
    expect(server.registerTool.mock.calls[0][0]).toBe('network.blocknumber');
  });
});

describe('network.blocknumber execute', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns UNSUPPORTED_CHAIN for a chain that is neither EVM nor Solana', async () => {
    const result = await execute(createConfig(), 'not-a-real-chain');
    expect(result).toEqual({
      error: 'UNSUPPORTED_CHAIN',
      message: 'not-a-real-chain',
    });
  });

  it('fetches the EVM block number and returns hex + decimal', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonRpcResponse('0x2a'));

    const result = await execute(createConfig(), 'base');
    expect(result).toEqual({
      chain: 'base',
      blockNumber: '0x2a',
      blockNumberDecimal: '42',
    });
  });

  it('fetches the Solana slot', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonRpcResponse(1234));

    const result = await execute(createConfig(), 'solana');
    expect(result).toEqual({ chain: 'solana', slot: 1234 });
  });

  it('queries every resolvable chain when chain is omitted', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonRpcResponse('0x1'));

    const result = (await execute(createConfig(), undefined)) as {
      blocks: Record<string, unknown>;
    };
    expect(result.blocks.base).toBeDefined();
    expect(result.blocks.solana).toBeDefined();
    expect(result.blocks['solana-devnet']).toBeDefined();
  });

  it('treats "all" the same as omitting chain', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonRpcResponse('0x1'));

    const result = (await execute(createConfig(), 'all')) as {
      blocks: Record<string, unknown>;
    };
    expect(result.blocks.ethereum).toBeDefined();
  });

  it('surfaces an RPC failure as an error field, not a thrown exception', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout'));

    const result = await execute(createConfig(), 'base');
    expect(result).toEqual({ chain: 'base', error: 'RPC failed: timeout' });
  });
});
