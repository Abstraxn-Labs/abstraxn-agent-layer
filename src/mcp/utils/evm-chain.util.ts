import type { ConfigService } from '@nestjs/config';
import {
  EVM_CHAIN_ENUM,
  isEvmChainSlug,
  resolveEvmRpcUrl,
} from './chain-registry.util';
import {
  createEvmPublicClient,
  type EvmPublicClient,
} from './evm-public-client.util';

export type EvmChainSuccess = { ok: true; chain: string };
export type EvmChainFailure = { ok: false; error: unknown };

/**
 * `chain` is always required by every EVM tool on this service — there is no wallet-bound
 * default to fall back to (this server never holds or infers a caller wallet), unlike the
 * authenticated service this was ported from.
 */
export function parseEvmChainArg(
  raw: unknown,
): EvmChainSuccess | EvmChainFailure {
  const chain = typeof raw === 'string' ? raw.trim() : '';
  if (!chain) {
    return {
      ok: false as const,
      error: {
        error: 'MISSING_CHAIN',
        message: `Parameter "chain" is required. Allowed: ${EVM_CHAIN_ENUM.join(', ')}`,
      },
    };
  }
  if (!isEvmChainSlug(chain)) {
    return {
      ok: false as const,
      error: {
        error: 'INVALID_CHAIN',
        message: `Unknown chain "${chain}". Allowed: ${EVM_CHAIN_ENUM.join(', ')}`,
      },
    };
  }
  return { ok: true as const, chain };
}

export function resolveEvmClient(
  configService: ConfigService,
  chain: string,
):
  | { ok: true; client: EvmPublicClient; chain: string; rpcUrl: string }
  | { ok: false; error: unknown } {
  const rpcUrl = resolveEvmRpcUrl(configService, chain);
  if (!rpcUrl) {
    return {
      ok: false as const,
      error: {
        error: 'CHAIN_RPC_UNAVAILABLE',
        message: `No RPC URL for "${chain}". Configure CHAIN_RPC_* for this chain.`,
        chain,
      },
    };
  }
  return {
    ok: true as const,
    client: createEvmPublicClient(rpcUrl, chain),
    chain,
    rpcUrl,
  };
}
