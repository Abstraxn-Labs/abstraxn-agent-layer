import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Deduped directory of wallets that have paid through `POST /mcp`. Rows are upserted via raw
 * parameterized SQL in `WalletTrackingService` (not the ORM's `upsert()`, which can't express an
 * atomic `callCount + 1` on conflict) — `firstSeenAt`/`lastSeenAt` are plain columns, not
 * `@CreateDateColumn`/`@UpdateDateColumn`, since those only fire on ORM-generated writes.
 */
@Entity('observed_wallets')
export class ObservedWallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 42, unique: true })
  walletAddress: string;

  @Column({ type: 'int', default: 1 })
  callCount: number;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  firstSeenAt: Date;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  lastSeenAt: Date;
}
