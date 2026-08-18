import { ConfigService } from '@nestjs/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServerFactory } from './mcp-server.factory';
import { WalletTrackingService } from './services/wallet-tracking.service';

const EXPECTED_TOOL_NAMES = [
  'network.blocknumber',
  'network.transaction_status',
  'network.gas_info',
  'network.token_info',
  'network.token_price',
  'network.prepare_transfer',
  'market.crypto',
  'web3.lookup',
  'travel.search',
  'places.lookup',
  'social.profile_lookup',
];

function createConfig(): ConfigService {
  return {
    get: (_key: string, defaultValue?: string) => defaultValue ?? '',
  } as ConfigService;
}

function createWalletTrackingMock(): WalletTrackingService {
  return {
    recordPaidCall: jest.fn().mockResolvedValue(undefined),
  } as unknown as WalletTrackingService;
}

describe('McpServerFactory (SDK-level integration)', () => {
  let client: Client;
  const originalFetch = global.fetch;

  afterEach(async () => {
    await client?.close();
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  async function connectClient(): Promise<Client> {
    const factory = new McpServerFactory(
      createConfig(),
      createWalletTrackingMock(),
    );
    const server = factory.create();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    const newClient = new Client({ name: 'test-client', version: '1.0.0' });
    await newClient.connect(clientTransport);
    return newClient;
  }

  it('lists exactly the 11 expected dot-notation tool names', async () => {
    client = await connectClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [...EXPECTED_TOOL_NAMES].sort(),
    );
  });

  it('never exposes a vendor URL/domain in any tool name or description', async () => {
    // This repo is public — tool copy must never embed a raw domain, so a regression here
    // (a vendor name, or any URL) would leak whichever upstream is configured at the time.
    client = await connectClient();
    const { tools } = await client.listTools();
    const urlLike = /https?:\/\/|\b[a-z0-9-]+\.(app|com|io|xyz|dev|net)\b/i;
    for (const tool of tools) {
      expect(tool.name).not.toMatch(urlLike);
      expect(tool.description ?? '').not.toMatch(urlLike);
    }
  });

  it('round-trips a real tools/call for the free network.token_price tool', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ethereum: { usd: 3000 } }),
    });

    client = await connectClient();
    const result = await client.callTool({
      name: 'network.token_price',
      arguments: { symbol: 'ethereum' },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(
      expect.objectContaining({ symbol: 'ethereum', price: 3000 }),
    );
  });

  it('returns an isError result for an unknown tool name', async () => {
    client = await connectClient();
    const result = await client.callTool({
      name: 'not.a.real.tool',
      arguments: {},
    });
    expect(result.isError).toBe(true);
  });
});
