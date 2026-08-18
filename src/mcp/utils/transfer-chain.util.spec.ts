import {
  atomicToDecimalString,
  encodeErc20Transfer,
  isBiteCapableChain,
  isTransferChainSlug,
  isValidHexData,
  isValidSolanaAddress,
  normalizeEvmRecipient,
  parseHumanAmount,
  resolveSolanaToken,
  TRANSFER_CHAIN_ENUM,
} from './transfer-chain.util';

describe('TRANSFER_CHAIN_ENUM / isTransferChainSlug', () => {
  it('includes both EVM and Solana slugs', () => {
    expect(TRANSFER_CHAIN_ENUM).toEqual(
      expect.arrayContaining(['base', 'sepolia', 'solana', 'solana-devnet']),
    );
  });

  it('accepts a known EVM or Solana slug and rejects an unknown one', () => {
    expect(isTransferChainSlug('base')).toBe(true);
    expect(isTransferChainSlug('solana')).toBe(true);
    expect(isTransferChainSlug('not-a-chain')).toBe(false);
  });
});

describe('isBiteCapableChain', () => {
  it('is true only for skale-base-sepolia', () => {
    expect(isBiteCapableChain('skale-base-sepolia')).toBe(true);
    expect(isBiteCapableChain('base')).toBe(false);
    expect(isBiteCapableChain('solana')).toBe(false);
  });
});

describe('normalizeEvmRecipient', () => {
  it('strips a tempox0x… prefix', () => {
    const addr = `0x${'1'.repeat(40)}`;
    expect(normalizeEvmRecipient(`tempox${addr}`)).toBe(addr);
  });

  it('leaves a plain 0x address untouched', () => {
    const addr = `0x${'a'.repeat(40)}`;
    expect(normalizeEvmRecipient(addr)).toBe(addr);
  });
});

describe('isValidHexData', () => {
  it('accepts 0x and 0x-prefixed hex', () => {
    expect(isValidHexData('0x')).toBe(true);
    expect(isValidHexData('0x1234')).toBe(true);
  });

  it('rejects missing prefix or non-hex characters', () => {
    expect(isValidHexData('1234')).toBe(false);
    expect(isValidHexData('0xzz')).toBe(false);
  });
});

describe('isValidSolanaAddress', () => {
  it('accepts a well-formed base58 address', () => {
    expect(isValidSolanaAddress('11111111111111111111111111111111')).toBe(true);
  });

  it('rejects an obviously invalid address', () => {
    expect(isValidSolanaAddress('not-base58!!')).toBe(false);
    expect(isValidSolanaAddress('')).toBe(false);
  });
});

describe('parseHumanAmount', () => {
  it('converts a decimal string to base units', () => {
    expect(parseHumanAmount('10.5', 6)).toBe(10_500_000n);
    expect(parseHumanAmount('1', 18)).toBe(10n ** 18n);
    expect(parseHumanAmount('0', 6)).toBe(0n);
  });

  it('throws for a non-numeric amount', () => {
    expect(() => parseHumanAmount('abc', 6)).toThrow();
  });

  it('throws when more decimal places are given than the token supports', () => {
    expect(() => parseHumanAmount('1.1234567', 6)).toThrow();
  });
});

describe('atomicToDecimalString', () => {
  it('round-trips parseHumanAmount', () => {
    expect(atomicToDecimalString(10_500_000n, 6)).toBe('10.5');
    expect(atomicToDecimalString(10n ** 18n, 18)).toBe('1');
    expect(atomicToDecimalString(0n, 6)).toBe('0');
  });
});

describe('encodeErc20Transfer', () => {
  it('produces a9059cbb-selector calldata of the expected length', () => {
    const recipient = `0x${'b'.repeat(40)}`;
    const calldata = encodeErc20Transfer(recipient, 1_000_000n);
    expect(calldata.startsWith('0xa9059cbb')).toBe(true);
    expect(calldata.length).toBe(2 + 8 + 64 + 64);
  });

  it('throws for a malformed recipient', () => {
    expect(() => encodeErc20Transfer('0xnothex', 1n)).toThrow();
  });
});

describe('resolveSolanaToken', () => {
  it('defaults to SOL when token is omitted', () => {
    expect(resolveSolanaToken('solana', null)).toEqual({
      tokenLabel: 'SOL',
      mint: null,
      decimals: 9,
    });
  });

  it('resolves USDC to the mainnet mint', () => {
    const result = resolveSolanaToken('solana', 'USDC');
    expect(result).toEqual(
      expect.objectContaining({ tokenLabel: 'USDC', decimals: 6 }),
    );
  });

  it('rejects an arbitrary mint', () => {
    const result = resolveSolanaToken(
      'solana',
      'SomeRandomMint1111111111111111111111111',
    );
    expect(result).toEqual(
      expect.objectContaining({ error: 'UNSUPPORTED_TOKEN' }),
    );
  });
});
