import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CustomConfigModule } from './config/custom-config.module';
import { DatabaseModule } from './database/database.module';
import { McpModule } from './mcp/mcp.module';

@Module({
  imports: [
    CustomConfigModule,
    DatabaseModule,
    ThrottlerModule.forRootAsync({
      imports: [CustomConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => [
        {
          ttl:
            Number(configService.get('PUBLIC_MCP_RATE_LIMIT_WINDOW_MS')) ||
            60_000,
          limit:
            Number(configService.get('PUBLIC_MCP_RATE_LIMIT_PER_MIN')) || 30,
        },
      ],
    }),
    McpModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
