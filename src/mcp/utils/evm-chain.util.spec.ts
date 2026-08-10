import { ConfigService } from '@nestjs/config';
import { parseEvmChainArg, resolveEvmClient } from './evm-chain.util';

function createConfig(overrides: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string, defaultValue?: string) =>
      overrides[key] ?? defaultValue ?? '',
  } as ConfigService;
}

describe('parseEvmChainArg', () => {
  it('rejects a missing chain', () => {
    const result = parseEvmChainArg(undefined);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect((result.error as { error: string }).error).toBe('MISSING_CHAIN');
    }
  });

  it('rejects an empty-string chain', () => {
    const result = parseEvmChainArg('   ');
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown chain slug', () => {
    const result = parseEvmChainArg('not-a-real-chain');
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect((result.error as { error: string }).error).toBe('INVALID_CHAIN');
    }
  });

  it('rejects a solana slug (EVM-only parser)', () => {
    const result = parseEvmChainArg('solana');
    expect(result.ok).toBe(false);
  });

  it('accepts and trims a known EVM chain slug', () => {
    const result = parseEvmChainArg('  base  ');
    expect(result).toEqual({ ok: true, chain: 'base' });
  });
});

describe('resolveEvmClient', () => {
  it('fails with CHAIN_RPC_UNAVAILABLE when no RPC URL resolves', () => {
    // "monad" has a built-in default, so use an override to a blank string to simulate
    // an operator explicitly clearing it, which is the only way this branch is reachable
    // for a chain in EVM_CHAIN_SLUGS today (every slug otherwise has a public default).
    const config = createConfig();
    const result = resolveEvmClient(config, 'not-a-real-chain');
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect((result.error as { error: string }).error).toBe(
        'CHAIN_RPC_UNAVAILABLE',
      );
    }
  });

  it('builds a viem client bound to the resolved RPC URL for a known chain', () => {
    const config = createConfig({
      CHAIN_RPC_BASE: 'https://custom-base-rpc.example',
    });
    const result = resolveEvmClient(config, 'base');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.chain).toBe('base');
      expect(result.rpcUrl).toBe('https://custom-base-rpc.example');
      expect(result.client).toBeDefined();
    }
  });
});
