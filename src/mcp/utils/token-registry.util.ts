/**
 * USDC / USDC.e contract lookup for `network.token_info`, EVM chains only (this tool never
 * touches Solana). `fetchTokenInfo` always reads `decimals()` live from the contract itself, so
 * no chain-specific decimals table is needed here even though BSC's Binance-Peg USDC uses 18
 * instead of the usual 6 — that's discovered at call time, not hardcoded.
 *
 * The `bsc` address below is corrected from a corrupted value found in the source this was
 * ported from (invalid hex, wrong length: "0x8AC76a51cc950d9822NdEa52c985d0e") — verified
 * against BscScan: 0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d (Binance-Peg USDC, 18 decimals).
 */
export const USDC_BY_CHAIN: Record<string, string> = {
  ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  sepolia: '0x1c7D4B196Cb0C7B29dD5F7aA83d294511102432',
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'base-sepolia': '0x036CbD53842c54266358eD9371b46bbb3b985d0e',
  'arbitrum-one': '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  polygon: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  amoy: '0x41E94Eb018C8da0cde47d7313c407c16724dfe71',
  bsc: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
};

/** Bridged USDC.e (6 decimals) where distinct from native USDC. */
export const USDC_E_BY_CHAIN: Record<string, string> = {
  base: '0xd9aAEc86B65A86Db431a596F7A92e684FD131bca',
  'arbitrum-one': '0xFF970A61A2bA81b698061Ba3d4c5b2e0D0f330b8',
  polygon: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  /** Circle FiatTokenV2-style bridged USDC ("Bridged USDC (SKALE Bridge)"), 6 decimals. */
  'skale-base-sepolia': '0x2e08028E3C4c2356572E096d8EF835cD5C6030bD',
};
