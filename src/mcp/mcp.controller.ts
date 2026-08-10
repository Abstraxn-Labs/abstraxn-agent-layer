import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpServerFactory } from './mcp-server.factory';
import { IpTrackingService } from './services/ip-tracking.service';

/**
 * Strips control characters (newlines, carriage returns, ANSI escapes, etc.) from a value an
 * anonymous caller fully controls before it ever reaches a log line — otherwise a crafted
 * `method`/tool name can forge fake-looking log lines or corrupt a terminal tailing this
 * service's output. Also caps length so one request can't blow up log line size.
 */
function sanitizeForLog(value: string): string {
  // eslint-disable-next-line no-control-regex -- deliberately matching control chars to strip them
  return value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200);
}

/** `req.body` is untyped JSON-RPC input — never trust its shape before logging from it. */
function describeRpcRequest(body: unknown): {
  method: string;
  toolName?: string;
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { method: 'unknown' };
  }
  const record = body as Record<string, unknown>;
  const method =
    typeof record.method === 'string'
      ? sanitizeForLog(record.method)
      : 'unknown';
  if (method !== 'tools/call') {
    return { method };
  }
  const params = record.params;
  const toolName =
    params && typeof params === 'object' && !Array.isArray(params)
      ? (params as Record<string, unknown>).name
      : undefined;
  return {
    method,
    toolName:
      typeof toolName === 'string' ? sanitizeForLog(toolName) : undefined,
  };
}

/**
 * The only MCP route on this service. Every caller is anonymous by construction — there is no
 * API key, session identity, or tenant to resolve, so unlike a typical Nest controller this
 * reads the raw request body via `@Req()` rather than `@Body() dto:` — the JSON-RPC method
 * dispatch and shape validation happen inside the SDK's own `transport.handleRequest()`, not
 * Nest's global `ValidationPipe` (which has no effect on this route for that reason — do not
 * "fix" this by adding a typed `@Body()` parameter, it would reject valid MCP requests whose
 * shape varies per method).
 *
 * Stateless per request: a fresh `McpServer` + fresh `StreamableHTTPServerTransport` is created
 * for every call (`sessionIdGenerator: undefined`), matching the SDK's own documented pattern
 * for servers with no session state to carry across requests — there is none here, only the
 * persistent tracking DB behind `IpTrackingService`/`WalletTrackingService` (used inside the 3
 * payable tools), which is unrelated to MCP transport state.
 */
@ApiTags('MCP')
@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(
    private readonly mcpServerFactory: McpServerFactory,
    private readonly ipTrackingService: IpTrackingService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Public MCP JSON-RPC endpoint (Streamable HTTP, no API key)',
  })
  async handlePost(@Req() req: Request, @Res() res: Response): Promise<void> {
    const ip = req.ip ?? 'unknown';
    await this.ipTrackingService.recordHit(ip);

    const { method, toolName } = describeRpcRequest(req.body);
    this.logger.log(
      `ip=${ip} method=${method}${toolName ? ` tool=${toolName}` : ''}`,
    );

    const server = this.mcpServerFactory.create();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      // This route never needs a server-initiated push (no session, no GET/SSE support — see
      // rejectGet() below), so a plain JSON response is simpler for every caller than SSE.
      enableJsonResponse: true,
    });

    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Unknown error';
      this.logger.error(`MCP request failed: ${message}`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32603, message: 'Internal server error' },
        });
      }
    }
  }

  /**
   * No session state to close, nothing server-initiated to push over a long-lived stream, and
   * no per-tenant lever to throttle an unlimited-connections abuse pattern on an unauthenticated
   * route — so GET/DELETE (optional per the Streamable HTTP spec) are deliberately not
   * implemented here. POST-based `tools/call` clients are unaffected.
   */
  @Get()
  @HttpCode(HttpStatus.METHOD_NOT_ALLOWED)
  rejectGet(): { error: string; message: string } {
    return {
      error: 'METHOD_NOT_ALLOWED',
      message: 'This server only supports POST for MCP Streamable HTTP.',
    };
  }
}
