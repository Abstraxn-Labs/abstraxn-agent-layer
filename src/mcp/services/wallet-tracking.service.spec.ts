import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { WalletTrackingService } from './wallet-tracking.service';
import { ObservedWallet } from '../entities/observed-wallet.entity';
import { PublicMcpTransaction } from '../entities/public-mcp-transaction.entity';

const VALID_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const VALID_ADDRESS_CHECKSUMMED = '0x1234567890AbcdEF1234567890aBcdef12345678';

function makePaymentPayload(from: string) {
  return {
    x402Version: 2,
    accepted: {
      scheme: 'exact',
      network: 'base',
      asset: '0xasset',
      amount: '1000',
      payTo: '0xpayto',
      maxTimeoutSeconds: 300,
      extra: {},
    },
    payload: {
      signature: '0xdeadbeef',
      authorization: {
        from,
        to: '0xpayto',
        value: '1000',
        validAfter: '0',
        validBefore: '9999999999',
        nonce: '0x00',
      },
    },
  } as never;
}

describe('WalletTrackingService', () => {
  let service: WalletTrackingService;
  let observedWalletRepo: jest.Mocked<
    Pick<Repository<ObservedWallet>, 'query'>
  >;
  let transactionRepo: jest.Mocked<
    Pick<Repository<PublicMcpTransaction>, 'insert'>
  >;

  beforeEach(async () => {
    observedWalletRepo = { query: jest.fn().mockResolvedValue(undefined) };
    transactionRepo = { insert: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletTrackingService,
        {
          provide: getRepositoryToken(ObservedWallet),
          useValue: observedWalletRepo,
        },
        {
          provide: getRepositoryToken(PublicMcpTransaction),
          useValue: transactionRepo,
        },
      ],
    }).compile();

    service = module.get(WalletTrackingService);
  });

  it('does nothing when no wallet can be extracted (free/unpaid call)', async () => {
    await service.recordPaidCall({
      toolName: 'network.blocknumber',
      paymentPayload: undefined,
    });
    expect(observedWalletRepo.query).not.toHaveBeenCalled();
    expect(transactionRepo.insert).not.toHaveBeenCalled();
  });

  it('upserts the wallet with an atomic increment, not a naive overwrite', async () => {
    await service.recordPaidCall({
      toolName: 'market.crypto',
      paymentPayload: makePaymentPayload(VALID_ADDRESS),
    });

    expect(observedWalletRepo.query).toHaveBeenCalledTimes(1);
    const [sql, params] = observedWalletRepo.query.mock.calls[0];
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('"callCount" + 1');
    expect(params).toEqual([VALID_ADDRESS_CHECKSUMMED]);
  });

  it('inserts a transaction row with category derived from the dot-notation tool name', async () => {
    await service.recordPaidCall({
      toolName: 'market.crypto',
      paymentPayload: makePaymentPayload(VALID_ADDRESS),
    });

    expect(transactionRepo.insert).toHaveBeenCalledWith({
      walletAddress: VALID_ADDRESS_CHECKSUMMED,
      toolName: 'market.crypto',
      category: 'market',
      network: 'base',
      asset: '0xasset',
      amountAtomic: '1000',
      payTo: '0xpayto',
      settlementTxHash: null,
    });
  });

  it('populates settlementTxHash when explicitly provided', async () => {
    await service.recordPaidCall({
      toolName: 'web3.lookup',
      paymentPayload: makePaymentPayload(VALID_ADDRESS),
      settlementTxHash: '0xsettledtx',
    });

    expect(transactionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'web3',
        settlementTxHash: '0xsettledtx',
      }),
    );
  });

  it('catches and logs a repository failure without rejecting', async () => {
    observedWalletRepo.query.mockRejectedValueOnce(new Error('db down'));

    await expect(
      service.recordPaidCall({
        toolName: 'travel.search',
        paymentPayload: makePaymentPayload(VALID_ADDRESS),
      }),
    ).resolves.toBeUndefined();
  });
});
