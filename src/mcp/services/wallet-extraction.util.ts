import { getAddress } from 'viem';
import type { PaymentPayload } from '@x402/core/types';

interface Eip3009PayloadShape {
  authorization: { from: string };
}

function isEip3009PayloadShape(value: unknown): value is Eip3009PayloadShape {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const authorization = (value as { authorization?: unknown }).authorization;
  if (typeof authorization !== 'object' || authorization === null) {
    return false;
  }
  return typeof (authorization as { from?: unknown }).from === 'string';
}

/**
 * Recovers the payer's checksummed EVM address from a paid call's `paymentPayload`. Returns null
 * (never throws) for: no payload (free call), a non-EIP-3009 scheme, or any malformed/adversarial
 * shape. `paymentPayload` on this route is unvalidated JSON off the wire from an anonymous
 * caller, so every step here is defensive — a crafted `{ payload: { authorization: null } }`
 * must not throw before the shape check runs.
 */
export function extractPayerAddressFromPaymentPayload(
  paymentPayload: PaymentPayload | undefined,
): string | null {
  if (!paymentPayload) {
    return null;
  }
  try {
    const rawPayload = paymentPayload.payload;
    if (!isEip3009PayloadShape(rawPayload)) {
      return null;
    }
    return getAddress(rawPayload.authorization.from);
  } catch {
    return null;
  }
}
