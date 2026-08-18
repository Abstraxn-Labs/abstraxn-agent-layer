import type { Address } from 'viem';
import type { EvmPublicClient } from './evm-public-client.util';
import { encodeErc20Transfer } from './transfer-chain.util';
import {
  BITE_MIN_GAS,
  calldataGasCost,
  encryptEvmCallForBite,
} from './bite-encrypt.util';

export interface EvmTransferIntent {
  chain: string;
  from: string;
  to: string;
  tokenContract: string | null;
  amountAtomic: bigint;
  customData: string | null;
}

export interface EvmUnsignedTransaction {
  type: 'evm_unsigned_v1';
  chainId: string;
  from: string;
  to: string;
  value: string;
  data: string;
  nonce: string;
  gas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}

const NATIVE_TRANSFER_GAS = 21_000n;
const CONTRACT_CALL_GAS_FALLBACK = 100_000n;
const GAS_BUFFER_NUMERATOR = 120n;
const GAS_BUFFER_DENOMINATOR = 100n;

/**
 * Fee estimation with the same EIP-1559-then-legacy fallback `gas.integration.ts`'s
 * `fetchGasInfo` already uses for `network.gas_info` — kept as its own small helper here since
 * this needs non-nullable bigints for a transaction object, not the nullable display strings
 * `fetchGasInfo` returns.
 */
async function resolveFeesPerGas(
  client: EvmPublicClient,
): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  try {
    const fees = await client.estimateFeesPerGas();
    return {
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    };
  } catch {
    const gasPrice = await client.getGasPrice();
    return { maxFeePerGas: gasPrice, maxPriorityFeePerGas: gasPrice };
  }
}

/**
 * Builds (never signs or broadcasts) an EIP-1559 transaction for a native transfer, an ERC-20
 * `transfer(address,uint256)` call, or an arbitrary raw-calldata contract call. Nonce/gas/fees
 * are read live from the chain via the same `EvmPublicClient` every other `network.*` tool uses
 * — no second RPC-calling convention introduced here.
 */
export async function buildEvmUnsignedTransferTx(params: {
  client: EvmPublicClient;
  rpcUrl: string;
  intent: EvmTransferIntent;
  encryptWithBite: boolean;
}): Promise<EvmUnsignedTransaction> {
  const { client, rpcUrl, intent, encryptWithBite } = params;
  const customData = intent.customData?.trim();
  const isCustomCall = !!customData && customData !== '0x';
  const isNative = !isCustomCall && intent.tokenContract === null;

  let to = isCustomCall
    ? intent.to.toLowerCase()
    : isNative
      ? intent.to.toLowerCase()
      : intent.tokenContract.toLowerCase();
  const value =
    isCustomCall || isNative ? `0x${intent.amountAtomic.toString(16)}` : '0x0';
  let data = isCustomCall
    ? customData
    : isNative
      ? '0x'
      : encodeErc20Transfer(intent.to, intent.amountAtomic);

  const [nonce, feeEstimate] = await Promise.all([
    client.getTransactionCount({
      address: intent.from as Address,
      blockTag: 'pending',
    }),
    resolveFeesPerGas(client),
  ]);

  let gas: bigint;
  try {
    gas = await client.estimateGas({
      account: intent.from as Address,
      to: to,
      value: BigInt(value),
      data: data,
    });
  } catch {
    gas = isNative ? NATIVE_TRANSFER_GAS : CONTRACT_CALL_GAS_FALLBACK;
  }
  let gasWithBuffer = (gas * GAS_BUFFER_NUMERATOR) / GAS_BUFFER_DENOMINATOR;

  if (encryptWithBite) {
    const encrypted = await encryptEvmCallForBite(rpcUrl, to, data);
    const calldataDelta =
      calldataGasCost(encrypted.data) - calldataGasCost(data);
    to = encrypted.to;
    data = encrypted.data;
    gasWithBuffer += calldataDelta > 0n ? calldataDelta : 0n;
    if (gasWithBuffer < BITE_MIN_GAS) {
      gasWithBuffer = BITE_MIN_GAS;
    }
  }

  return {
    type: 'evm_unsigned_v1',
    chainId: `0x${(client.chain?.id ?? 1).toString(16)}`,
    from: intent.from,
    to,
    value,
    data,
    nonce: `0x${nonce.toString(16)}`,
    gas: `0x${gasWithBuffer.toString(16)}`,
    maxFeePerGas: `0x${feeEstimate.maxFeePerGas.toString(16)}`,
    maxPriorityFeePerGas: `0x${feeEstimate.maxPriorityFeePerGas.toString(16)}`,
  };
}
