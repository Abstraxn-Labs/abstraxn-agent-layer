# Contributing

Thanks for your interest in improving the Abstraxn Public Web3 MCP Service.

## Development setup

```bash
npm install
cp .env.example .env
# Edit .env — Postgres connection, rate limit, optional RPC overrides
npm run start:dev
```

- `npm run start:dev` — watch mode, `http://localhost:3011`.
- `npm run build` — compiles `src/` to `dist/` with `nest build`.
- `npm test` — Jest (unit + SDK-level integration + HTTP smoke tests).
- `npm run lint` — ESLint with `--fix`.

## Adding a new MCP tool

1. Add `src/mcp/tools/<name>.tool.ts`, following an existing tool (e.g.
   [`network-blocknumber.tool.ts`](src/mcp/tools/network-blocknumber.tool.ts)) as the template:
   a `registerXxxTool(server, ...)` function that calls `server.registerTool` with a Zod
   `inputSchema`/`outputSchema` and `annotations` (`readOnlyHint`, `destructiveHint`, etc.).
2. Use **dot-notation naming** (`network.*`, `market.*`, `web3.*`, `travel.*`) — a navigable tree,
   not a flat list of `snake_case` names.
3. Return results via [`toToolResult`](src/mcp/utils/tool-result.util.ts) and log failures via
   [`createToolLogger`/`logToolFailure`](src/mcp/utils/tool-logging.util.ts) — don't throw raw
   errors out of a tool handler.
4. Register the tool in [`McpServerFactory.create()`](src/mcp/mcp-server.factory.ts).
5. If the tool is pay-per-call, follow the existing x402 challenge/retry pattern used by
   `market.crypto` / `web3.lookup` / `travel.search` (see
   [`x402-relay.util.ts`](src/mcp/utils/x402-relay.util.ts)) rather than inventing a new payment
   flow.
6. Add a matching `<name>.tool.spec.ts` next to the tool file.

## SSRF invariant — non-negotiable

Every outbound URL (chain RPC, the upstream relay, CoinGecko) must come from server-side env vars
or hardcoded defaults in [`chain-registry.util.ts`](src/mcp/utils/chain-registry.util.ts) — **never**
from a tool argument. No tool may accept a caller-supplied `rpcUrl`/`baseUrl`/similar field. This
service has no auth surface, so this is the only thing standing between a public MCP call and an
internal-network request.

## Definition of done

- `npm run lint && npm test && npm run build` all pass.
- No secrets committed; new required env vars are added to `.env.example` with a comment on
  where to get them.
- New tools are read-only by default unless they genuinely need to be pay-per-call.
- README's [Tools table](README.md#tools) and [Environment variables](README.md#environment-variables)
  section are updated if you added a tool or env var.

## Reporting bugs / security issues

- **Bugs** — open a GitHub issue with reproduction steps (which tool, `chain`/params used, and
  the response you got).
- **Security issues** — this is an unauthenticated, internet-facing endpoint. Anything resembling
  an SSRF, an auth/rate-limit bypass, or a way to make the abuse-tracking tables (see README's
  [Database](README.md#database) section) record or leak data they shouldn't should be reported
  privately rather than filed as a public issue.
