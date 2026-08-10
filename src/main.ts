import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { resolveUpstreamRelayBaseUrl } from './mcp/utils/x402-relay.util';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Fails at boot, not on a real caller's first paid tool call — reuses the same check
  // callUpstreamRelayEndpoint already runs per-request, just run once up front.
  resolveUpstreamRelayBaseUrl(app.get(ConfigService));

  // Only meaningful when TRUST_PROXY is set — a deployment behind a reverse proxy/LB must opt
  // in explicitly (e.g. "1" for one hop, or a specific proxy IP/CIDR), matching Express's own
  // trust-proxy semantics. Without this, req.ip resolves to the proxy's own address for every
  // caller once one sits in front of this service, which silently collapses ThrottlerGuard's
  // per-IP rate limit into one shared bucket and makes IP-based abuse tracking/logging useless.
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) {
    app.set('trust proxy', trustProxy === 'true' ? true : trustProxy);
  }

  app.use(
    helmet({
      // Every route here is intentionally public with wildcard CORS — this policy keeps
      // helmet's default cross-origin isolation headers from blocking that.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // No auth layer to disincentivize an oversized-body DoS attempt, so cap it explicitly.
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));

  app.enableCors({
    origin: '*',
    credentials: false,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Accept', 'Mcp-Session-Id'],
  });

  // No @Body() DTO exists anywhere on this service (see McpController's own comment on why
  // /mcp reads the raw body instead) — a global ValidationPipe would have nothing to validate,
  // so it's deliberately not registered here rather than kept as dead configuration.

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Abstraxn Public Web3 MCP Service API')
    .setDescription(
      'REST surface for the public Web3 MCP service — only /health is a REST endpoint; ' +
        '/mcp is an MCP Streamable HTTP (JSON-RPC 2.0) endpoint and is not modeled as a REST DTO here.',
    )
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = parseInt(process.env.PORT || '3011', 10);
  await app.listen(port);
}

bootstrap().catch((error: unknown) => {
  Logger.error('Error starting the application', error);
  process.exit(1);
});
