import { ConfigService } from '@nestjs/config';
import {
  isEvmChainSlug,
  isSolanaChainSlug,
  listResolvableEvmChains,
  resolveEvmRpcUrl,
  resolveSolanaRpcUrl,
} from './chain-registry.util';

function createConfig(overrides: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string, defaultValue?: string) =>
      overrides[key] ?? defaultValue ?? '',
  } as ConfigService;
}

describe('chain-registry.util', () => {
  it('recognizes EVM and Solana slugs', () => {
    expect(isEvmChainSlug('ethereum')).toBe(true);
    expect(isEvmChainSlug('bsc-testnet')).toBe(true);
    expect(isEvmChainSlug('skale-base-sepolia')).toBe(true);
    expect(isSolanaChainSlug('solana-devnet')).toBe(true);
    expect(isEvmChainSlug('solana')).toBe(false);
    expect(isSolanaChainSlug('ethereum')).toBe(false);
  });

  it('resolves default public RPCs when no env override is set', () => {
    const config = createConfig();
    expect(resolveEvmRpcUrl(config, 'base')).toContain('base');
    expect(resolveEvmRpcUrl(config, 'bsc')).toContain('bsc');
    expect(resolveEvmRpcUrl(config, 'monad')).toContain('monad');
  });

  it('prefers an env override over the built-in default', () => {
    const config = createConfig({
      CHAIN_RPC_BASE: 'https://custom-base-rpc.example',
    });
    expect(resolveEvmRpcUrl(config, 'base')).toBe(
      'https://custom-base-rpc.example',
    );
  });

  it('falls back through legacy env vars for sepolia specifically', () => {
    const config = createConfig({
      SEPOLIA_RPC_URL: 'https://legacy-sepolia.example',
    });
    expect(resolveEvmRpcUrl(config, 'sepolia')).toBe(
      'https://legacy-sepolia.example',
    );
  });

  it('returns null for an unknown chain slug', () => {
    const config = createConfig();
    expect(resolveEvmRpcUrl(config, 'not-a-chain')).toBeNull();
  });

  it('lists every EVM chain as resolvable given no config (all have public defaults)', () => {
    const config = createConfig();
    const chains = listResolvableEvmChains(config);
    expect(chains).toEqual(
      expect.arrayContaining([
        'ethereum',
        'base',
        'bsc',
        'monad',
        'skale-base-sepolia',
      ]),
    );
  });

  it('resolves solana mainnet and devnet RPC URLs', () => {
    const config = createConfig();
    expect(resolveSolanaRpcUrl(config, 'solana')).toBe(
      'https://api.mainnet-beta.solana.com',
    );
    expect(resolveSolanaRpcUrl(config, 'solana-devnet')).toBe(
      'https://api.devnet.solana.com',
    );
  });

  it('prefers an env override for solana RPC URLs', () => {
    const config = createConfig({
      SOLANA_RPC_URL: 'https://custom-solana.example',
    });
    expect(resolveSolanaRpcUrl(config, 'solana')).toBe(
      'https://custom-solana.example',
    );
  });
});
