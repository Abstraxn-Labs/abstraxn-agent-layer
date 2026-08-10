import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { PaymentPayload } from '@x402/core/types';
import { ObservedWallet } from '../entities/observed-wallet.entity';
import { PublicMcpTransaction } from '../entities/public-mcp-transaction.entity';
import { extractPayerAddressFromPaymentPayload } from './wallet-extraction.util';

export interface RecordPaidCallInput {
  toolName: string;
  paymentPayload: PaymentPayload;
  settlementTxHash?: string | null;
}

/**
 * Best-effort analytics for the 3 payable relay tools: a deduped directory of wallets that have
 * paid, and an append-only history of every paid call. Called only after a tool handler's own
 * relayed call has already resolved to a genuine success (see the tool implementations). Every
 * method here must never throw back into the tool's response path — a DB hiccup here must never
 * fail or delay the caller's actual tool result.
 */
@Injectable()
export class WalletTrackingService {
  private readonly logger = new Logger(WalletTrackingService.name);

  constructor(
    @InjectRepository(ObservedWallet)
    private readonly observedWalletRepo: Repository<ObservedWallet>,
    @InjectRepository(PublicMcpTransaction)
    private readonly transactionRepo: Repository<PublicMcpTransaction>,
  ) {}

  async recordPaidCall(input: RecordPaidCallInput): Promise<void> {
    const walletAddress = extractPayerAddressFromPaymentPayload(
      input.paymentPayload,
    );
    if (!walletAddress) {
      return;
    }

    try {
      const accepted = input.paymentPayload.accepted;
      await Promise.all([
        this.upsertObservedWallet(walletAddress),
        this.transactionRepo.insert({
          walletAddress,
          toolName: input.toolName,
          category: input.toolName.split('.')[0] ?? null,
          network: String(accepted?.network ?? ''),
          asset: String(accepted?.asset ?? ''),
          amountAtomic: String(accepted?.amount ?? ''),
          payTo: String(accepted?.payTo ?? ''),
          settlementTxHash: input.settlementTxHash ?? null,
        }),
      ]);
    } catch (error: unknown) {
      const msg =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Unknown error';
      this.logger.error(
        `Failed to record wallet transaction for tool="${input.toolName}": ${msg}`,
      );
    }
  }

  private async upsertObservedWallet(walletAddress: string): Promise<void> {
    await this.observedWalletRepo.query(
      `INSERT INTO "observed_wallets" ("walletAddress", "callCount", "firstSeenAt", "lastSeenAt")
       VALUES ($1, 1, now(), now())
       ON CONFLICT ("walletAddress")
       DO UPDATE SET "callCount" = "observed_wallets"."callCount" + 1, "lastSeenAt" = now()`,
      [walletAddress],
    );
  }
}
