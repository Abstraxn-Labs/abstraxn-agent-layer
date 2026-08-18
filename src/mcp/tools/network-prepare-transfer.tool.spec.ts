import { ConfigService } from '@nestjs/config';
import {
  execute,
  registerPrepareTransferTool,
} from './network-prepare-transfer.tool';
import * as transferChainUtil from '../utils/transfer-chain.util';
import * as evmTransferTxUtil from '../utils/evm-transfer-tx.util';
import * as solanaTransferTxUtil from '../utils/solana-transfer-tx.util';

function createConfig(): ConfigService {
  return {
    get: (_key: string, defaultValue?: string) => defaultValue ?? '',
  } as ConfigService;
}

const EVM_FROM = `0x${'1'.repeat(40)}`;
const EVM_TO = `0x${'2'.repeat(40)}`;
const SOLANA_FROM = '11111111111111111111111111111111';
const SOLANA_TO = 'So11111111111111111111111111111111111111112';

describe('registerPrepareTransferTool', () => {
  it('registers under the network.prepare_transfer dot-notation name', () => {
    const server = { registerTool: jest.fn() };
    registerPrepareTransferTool(server as never, createConfig());
    expect(server.registerTool.mock.calls[0][0]).toBe(
      'network.prepare_transfer',
    );
  });
});

describe('network.prepare_transfer execute', () => {
  afterEach(() => jest.restoreAllMocks());

  it('rejects a missing from', async () => {
    const result = await execute(
      createConfig(),
      'base',
      '   ',
      EVM_TO,
      '1',
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(result).toEqual({
      error: 'MISSING_FROM',
      message: expect.any(String),
    });
  });

  it('rejects a missing to', async () => {
    const result = await execute(
      createConfig(),
      'base',
      EVM_FROM,
      '   ',
      '1',
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(result).toEqual({
      error: 'MISSING_RECIPIENT',
      message: expect.any(String),
    });
  });

  it('rejects a missing amount', async () => {
    const result = await execute(
      createConfig(),
      'base',
      EVM_FROM,
      EVM_TO,
      '   ',
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(result).toEqual({
      error: 'MISSING_AMOUNT',
      message: expect.any(String),
    });
  });

  it('rejects malformed hex data', async () => {
    const result = await execute(
      createConfig(),
      'base',
      EVM_FROM,
      EVM_TO,
      '1',
      undefined,
      undefined,
      'not-hex',
      undefined,
    );
    expect(result).toEqual({
      error: 'INVALID_DATA',
      message: expect.any(String),
    });
  });

  it('rejects private:true on a non-BITE chain', async () => {
    const result = await execute(
      createConfig(),
      'base',
      EVM_FROM,
      EVM_TO,
      '1',
      undefined,
      undefined,
      undefined,
      true,
    );
    expect(result).toEqual({
      error: 'UNSUPPORTED_PRIVACY',
      message: expect.any(String),
    });
  });

  it('rejects private:true on Solana', async () => {
    const result = await execute(
      createConfig(),
      'solana',
      SOLANA_FROM,
      SOLANA_TO,
      '1',
      undefined,
      undefined,
      undefined,
      true,
    );
    expect(result).toEqual({
      error: 'UNSUPPORTED_PRIVACY',
      message: expect.any(String),
    });
  });

  it('rejects raw calldata on Solana', async () => {
    const result = await execute(
      createConfig(),
      'solana',
      SOLANA_FROM,
      SOLANA_TO,
      '1',
      undefined,
      undefined,
      '0x1234',
      undefined,
    );
    expect(result).toEqual({
      error: 'UNSUPPORTED_DATA',
      message: expect.any(String),
    });
  });

  it('rejects an invalid EVM sender', async () => {
    const result = await execute(
      createConfig(),
      'base',
      'not-an-address',
      EVM_TO,
      '1',
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(result).toEqual({
      error: 'INVALID_FROM',
      message: expect.any(String),
    });
  });

  it('rejects an invalid EVM recipient', async () => {
    const result = await execute(
      createConfig(),
      'base',
      EVM_FROM,
      'not-an-address',
      '1',
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(result).toEqual({
      error: 'INVALID_RECIPIENT',
      message: expect.any(String),
    });
  });

  it('rejects an invalid Solana recipient', async () => {
    const result = await execute(
      createConfig(),
      'solana',
      SOLANA_FROM,
      'not-base58!!',
      '1',
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(result).toEqual({
      error: 'INVALID_RECIPIENT',
      message: expect.any(String),
    });
  });

  it('builds an unsigned native EVM transfer on success', async () => {
    jest.spyOn(transferChainUtil, 'resolveEvmToken').mockResolvedValue({
      tokenLabel: 'ETH',
      contract: null,
      decimals: 18,
    });
    jest
      .spyOn(evmTransferTxUtil, 'buildEvmUnsignedTransferTx')
      .mockResolvedValue({
        type: 'evm_unsigned_v1',
        chainId: '0x2105',
        from: EVM_FROM,
        to: EVM_TO,
        value: '0xde0b6b3a7640000',
        data: '0x',
        nonce: '0x1',
        gas: '0x5208',
        maxFeePerGas: '0x1',
        maxPriorityFeePerGas: '0x1',
      });

    const result = await execute(
      createConfig(),
      'base',
      EVM_FROM,
      EVM_TO,
      '1',
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: 'unsigned_transaction_ready',
        chain: 'base',
        from: EVM_FROM,
        to: EVM_TO,
        token: 'ETH',
        tokenContract: null,
        amountAtomic: (10n ** 18n).toString(),
      }),
    );
  });

  it('rejects a zero EVM token amount', async () => {
    jest.spyOn(transferChainUtil, 'resolveEvmToken').mockResolvedValue({
      tokenLabel: 'ETH',
      contract: null,
      decimals: 18,
    });

    const result = await execute(
      createConfig(),
      'base',
      EVM_FROM,
      EVM_TO,
      '0',
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(result).toEqual({
      error: 'INVALID_AMOUNT',
      message: expect.any(String),
    });
  });

  it('builds an unsigned native Solana transfer on success', async () => {
    jest
      .spyOn(solanaTransferTxUtil, 'buildSolanaUnsignedTransferTx')
      .mockResolvedValue({
        type: 'solana_unsigned_v1',
        encoding: 'base64',
        transaction: 'BASE64==',
        recentBlockhash: 'abc',
        feePayer: SOLANA_FROM,
      });

    const result = await execute(
      createConfig(),
      'solana',
      SOLANA_FROM,
      SOLANA_TO,
      '1',
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: 'unsigned_transaction_ready',
        chain: 'solana',
        token: 'SOL',
        tokenContract: null,
        amountAtomic: (10n ** 9n).toString(),
      }),
    );
  });
});
