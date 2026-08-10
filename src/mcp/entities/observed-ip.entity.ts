import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Deduped directory of every distinct IP address that has hit `POST /mcp`. Rows are upserted via
 * raw parameterized SQL in `IpTrackingService` (the ORM's `upsert()` can't express an atomic
 * `callCount + 1` on conflict). Kept forever by design — no retention/cleanup job — so
 * `firstSeenAt`/`lastSeenAt` are plain columns, not `@CreateDateColumn`/`@UpdateDateColumn`,
 * since those only fire on ORM-generated writes.
 */
@Entity('observed_ips')
export class ObservedIp {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** varchar(45) fits the longest textual IPv6 form (incl. embedded IPv4), not just IPv4's 15. */
  @Column({ type: 'varchar', length: 45, unique: true })
  ipAddress: string;

  @Column({ type: 'int', default: 1 })
  callCount: number;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  firstSeenAt: Date;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  lastSeenAt: Date;
}
