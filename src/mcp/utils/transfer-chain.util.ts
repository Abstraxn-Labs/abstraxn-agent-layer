import {
  decodeFunctionResult,
  encodeFunctionData,
  isAddress,
  parseAbi,
} from 'viem';
import { PublicKey } from '@solana/web3.js';
import {
  EVM_CHAIN_SLUGS,
  SOLANA_CHAIN_SLUGS,
  isEvmChainSlug,
  isSolanaChainSlug,
  type EvmChainSlug,
  type SolanaChainSlug,
} from './chain-registry.util';
import {
  getNativeCurrencySymbol,
  type EvmPublicClient,
} from './evm-public-client.util';
import { resolveTokenContractAddress } from '../integrations/token-info.integration';

/** Every chain `network.prepare_transfer` can build a transaction for. */
export const TRANSFER_CHAIN_ENUM = [
  ...SOLANA_CHAIN_SLUGS,
  ...EVM_CHAIN_SLUGS,
] as const;

export function isTransferChainSlug(
  slug: string,
): slug is EvmChainSlug | SolanaChainSlug {
  return isEvmChainSlug(slug) || isSolanaChainSlug(slug);
}

/** BITE privacy encryption (SKALE) is only wired up for this one testnet. */
export function isBiteCapableChain(chain: string): boolean {
  return chain === 'skale-base-sepolia';
}

/** Strips the `tempox0x…` display prefix some Tempo-aware clients use for the same address. */
export function normalizeEvmRecipient(address: string): string {
  const trimmed = address.trim();
  const tempoMatch = /^tempox0x([a-fA-F0-9]{40})$/i.exec(trimmed);
  return tempoMatch ? `0x${tempoMatch[1]}` : trimmed;
}

export function isValidHexData(data: string): boolean {
  return /^0x[0-9a-fA-F]*$/.test(data) && data.length >= 2;
}

export function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/** Parses a human decimal string ("0.1", "100") into base units for a token with `decimals`. */
export function parseHumanAmount(amount: string, decimals: number): bigint {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(
      `Invalid amount "${amount}". Use a positive decimal string.`,
    );
  }
  const [whole, frac = ''] = trimmed.split('.');
  if (frac.length > decimals) {
    throw new Error(
      `Amount "${amount}" has more than ${decimals} decimal places for this token.`,
    );
  }
  const combined =
    `${whole}${frac.padEnd(decimals, '0')}`.replace(/^0+/, '') || '0';
  return BigInt(combined);
}

export function atomicToDecimalString(
  amount: bigint,
  decimals: number,
): string {
  const raw = amount.toString().padStart(decimals + 1, '0');
  const whole = raw.slice(0, raw.length - decimals) || '0';
  const frac = raw.slice(raw.length - decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

const ERC20_TRANSFER_SELECTOR = 'a9059cbb';

/** Encodes `transfer(address,uint256)` calldata by hand — no ABI needed for one fixed selector. */
export function encodeErc20Transfer(
  recipient: string,
  amountAtomic: bigint,
): string {
  const addr = recipient.toLowerCase().replace(/^0x/, '');
  if (addr.length !== 40) {
    throw new Error('Invalid ERC-20 recipient address.');
  }
  const amountHex = amountAtomic.toString(16).padStart(64, '0');
  return `0x${ERC20_TRANSFER_SELECTOR}${addr.padStart(64, '0')}${amountHex}`;
}

const DECIMALS_ABI = parseAbi(['function decimals() view returns (uint8)']);

/**
 * Always reads decimals live from the contract when possible — never trust a caller-supplied
 * `token_decimals` for a symbol/address we can query ourselves, the same "never hardcode
 * decimals" rule `network.token_info` already follows. A wrong hardcoded value here would
 * silently send an amount off by orders of magnitude. `fallback` (the caller's `token_decimals`,
 * default 18) is only used if the contract doesn't implement `decimals()`.
 */
async function readErc20DecimalsLive(
  client: EvmPublicClient,
  contractAddress: `0x${string}`,
  fallback: number,
): Promise<number> {
  try {
    const data = encodeFunctionData({
      abi: DECIMALS_ABI,
      functionName: 'decimals',
    });
    const { data: result } = await client.call({ to: contractAddress, data });
    if (!result) {
      return fallback;
    }
    const decoded = decodeFunctionResult({
      abi: DECIMALS_ABI,
      functionName: 'decimals',
      data: result,
    });
    return Number(decoded);
  } catch {
    return fallback;
  }
}

export interface ResolvedEvmToken {
  tokenLabel: string;
  contract: string | null;
  decimals: number;
}

export interface TokenResolutionError {
  error: string;
  message: string;
}

/**
 * Native token, `USDC`/`USDC.e` (via the same `token-registry.util.ts` maps `network.token_info`
 * already uses), or an arbitrary `0x` contract. Tempo TIP-20 symbols (pathUSD, AlphaUSD, ...) are
 * deliberately unsupported — no contract registry exists for them, same limitation as the
 * service this was ported from. Pass a raw `0x` contract address instead.
 */
export async function resolveEvmToken(
  client: EvmPublicClient,
  chain: EvmChainSlug,
  tokenArg: string | null,
  tokenDecimalsArg: number,
): Promise<ResolvedEvmToken | TokenResolutionError> {
  const nativeSymbol = getNativeCurrencySymbol(chain);
  if (!tokenArg) {
    return { tokenLabel: nativeSymbol, contract: null, decimals: 18 };
  }

  const trimmed = tokenArg.trim();
  if (trimmed.toUpperCase() === nativeSymbol.toUpperCase()) {
    return { tokenLabel: nativeSymbol, contract: null, decimals: 18 };
  }

  const contractAddress = resolveTokenContractAddress(chain, trimmed);
  if (!contractAddress) {
    return {
      error: 'UNSUPPORTED_TOKEN',
      message: `Could not resolve token "${tokenArg}" on ${chain}. Use a 0x contract address, ${nativeSymbol}, USDC, or USDC.e.`,
    };
  }

  const decimals = await readErc20DecimalsLive(
    client,
    contractAddress as `0x${string}`,
    tokenDecimalsArg,
  );
  const tokenLabel = isAddress(trimmed)
    ? 'CUSTOM_ERC20'
    : trimmed.toUpperCase();
  return { tokenLabel, contract: contractAddress, decimals };
}

/**
 * Solana mint addresses aren't in `token-registry.util.ts` (that file is EVM-only, see its own
 * header comment), so this is a small dedicated map, mainnet vs devnet. Only SOL and USDC are
 * supported, same restriction as the service this was ported from — an arbitrary mint transfer
 * needs an on-chain token-account/decimals lookup this tool doesn't do.
 */
const SOLANA_USDC_MINT: Record<SolanaChainSlug, string> = {
  solana: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  // Circle's devnet USDC test mint. Devnet mints are more prone to being redeployed than
  // mainnet ones — verify against Circle's current testnet docs before relying on this in an
  // automated flow.
  'solana-devnet': '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
};

export interface ResolvedSolanaToken {
  tokenLabel: string;
  mint: string | null;
  decimals: number;
}

export function resolveSolanaToken(
  chain: SolanaChainSlug,
  tokenArg: string | null,
): ResolvedSolanaToken | TokenResolutionError {
  const normalized =
    tokenArg && tokenArg.trim() ? tokenArg.trim().toUpperCase() : 'SOL';

  if (normalized === 'SOL') {
    return { tokenLabel: 'SOL', mint: null, decimals: 9 };
  }
  if (normalized === 'USDC') {
    return { tokenLabel: 'USDC', mint: SOLANA_USDC_MINT[chain], decimals: 6 };
  }
  return {
    error: 'UNSUPPORTED_TOKEN',
    message: `Custom Solana mint transfers are not supported yet — use SOL or USDC on ${chain}.`,
  };
}
