import { createPublicClient, defineChain, http, type Chain } from 'viem';

const EVM_CHAIN_ID: Record<string, number> = {
  ethereum: 1,
  sepolia: 11155111,
  polygon: 137,
  amoy: 80002,
  bsc: 56,
  'bsc-testnet': 97,
  base: 8453,
  'base-sepolia': 84532,
  'arbitrum-one': 42161,
  monad: 143,
  tempo: 4217,
  'tempo-testnet': 42431,
  'skale-base-sepolia': 324705682,
};

const NATIVE_CURRENCY: Record<
  string,
  { name: string; symbol: string; decimals: number }
> = {
  ethereum: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  sepolia: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  polygon: { name: 'POL', symbol: 'POL', decimals: 18 },
  amoy: { name: 'POL', symbol: 'POL', decimals: 18 },
  bsc: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  'bsc-testnet': { name: 'BNB', symbol: 'BNB', decimals: 18 },
  base: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  'base-sepolia': { name: 'Ether', symbol: 'ETH', decimals: 18 },
  'arbitrum-one': { name: 'Ether', symbol: 'ETH', decimals: 18 },
  monad: { name: 'Monad', symbol: 'MON', decimals: 18 },
  tempo: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  'tempo-testnet': { name: 'Ether', symbol: 'ETH', decimals: 18 },
  'skale-base-sepolia': { name: 'CREDIT', symbol: 'CREDIT', decimals: 18 },
};

/** Native currency symbol for a chain, e.g. `base` -> `ETH`, `monad` -> `MON`. */
export function getNativeCurrencySymbol(chainSlug: string): string {
  return NATIVE_CURRENCY[chainSlug]?.symbol ?? 'ETH';
}

export function createEvmPublicClient(rpcUrl: string, chainSlug: string) {
  const chainId = EVM_CHAIN_ID[chainSlug] ?? 1;
  const native = NATIVE_CURRENCY[chainSlug] ?? {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  };
  const chain: Chain = defineChain({
    id: chainId,
    name: chainSlug,
    nativeCurrency: native,
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  return createPublicClient({
    chain,
    transport: http(rpcUrl, { timeout: 12_000 }),
  });
}

export type EvmPublicClient = ReturnType<typeof createEvmPublicClient>;
