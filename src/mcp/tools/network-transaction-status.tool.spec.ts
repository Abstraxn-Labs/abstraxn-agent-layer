import { ConfigService } from '@nestjs/config';
import {
  execute,
  registerTransactionStatusTool,
} from './network-transaction-status.tool';
import * as evmTransactionIntegration from '../integrations/evm-transaction.integration';
import * as solanaTransactionIntegration from '../integrations/solana-transaction.integration';

function createConfig(): ConfigService {
  return {
    get: (_key: string, defaultValue?: string) => defaultValue ?? '',
  } as ConfigService;
}

const EVM_HASH = `0x${'a'.repeat(64)}`;
const SOLANA_SIG = '1'.repeat(88);

describe('registerTransactionStatusTool', () => {
  it('registers under the network.transaction_status dot-notation name', () => {
    const server = { registerTool: jest.fn() };
    registerTransactionStatusTool(server as never, createConfig());
    expect(server.registerTool.mock.calls[0][0]).toBe(
      'network.transaction_status',
    );
  });
});

describe('network.transaction_status execute', () => {
  afterEach(() => jest.restoreAllMocks());

  it('rejects a missing transaction_hash', async () => {
    const result = await execute(createConfig(), 'base', '   ');
    expect(result).toEqual({
      error: 'MISSING_TRANSACTION_HASH',
      message: expect.any(String),
    });
  });

  it('rejects a malformed EVM hash', async () => {
    const result = await execute(createConfig(), 'base', '0xnothex');
    expect(result).toEqual({
      error: 'INVALID_TRANSACTION_HASH',
      message: expect.any(String),
    });
  });

  it('returns EVM transaction info on success', async () => {
    jest
      .spyOn(evmTransactionIntegration, 'fetchTransactionInfo')
      .mockResolvedValue({
        chain: 'base',
        hash: EVM_HASH,
        from: '0xfrom',
        to: '0xto',
        value: '0',
        gasUsed: '21000',
        gasPrice: '1000000000',
        status: 'success',
        blockNumber: '0x1',
        blockNumberDecimal: '1',
        timestamp: 1_700_000_000,
      });

    const result = await execute(createConfig(), 'base', EVM_HASH);
    expect(result).toEqual(
      expect.objectContaining({
        chain: 'base',
        transaction_hash: EVM_HASH,
        status: 'success',
      }),
    );
  });

  it('maps a not-found EVM lookup to status not_found', async () => {
    jest
      .spyOn(evmTransactionIntegration, 'fetchTransactionInfo')
      .mockRejectedValue(new Error('Transaction not found'));

    const result = await execute(createConfig(), 'base', EVM_HASH);
    expect(result).toEqual(
      expect.objectContaining({
        status: 'not_found',
        error: 'TRANSACTION_NOT_FOUND',
      }),
    );
  });

  it('rejects a malformed Solana signature', async () => {
    const result = await execute(createConfig(), 'solana', 'not-base58!!');
    expect(result).toEqual({
      error: 'INVALID_TRANSACTION_HASH',
      message: expect.any(String),
    });
  });

  it('returns Solana transaction status on success', async () => {
    jest
      .spyOn(solanaTransactionIntegration, 'fetchSolanaTransactionStatus')
      .mockResolvedValue({
        chain: 'solana',
        transaction_hash: SOLANA_SIG,
        status: 'success',
        slot: 100,
        confirmations: 10,
        err: null,
        blockTime: 1_700_000_000,
        feeLamports: 5000,
      });

    const result = await execute(createConfig(), 'solana', SOLANA_SIG);
    expect(result).toEqual(
      expect.objectContaining({ chain: 'solana', status: 'success' }),
    );
  });
});
