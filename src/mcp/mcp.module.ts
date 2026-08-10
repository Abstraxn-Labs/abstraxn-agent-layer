import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { McpController } from './mcp.controller';
import { McpServerFactory } from './mcp-server.factory';
import { IpTrackingService } from './services/ip-tracking.service';
import { WalletTrackingService } from './services/wallet-tracking.service';
import { ObservedIp } from './entities/observed-ip.entity';
import { ObservedWallet } from './entities/observed-wallet.entity';
import { PublicMcpTransaction } from './entities/public-mcp-transaction.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ObservedIp,
      ObservedWallet,
      PublicMcpTransaction,
    ]),
  ],
  controllers: [McpController],
  providers: [McpServerFactory, IpTrackingService, WalletTrackingService],
})
export class McpModule {}
