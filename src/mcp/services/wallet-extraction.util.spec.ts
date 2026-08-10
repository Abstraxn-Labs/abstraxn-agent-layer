import { extractPayerAddressFromPaymentPayload } from './wallet-extraction.util';

const VALID_ADDRESS_LOWERCASE = '0x1234567890abcdef1234567890abcdef12345678';
const VALID_ADDRESS_CHECKSUMMED = '0x1234567890AbcdEF1234567890aBcdef12345678';

function makeAcceptedFixture() {
  return {
    scheme: 'exact',
    network: 'base',
    asset: '0x0000000000000000000000000000000000000000',
    amount: '1000',
    payTo: '0xabcabcabcabcabcabcabcabcabcabcabcabcabc',
    maxTimeoutSeconds: 300,
    extra: {},
  } as never;
}

function makeEip3009PaymentPayload(from: string) {
  return {
    x402Version: 2,
    accepted: makeAcceptedFixture(),
    payload: {
      signature: '0xdeadbeef',
      authorization: {
        from,
        to: '0xabcabcabcabcabcabcabcabcabcabcabcabcabc',
        value: '1000',
        validAfter: '0',
        validBefore: '9999999999',
        nonce: '0x00',
      },
    },
  } as never;
}

describe('extractPayerAddressFromPaymentPayload', () => {
  it('extracts and checksums the payer address from a valid EIP-3009 payload', () => {
    expect(
      extractPayerAddressFromPaymentPayload(
        makeEip3009PaymentPayload(VALID_ADDRESS_LOWERCASE),
      ),
    ).toBe(VALID_ADDRESS_CHECKSUMMED);
  });

  it('returns null when paymentPayload is undefined (free call)', () => {
    expect(extractPayerAddressFromPaymentPayload(undefined)).toBeNull();
  });

  it('returns null for a Permit2 payload (no authorization field)', () => {
    const permit2Payload = {
      x402Version: 2,
      accepted: makeAcceptedFixture(),
      payload: {
        permit2Authorization: { owner: VALID_ADDRESS_LOWERCASE },
      },
    } as never;
    expect(extractPayerAddressFromPaymentPayload(permit2Payload)).toBeNull();
  });

  it('returns null when payload.payload is null, without throwing', () => {
    const malformed = {
      x402Version: 2,
      accepted: makeAcceptedFixture(),
      payload: null,
    } as never;
    expect(() =>
      extractPayerAddressFromPaymentPayload(malformed),
    ).not.toThrow();
    expect(extractPayerAddressFromPaymentPayload(malformed)).toBeNull();
  });

  it('returns null when payload.payload is a string, without throwing', () => {
    const malformed = {
      x402Version: 2,
      accepted: makeAcceptedFixture(),
      payload: 'not-an-object',
    } as never;
    expect(() =>
      extractPayerAddressFromPaymentPayload(malformed),
    ).not.toThrow();
    expect(extractPayerAddressFromPaymentPayload(malformed)).toBeNull();
  });

  it('returns null when authorization is present but null, without throwing', () => {
    const adversarial = {
      x402Version: 2,
      accepted: makeAcceptedFixture(),
      payload: { authorization: null },
    } as never;
    expect(() =>
      extractPayerAddressFromPaymentPayload(adversarial),
    ).not.toThrow();
    expect(extractPayerAddressFromPaymentPayload(adversarial)).toBeNull();
  });

  it('returns null when authorization.from is not a valid address, without throwing', () => {
    const malformedFrom = makeEip3009PaymentPayload('not-an-address');
    expect(() =>
      extractPayerAddressFromPaymentPayload(malformedFrom),
    ).not.toThrow();
    expect(extractPayerAddressFromPaymentPayload(malformedFrom)).toBeNull();
  });
});
