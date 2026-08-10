export interface SolanaTransactionStatusResult {
  chain: string;
  transaction_hash: string;
  status: 'success' | 'failed' | 'pending' | 'not_found';
  slot: number | null;
  confirmations: number | null;
  err: unknown;
  blockTime: number | null;
  feeLamports: number | null;
}

const SOLANA_SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,128}$/;

export function isValidSolanaSignature(signature: string): boolean {
  return SOLANA_SIG_RE.test(signature.trim());
}

export async function fetchSolanaTransactionStatus(
  rpcUrl: string,
  chain: string,
  signature: string,
): Promise<SolanaTransactionStatusResult> {
  const sig = signature.trim();

  const [statusRes, txRes] = await Promise.all([
    rpcCall(rpcUrl, 'getSignatureStatuses', [
      [sig],
      { searchTransactionHistory: true },
    ]),
    rpcCall(rpcUrl, 'getTransaction', [
      sig,
      { encoding: 'json', maxSupportedTransactionVersion: 0 },
    ]).catch(() => null),
  ]);

  const statusBody = statusRes as {
    result?: {
      value: Array<{
        slot: number;
        confirmations: number | null;
        err: unknown;
        confirmationStatus?: string;
      } | null>;
    };
  };
  const entry = statusBody.result?.value?.[0] ?? null;

  if (!entry) {
    return {
      chain,
      transaction_hash: sig,
      status: 'not_found',
      slot: null,
      confirmations: null,
      err: null,
      blockTime: null,
      feeLamports: null,
    };
  }

  const txBody = txRes as {
    result?: {
      slot: number;
      blockTime: number | null;
      meta?: { fee: number; err: unknown };
    } | null;
  };
  const tx = txBody?.result ?? null;

  let status: SolanaTransactionStatusResult['status'] = 'pending';
  if (entry.err) {
    status = 'failed';
  } else if (
    entry.confirmationStatus === 'confirmed' ||
    entry.confirmationStatus === 'finalized' ||
    (entry.confirmations !== null && entry.confirmations >= 0)
  ) {
    status = 'success';
  }

  return {
    chain,
    transaction_hash: sig,
    status,
    slot: entry.slot ?? tx?.slot ?? null,
    confirmations: entry.confirmations,
    err: entry.err ?? tx?.meta?.err ?? null,
    blockTime: tx?.blockTime ?? null,
    feeLamports: tx?.meta?.fee ?? null,
  };
}

async function rpcCall(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json()) as {
    result?: unknown;
    error?: { message: string };
  };
  if (body.error) {
    throw new Error(body.error.message);
  }
  return body;
}
