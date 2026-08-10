import {
  decodeFunctionResult,
  encodeFunctionData,
  formatUnits,
  isAddress,
  parseAbi,
  type Address,
} from 'viem';
import { USDC_BY_CHAIN, USDC_E_BY_CHAIN } from '../utils/token-registry.util';

const ERC20_READ_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
]);

export interface TokenInfoResult {
  chain: string;
  tokenAddress: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  totalSupplyFormatted: string;
  timestamp: number;
}

export function resolveTokenContractAddress(
  chain: string,
  token: string,
): string | null {
  const trimmed = token.trim();
  if (isAddress(trimmed)) {
    return trimmed;
  }

  const normalized = trimmed.toUpperCase().replace(/\s+/g, '');
  if (normalized === 'USDC') {
    const address = USDC_BY_CHAIN[chain]?.trim();
    return address && address.length > 0 ? address : null;
  }
  if (normalized === 'USDC.E' || normalized === 'USDC_E') {
    const address = USDC_E_BY_CHAIN[chain]?.trim();
    return address && address.length > 0 ? address : null;
  }

  return null;
}

function asErc20Label(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

async function ethCall(
  rpcUrl: string,
  to: string,
  data: string,
): Promise<`0x${string}`> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to, data }, 'latest'],
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const body = (await res.json()) as {
    result?: `0x${string}`;
    error?: { message: string };
  };
  if (body.error) {
    throw new Error(body.error.message);
  }
  if (!body.result) {
    throw new Error('Empty eth_call result');
  }
  return body.result;
}

async function readErc20StringField(
  rpcUrl: string,
  tokenAddress: Address,
  functionName: 'name' | 'symbol',
): Promise<string> {
  const data = encodeFunctionData({ abi: ERC20_READ_ABI, functionName });
  const result = await ethCall(rpcUrl, tokenAddress, data);
  const decoded: unknown = decodeFunctionResult({
    abi: ERC20_READ_ABI,
    functionName,
    data: result,
  });
  return asErc20Label(decoded);
}

async function readErc20Decimals(
  rpcUrl: string,
  tokenAddress: Address,
): Promise<number> {
  const data = encodeFunctionData({
    abi: ERC20_READ_ABI,
    functionName: 'decimals',
  });
  const result = await ethCall(rpcUrl, tokenAddress, data);
  const decoded: unknown = decodeFunctionResult({
    abi: ERC20_READ_ABI,
    functionName: 'decimals',
    data: result,
  });
  if (typeof decoded !== 'number' && typeof decoded !== 'bigint') {
    throw new Error('Invalid decimals response');
  }
  return Number(decoded);
}

async function readErc20TotalSupply(
  rpcUrl: string,
  tokenAddress: Address,
): Promise<bigint> {
  const data = encodeFunctionData({
    abi: ERC20_READ_ABI,
    functionName: 'totalSupply',
  });
  const result = await ethCall(rpcUrl, tokenAddress, data);
  const decoded: unknown = decodeFunctionResult({
    abi: ERC20_READ_ABI,
    functionName: 'totalSupply',
    data: result,
  });
  if (typeof decoded !== 'bigint') {
    throw new Error('Invalid totalSupply response');
  }
  return decoded;
}

/**
 * No `holderAddress`/`balanceOf` here — unlike the authenticated service this was ported from,
 * this server never binds a caller wallet, so a balance lookup is permanently unavailable, not
 * just unset. `network.token_info`'s tool description says so explicitly.
 */
export async function fetchTokenInfo(
  rpcUrl: string,
  chain: string,
  tokenAddress: Address,
): Promise<TokenInfoResult> {
  const [name, symbol, decimals, totalSupply] = await Promise.all([
    readErc20StringField(rpcUrl, tokenAddress, 'name'),
    readErc20StringField(rpcUrl, tokenAddress, 'symbol'),
    readErc20Decimals(rpcUrl, tokenAddress),
    readErc20TotalSupply(rpcUrl, tokenAddress),
  ]);

  return {
    chain,
    tokenAddress,
    name,
    symbol,
    decimals,
    totalSupply: totalSupply.toString(),
    totalSupplyFormatted: formatUnits(totalSupply, decimals),
    timestamp: Date.now(),
  };
}
