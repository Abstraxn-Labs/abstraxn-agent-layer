import { BITE } from '@skalenetwork/bite';

export interface BiteEncryptedCall {
  to: string;
  data: string;
}

/**
 * Encrypts an EVM call's `to`+`data` via SKALE's BITE protocol so the real destination and
 * calldata stay hidden on-chain until consensus finality.
 *
 * Callers must estimate gas against the plaintext `to`/`data` *before* calling this — once
 * encrypted, the real call is opaque to the RPC node and can no longer be simulated. `gasLimit`
 * is deliberately not passed here: BITE never encrypts it (it's an unencrypted
 * passthrough/default in the protocol), so there is nothing to gain from round-tripping it back
 * out, and doing so risks it being mistaken for a real gas estimate.
 */
export async function encryptEvmCallForBite(
  rpcUrl: string,
  to: string,
  data: string,
): Promise<BiteEncryptedCall> {
  const bite = new BITE(rpcUrl);
  const encrypted = await bite.encryptTransaction({ to, data });
  return { to: encrypted.to.toLowerCase(), data: encrypted.data };
}

/**
 * Gas floor for BITE-encrypted calls, matching the value already proven live on SKALE Base
 * Sepolia by the reference BITE integration. Once a call is encrypted, the node can no longer
 * simulate the real to/data to re-estimate gas, so headroom has to be generous rather than tight.
 */
export const BITE_MIN_GAS = 300_000n;

/**
 * EVM intrinsic calldata gas cost (post-Istanbul/EIP-2028): 4 gas per zero byte, 16 gas per
 * non-zero byte. BITE ciphertext is near-random (almost no zero bytes) and longer than the
 * plaintext calldata it replaces, so it costs meaningfully more calldata gas than an
 * `eth_estimateGas` against the plaintext call can account for.
 */
export function calldataGasCost(hexData: string): bigint {
  const hex = hexData.startsWith('0x') ? hexData.slice(2) : hexData;
  let cost = 0n;
  for (let i = 0; i + 1 < hex.length; i += 2) {
    cost += hex.slice(i, i + 2) === '00' ? 4n : 16n;
  }
  return cost;
}
