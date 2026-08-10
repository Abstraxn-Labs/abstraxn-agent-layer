import type { Address, Hash } from 'viem';
import type { EvmPublicClient } from '../utils/evm-public-client.util';

export interface TransactionInfoResult {
  chain: string;
  hash: string;
  from: string;
  to: string | null;
  value: string;
  gasUsed: string | null;
  gasPrice: string | null;
  status: 'success' | 'failed' | 'pending';
  blockNumber: string | null;
  blockNumberDecimal: string | null;
  timestamp: number | null;
}

/**
 * Minimal, chain-agnostic shape of the fields this function actually reads. viem's own
 * `GetTransactionReturnType`/`GetTransactionReceiptReturnType` are formatter-aware and resolve
 * to an effectively `any`-inclusive type when the client's chain has no statically-known
 * custom formatters (true here, since chains are built dynamically via `defineChain`) — these
 * narrower local types are deliberately stable across every EVM chain's standard JSON-RPC
 * transaction/receipt shape, regardless of that.
 */
interface RawTransaction {
  hash: Hash;
  from: Address;
  to: Address | null;
  value: bigint;
  gasPrice?: bigint;
  blockNumber: bigint | null;
}

interface RawTransactionReceipt {
  status: 'success' | 'reverted';
  gasUsed: bigint;
}

export async function fetchTransactionInfo(
  client: EvmPublicClient,
  chain: string,
  transactionHash: Hash,
): Promise<TransactionInfoResult> {
  const [tx, receipt] = await Promise.all([
    client
      .getTransaction({ hash: transactionHash })
      .then((t): RawTransaction => t),
    client
      .getTransactionReceipt({ hash: transactionHash })
      .then((r): RawTransactionReceipt => r)
      .catch((): RawTransactionReceipt | null => null),
  ]);

  if (!tx) {
    throw new Error('Transaction not found');
  }

  const block =
    tx.blockNumber !== null && tx.blockNumber !== undefined
      ? await client
          .getBlock({ blockNumber: tx.blockNumber })
          .then((b): { timestamp: bigint } => b)
          .catch((): { timestamp: bigint } | null => null)
      : null;

  let status: TransactionInfoResult['status'] = 'pending';
  if (receipt) {
    status = receipt.status === 'success' ? 'success' : 'failed';
  }

  return {
    chain,
    hash: tx.hash,
    from: tx.from,
    to: tx.to,
    value: tx.value.toString(),
    gasUsed: receipt?.gasUsed?.toString() ?? null,
    gasPrice: tx.gasPrice?.toString() ?? null,
    status,
    blockNumber:
      tx.blockNumber !== null && tx.blockNumber !== undefined
        ? `0x${tx.blockNumber.toString(16)}`
        : null,
    blockNumberDecimal:
      tx.blockNumber !== null && tx.blockNumber !== undefined
        ? tx.blockNumber.toString()
        : null,
    timestamp: block?.timestamp ? Number(block.timestamp) : null,
  };
}
