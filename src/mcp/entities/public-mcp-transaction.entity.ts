import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Append-only history of every paid `POST /mcp` call. Every row represents an already
 * successful, settled payment by construction — enforced at the call site (only the 3 relay
 * tools call `WalletTrackingService.recordPaidCall()`, and only after a genuinely successful
 * relayed result), not by a status column.
 *
 * No FK on `walletAddress` — this is a cross-cutting log table, not a tenant relationship (there
 * are no tenants on this service). `category` is derived directly from the tool's own
 * dot-notation namespace (`toolName.split('.')[0]`) at write time — no separate hand-maintained
 * category map needed, unlike the service this was ported from, because the naming scheme here
 * already encodes it.
 */
@Entity('public_mcp_transactions')
@Index('IDX_public_mcp_transactions_createdAt', ['createdAt'])
@Index('IDX_public_mcp_transactions_wallet_createdAt', [
  'walletAddress',
  'createdAt',
])
@Index('IDX_public_mcp_transactions_tool_createdAt', ['toolName', 'createdAt'])
export class PublicMcpTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 42 })
  walletAddress: string;

  @Column({ type: 'varchar', length: 128 })
  toolName: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  category: string | null;

  @Column({ type: 'varchar', length: 64 })
  network: string;

  @Column({ type: 'varchar', length: 64 })
  asset: string;

  /** Raw on-chain atomic amount — varchar, not bigint, since an 18-decimal token's atomic
   * amount can exceed bigint's practical range at just ~9 whole tokens. */
  @Column({ type: 'varchar', length: 64 })
  amountAtomic: string;

  @Column({ type: 'varchar', length: 64 })
  payTo: string;

  /** This service never settles payments itself (every payable tool is a pure relay whose
   * upstream settles it) — always null in practice, kept nullable for forward compatibility. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  settlementTxHash: string | null;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
