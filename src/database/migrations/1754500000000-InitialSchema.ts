import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1754500000000 implements MigrationInterface {
  name = 'InitialSchema1754500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "observed_ips" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "ipAddress" character varying(45) NOT NULL,
        "callCount" integer NOT NULL DEFAULT 1,
        "firstSeenAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "lastSeenAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_observed_ips" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_observed_ips_ipAddress" UNIQUE ("ipAddress")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "observed_wallets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "walletAddress" character varying(42) NOT NULL,
        "callCount" integer NOT NULL DEFAULT 1,
        "firstSeenAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "lastSeenAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_observed_wallets" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_observed_wallets_walletAddress" UNIQUE ("walletAddress")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "public_mcp_transactions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "walletAddress" character varying(42) NOT NULL,
        "toolName" character varying(128) NOT NULL,
        "category" character varying(32),
        "network" character varying(64) NOT NULL,
        "asset" character varying(64) NOT NULL,
        "amountAtomic" character varying(64) NOT NULL,
        "payTo" character varying(64) NOT NULL,
        "settlementTxHash" character varying(128),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_public_mcp_transactions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_public_mcp_transactions_createdAt" ON "public_mcp_transactions" ("createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_public_mcp_transactions_wallet_createdAt" ON "public_mcp_transactions" ("walletAddress", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_public_mcp_transactions_tool_createdAt" ON "public_mcp_transactions" ("toolName", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "public_mcp_transactions" CASCADE`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "observed_wallets" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "observed_ips" CASCADE`);
  }
}
