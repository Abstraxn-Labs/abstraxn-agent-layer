import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { McpController } from './mcp.controller';
import { McpServerFactory } from './mcp-server.factory';
import { IpTrackingService } from './services/ip-tracking.service';
import { WalletTrackingService } from './services/wallet-tracking.service';

describe('McpController (HTTP smoke test)', () => {
  let app: INestApplication;
  let ipTrackingMock: { recordHit: jest.Mock };

  beforeEach(async () => {
    ipTrackingMock = { recordHit: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [McpController],
      providers: [
        McpServerFactory,
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d?: string) => d ?? '' },
        },
        {
          provide: WalletTrackingService,
          useValue: { recordPaidCall: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: IpTrackingService, useValue: ipTrackingMock },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('initialize returns a valid MCP envelope with serverInfo', async () => {
    const { body } = await request(app.getHttpServer())
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'smoke-test', version: '1.0' },
        },
      })
      .expect(200);

    expect(body.jsonrpc).toBe('2.0');
    expect(body.result.serverInfo.name).toBe('abstraxn-web3-public-mcp');
  });

  it('records the caller IP hit on every POST, without that ever blocking the response', async () => {
    await request(app.getHttpServer())
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
      .expect(200);

    expect(ipTrackingMock.recordHit).toHaveBeenCalledTimes(1);
  });

  it('rejects GET with 405 (no session/SSE support on this route)', async () => {
    await request(app.getHttpServer()).get('/mcp').expect(405);
  });

  it('logs the caller IP and tool name for every tools/call request', async () => {
    // Deliberately an unregistered tool name — the assertion is on what the controller logs
    // before dispatch, not on a real tool executing (which would mean a real network call for
    // most of these tools).
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    await request(app.getHttpServer())
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'not.a.real.tool', arguments: {} },
      });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /^ip=.* method=tools\/call tool=not\.a\.real\.tool$/,
      ),
    );
    logSpy.mockRestore();
  });

  it('logs the method without a tool= suffix for non-tools/call requests', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    await request(app.getHttpServer())
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^ip=.* method=initialize$/),
    );
    logSpy.mockRestore();
  });
});
