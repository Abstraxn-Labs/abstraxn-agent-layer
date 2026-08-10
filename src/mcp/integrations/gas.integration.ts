import type { FeeValuesEIP1559 } from 'viem';
import type { EvmPublicClient } from '../utils/evm-public-client.util';

export interface GasInfoResult {
  chain: string;
  gasPrice: string;
  gasPriceGwei: string;
  maxFeePerGas: string | null;
  maxPriorityFeePerGas: string | null;
  supportsEip1559: boolean;
  timestamp: number;
}

export async function fetchGasInfo(
  client: EvmPublicClient,
  chain: string,
): Promise<GasInfoResult> {
  const [gasPrice, feeEstimate] = await Promise.all([
    client.getGasPrice(),
    client
      .estimateFeesPerGas()
      .then((fees): FeeValuesEIP1559 => fees)
      .catch((): FeeValuesEIP1559 | null => null),
  ]);

  const maxFeePerGas = feeEstimate?.maxFeePerGas ?? null;
  const maxPriorityFeePerGas = feeEstimate?.maxPriorityFeePerGas ?? null;
  const supportsEip1559 = maxFeePerGas !== null && maxFeePerGas !== undefined;

  return {
    chain,
    gasPrice: gasPrice.toString(),
    gasPriceGwei: formatGwei(gasPrice),
    maxFeePerGas: maxFeePerGas?.toString() ?? null,
    maxPriorityFeePerGas: maxPriorityFeePerGas?.toString() ?? null,
    supportsEip1559,
    timestamp: Date.now(),
  };
}

function formatGwei(wei: bigint): string {
  const whole = wei / 1_000_000_000n;
  const frac = wei % 1_000_000_000n;
  if (frac === 0n) {
    return whole.toString();
  }
  const fracStr = frac.toString().padStart(9, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}`;
}
