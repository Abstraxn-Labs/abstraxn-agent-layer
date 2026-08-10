import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { CustomConfigModule } from '../config/custom-config.module';
import { ObservedIp } from '../mcp/entities/observed-ip.entity';
import { ObservedWallet } from '../mcp/entities/observed-wallet.entity';
import { PublicMcpTransaction } from '../mcp/entities/public-mcp-transaction.entity';

/**
 * The only three tables this service owns: IP/wallet abuse tracking and paid-call history (see
 * ../mcp/entities). No tenant/policy tables — there are no tenants on this service. Migrations
 * run automatically on boot (`migrationsRun: true`), same convention as this org's other current
 * services — no separate CLI `DataSource` file needed for a schema this small.
 */
@Module({
  imports: [
    CustomConfigModule,
    TypeOrmModule.forRootAsync({
      imports: [CustomConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const password = configService.get<string>('POSTGRES_PASSWORD', '');
        if (!password) {
          throw new Error(
            "POSTGRES_PASSWORD is not set — configure it in your deployment's own .env.",
          );
        }
        return {
          type: 'postgres' as const,
          host: configService.get<string>('POSTGRES_HOST', 'localhost'),
          port: parseInt(
            configService.get<string>('POSTGRES_PORT', '5432'),
            10,
          ),
          username: configService.get<string>('POSTGRES_USER', 'postgres'),
          password,
          database: configService.get<string>('POSTGRES_DB', 'web3_public_mcp'),
          entities: [ObservedIp, ObservedWallet, PublicMcpTransaction],
          migrations: [join(__dirname, 'migrations/*{.ts,.js}')],
          migrationsRun: true,
          migrationsTableName: 'migrations',
          synchronize: false,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
