import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ObservedIp } from '../entities/observed-ip.entity';

/**
 * Deduped, kept-forever record of every distinct IP address that has hit `POST /mcp` — one row
 * per IP, `callCount`/`lastSeenAt` bumped on every repeat hit rather than growing with request
 * volume. Called from `McpController.handlePost()` for every request. Must never throw back into
 * the request path — a DB hiccup here must never fail or delay a real MCP call.
 */
@Injectable()
export class IpTrackingService {
  private readonly logger = new Logger(IpTrackingService.name);

  constructor(
    @InjectRepository(ObservedIp)
    private readonly observedIpRepo: Repository<ObservedIp>,
  ) {}

  async recordHit(ip: string | null | undefined): Promise<void> {
    if (!ip) {
      return;
    }
    try {
      await this.observedIpRepo.query(
        `INSERT INTO "observed_ips" ("ipAddress", "callCount", "firstSeenAt", "lastSeenAt")
         VALUES ($1, 1, now(), now())
         ON CONFLICT ("ipAddress")
         DO UPDATE SET "callCount" = "observed_ips"."callCount" + 1, "lastSeenAt" = now()`,
        [ip],
      );
    } catch (error: unknown) {
      const msg =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Unknown error';
      this.logger.error(`Failed to record IP hit for ip="${ip}": ${msg}`);
    }
  }
}
