import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';

export interface SolanaTransferIntent {
  chain: 'solana' | 'solana-devnet';
  from: string;
  to: string;
  token: string;
  mint: string | null;
  amount: string;
  amountAtomic: string;
  decimals: number;
}

export interface SolanaUnsignedTransaction {
  type: 'solana_unsigned_v1';
  encoding: 'base64';
  transaction: string;
  recentBlockhash: string;
  feePayer: string;
}

/**
 * Builds and serializes (never signs) a native SOL or SPL-token transfer. `requireAllSignatures:
 * false` is what makes this safe to hand back to an anonymous caller — the returned bytes are
 * inert until the caller's own wallet signs them.
 */
export async function buildSolanaUnsignedTransferTx(options: {
  rpcUrl: string;
  intent: SolanaTransferIntent;
}): Promise<SolanaUnsignedTransaction> {
  const { rpcUrl, intent } = options;
  const connection = new Connection(rpcUrl, 'confirmed');
  const fromPubkey = new PublicKey(intent.from);
  const toPubkey = new PublicKey(intent.to);
  const lamportsOrUnits = BigInt(intent.amountAtomic);

  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  const transaction = new Transaction();
  transaction.feePayer = fromPubkey;
  transaction.recentBlockhash = blockhash;

  if (intent.mint === null) {
    if (lamportsOrUnits > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(
        'SOL amount exceeds safe lamport range for this builder.',
      );
    }
    transaction.add(
      SystemProgram.transfer({
        fromPubkey,
        toPubkey,
        lamports: Number(lamportsOrUnits),
      }),
    );
  } else {
    const mint = new PublicKey(intent.mint);
    const sourceAta = getAssociatedTokenAddressSync(mint, fromPubkey);
    const destAta = getAssociatedTokenAddressSync(mint, toPubkey);
    transaction.add(
      createTransferInstruction(
        sourceAta,
        destAta,
        fromPubkey,
        lamportsOrUnits,
      ),
    );
  }

  const serialized = transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString('base64');

  return {
    type: 'solana_unsigned_v1',
    encoding: 'base64',
    transaction: serialized,
    recentBlockhash: blockhash,
    feePayer: intent.from,
  };
}
