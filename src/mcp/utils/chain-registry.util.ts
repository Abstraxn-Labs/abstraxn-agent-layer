import type { ConfigService } from '@nestjs/config';

/** Solana cluster slugs. */
export const SOLANA_CHAIN_SLUGS = ['solana', 'solana-devnet'] as const;
export type SolanaChainSlug = (typeof SOLANA_CHAIN_SLUGS)[number];

/** EVM chain slugs (excludes Solana). */
export const EVM_CHAIN_SLUGS = [
  'ethereum',
  'sepolia',
  'polygon',
  'amoy',
  'bsc',
  'bsc-testnet',
  'base',
  'base-sepolia',
  'tempo',
  'tempo-testnet',
  'arbitrum-one',
  'monad',
  'skale-base-sepolia',
] as const;
export type EvmChainSlug = (typeof EVM_CHAIN_SLUGS)[number];

/** Every chain `network.blocknumber` can query, plus `all`. */
export const BLOCKNUMBER_CHAIN_ENUM = [
  ...SOLANA_CHAIN_SLUGS,
  ...EVM_CHAIN_SLUGS,
  'all',
] as const;

/** EVM-only chain slugs (excludes `solana`, `solana-devnet`, and `all`). */
export const EVM_CHAIN_ENUM = [...EVM_CHAIN_SLUGS] as const;

const DEFAULT_EVM_RPC: Record<EvmChainSlug, string> = {
  ethereum: 'https://eth.drpc.org',
  sepolia: 'https://sepolia.drpc.org',
  polygon: 'https://polygon-bor.publicnode.com',
  amoy: 'https://polygon-amoy-bor.publicnode.com',
  bsc: 'https://bsc-mainnet.public.blastapi.io',
  'bsc-testnet': 'https://bsc-testnet.rpc.sentio.xyz',
  base: 'https://base.publicnode.com',
  'base-sepolia': 'https://base-sepolia-rpc.publicnode.com',
  tempo: 'https://rpc.mainnet.tempo.xyz',
  'tempo-testnet': 'https://rpc.moderato.tempo.xyz',
  'arbitrum-one': 'https://arbitrum-one.publicnode.com',
  monad: 'https://rpc.monad.xyz',
  'skale-base-sepolia':
    'https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha',
};

const ENV_KEY: Record<EvmChainSlug, string> = {
  ethereum: 'CHAIN_RPC_ETHEREUM',
  sepolia: 'CHAIN_RPC_SEPOLIA',
  polygon: 'CHAIN_RPC_POLYGON',
  amoy: 'CHAIN_RPC_POLYGON_AMOY',
  bsc: 'CHAIN_RPC_BSC',
  'bsc-testnet': 'CHAIN_RPC_BSC_TESTNET',
  base: 'CHAIN_RPC_BASE',
  'base-sepolia': 'CHAIN_RPC_BASE_SEPOLIA',
  tempo: 'CHAIN_RPC_TEMPO',
  'tempo-testnet': 'CHAIN_RPC_TEMPO_TESTNET',
  'arbitrum-one': 'CHAIN_RPC_ARBITRUM_ONE',
  monad: 'CHAIN_RPC_MONAD',
  'skale-base-sepolia': 'CHAIN_RPC_SKALE_BASE_SEPOLIA',
};

const EVM_CHAIN_ORDER: readonly EvmChainSlug[] = [...EVM_CHAIN_SLUGS];

export function isSolanaChainSlug(slug: string): slug is SolanaChainSlug {
  return (SOLANA_CHAIN_SLUGS as readonly string[]).includes(slug);
}

export function isEvmChainSlug(slug: string): slug is EvmChainSlug {
  return (EVM_CHAIN_SLUGS as readonly string[]).includes(slug);
}

/** Sepolia RPC additionally accepts a couple of legacy env var names. */
function resolveSepoliaRpcUrl(configService: ConfigService): string {
  const fromSepolia = configService.get<string>('CHAIN_RPC_SEPOLIA', '').trim();
  if (fromSepolia) {
    return fromSepolia;
  }
  const legacySepolia = configService.get<string>('SEPOLIA_RPC_URL', '').trim();
  if (legacySepolia) {
    return legacySepolia;
  }
  return 'https://ethereum-sepolia-rpc.publicnode.com';
}

export function resolveEvmRpcUrl(
  configService: ConfigService,
  slug: string,
): string | null {
  if (!isEvmChainSlug(slug)) {
    return null;
  }
  if (slug === 'sepolia') {
    return resolveSepoliaRpcUrl(configService);
  }
  const envKey = ENV_KEY[slug];
  const fromEnv = configService.get<string>(envKey, '').trim();
  if (fromEnv) {
    return fromEnv;
  }
  const def = DEFAULT_EVM_RPC[slug]?.trim();
  return def && def.length > 0 ? def : null;
}

/** EVM chains that currently have a usable RPC URL (env override or built-in default). */
export function listResolvableEvmChains(
  configService: ConfigService,
): EvmChainSlug[] {
  return EVM_CHAIN_ORDER.filter(
    (slug) => resolveEvmRpcUrl(configService, slug) !== null,
  );
}

export function resolveSolanaRpcUrl(
  configService: ConfigService,
  slug: SolanaChainSlug = 'solana',
): string {
  if (slug === 'solana-devnet') {
    return (
      configService.get<string>('SOLANA_DEVNET_RPC_URL', '').trim() ||
      'https://api.devnet.solana.com'
    );
  }
  return (
    configService.get<string>('SOLANA_RPC_URL', '').trim() ||
    'https://api.mainnet-beta.solana.com'
  );
}
