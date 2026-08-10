# Abstraxn Public Web3 MCP Service

A standalone, unauthenticated **MCP (Model Context Protocol)** server: 8 read-only chain-data
and pay-per-call relay tools, callable by any MCP client with no API key, account, or signup.
Built on the official [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk)
and NestJS 11.

This is a separate, from-scratch deployable — not a shared workspace/monorepo with any other
Abstraxn service. It exists because several MCP registries (Smithery included) expect a public
MCP server to live in its own dedicated repo, one route, one fixed tool set, reviewable end to
end in a single sitting.

---

## Features

| Area | What it does |
|------|----------------|
| **MCP** | `POST /mcp` — official SDK, Streamable HTTP transport, stateless (a fresh `McpServer` per request — there is no session/tenant state to carry across calls). |
| **8 tools** | 5 free read-only chain tools (`network.*`) + 3 pay-per-call relay tools (`market.crypto`, `web3.lookup`, `travel.search`), priced and settled by the caller's own wallet via the x402 protocol. |
| **Naming** | Dot-notation tool names (`network.blocknumber`, not `get_blocknumber`) — a navigable tree, not a flat list. |
| **Abuse tracking** | Every caller IP and every wallet that completes a paid call is recorded (Postgres) for abuse monitoring and analytics — no other tenant/policy state exists. |
| **Rate limiting** | Global, IP-keyed (`@nestjs/throttler`) — the only lever available on a route with no API key. |
| **Health** | `GET /health` (public, exempt from rate limiting). |

---

## Tech stack

- Node.js `>=20`, npm `>=10`
- NestJS `11`
- `@modelcontextprotocol/sdk` `^1.30.0` (official SDK — not a hand-rolled JSON-RPC dispatcher)
- PostgreSQL + TypeORM `0.3.x` (abuse tracking only — no tenant/policy tables)
- `@x402/core` for x402 header codec (this service never signs a payment itself, only relays)
- `viem` for EVM RPC calls; raw `fetch` JSON-RPC for Solana
- `helmet`, `@nestjs/throttler`

---

## Quick start

```bash
npm install
cp .env.example .env
# Edit .env — Postgres connection, rate limit, optional RPC overrides
npm run start:dev
```

- **API docs (health only):** `http://localhost:3011/api/docs`
- **Health:** `GET http://localhost:3011/health`
- **MCP endpoint:** `POST http://localhost:3011/mcp`

Migrations run automatically on boot (`migrationsRun: true`) — no separate CLI step needed.

---

## Environment variables

See `.env.example` for the full list with defaults. Highlights:

| Variable | Description |
|----------|-------------|
| `PORT` | HTTP port (default `3011`) |
| `POSTGRES_HOST` / `PORT` / `USER` / `PASSWORD` / `DB` | Postgres connection for abuse tracking |
| `PUBLIC_MCP_RATE_LIMIT_PER_MIN` / `_WINDOW_MS` | Global per-IP rate limit (default 30/min) |
| `CHAIN_RPC_*` | Per-chain EVM RPC overrides — safe public defaults are used if unset (see `src/mcp/utils/chain-registry.util.ts`) |
| `SOLANA_RPC_URL` / `SOLANA_DEVNET_RPC_URL` | Solana cluster RPC overrides |
| `UPSTREAM_RELAY_BASE_URL` | Overrides the upstream base URL for the 3 relay tools (never caller-controlled — see the SSRF note below) |

**No auth-related variables exist** — there is nothing to authenticate on this service.

---

## MCP JSON-RPC (`POST /mcp`)

No API key or session header required. Every request must send
`Accept: application/json, text/event-stream` — that's a requirement of the MCP Streamable HTTP
spec itself (checked regardless of response mode), not an auth header. Responses come back as
plain JSON (`enableJsonResponse: true` on the transport) — this route never needs a
server-initiated push, so there's no reason to force SSE parsing on every caller. `GET /mcp`
returns `405` — there is no session state to resume and no reason for a standalone long-lived
stream on a route with zero abuse levers beyond IP rate limiting.

```bash
BASE=http://localhost:3011
ACCEPT='Accept: application/json, text/event-stream'

curl -s -X POST "$BASE/mcp" -H 'Content-Type: application/json' -H "$ACCEPT" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"my-client","version":"1.0"}}}'

curl -s -X POST "$BASE/mcp" -H 'Content-Type: application/json' -H "$ACCEPT" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

curl -s -X POST "$BASE/mcp" -H 'Content-Type: application/json' -H "$ACCEPT" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"network.token_price","arguments":{"symbol":"bitcoin"}}}'
```

### Tools

| Name | Paid | Notes |
|------|------|-------|
| `network.blocknumber` | No | EVM `eth_blockNumber` / Solana `getSlot`. Omit `chain` (or pass `"all"`) to query every resolvable chain in one call. |
| `network.transaction_status` | No | EVM (tx hash) or Solana (signature) — both `chain` and `transaction_hash` required. |
| `network.gas_info` | No | Current gas price + EIP-1559 fee hints for one EVM chain (`chain` required). |
| `network.token_info` | No | ERC-20 name/symbol/decimals/total supply. No balance lookup — this server never binds a caller wallet, so a balance is permanently unavailable, not just unset. |
| `network.token_price` | No | Spot price via CoinGecko. Defaults to ETH/USD. |
| `market.crypto` | Yes | Crypto market-data lookups (CoinGecko-sourced), 6 actions. |
| `web3.lookup` | Yes | Multi-chain wallet/token/ENS/tx-simulation lookups, 7 actions. |
| `travel.search` | Yes | Flight / hotel search, 2 actions. |

For the 3 paid tools: the first call (no `paymentPayload`) returns a non-error result carrying
`{ paymentRequired: <x402 challenge> }`. The caller's own wallet client signs it and retries the
same `tools/call` with `paymentPayload` set to the signed payload — this service never signs or
holds funds on the caller's behalf.

**Cursor / Claude Desktop `mcp.json`:**

```json
{
  "mcpServers": {
    "abstraxn-public-web3": {
      "url": "http://localhost:3011/mcp"
    }
  }
}
```

---

## Database

Three tables, abuse tracking only — no tenant, policy, or config tables exist or will be added:

| Table | Purpose |
|-------|---------|
| `observed_ips` | One deduped row per caller IP, `callCount`/`lastSeenAt` bumped on every hit. |
| `observed_wallets` | One deduped row per wallet address seen paying via x402. |
| `public_mcp_transactions` | Append-only history of every completed paid call (tool, network, asset, amount, payTo, settlement tx hash). |

Every write path is a parameterized `INSERT ... ON CONFLICT` (never string-concatenated SQL) and
is wrapped in try/catch — a DB hiccup here logs and moves on, it never fails or delays a real MCP
call.

---

## Security notes

- **SSRF invariant:** every outbound URL (chain RPC, the upstream relay, CoinGecko) comes from
  server-side env vars or hardcoded defaults — never from a tool argument. No tool accepts a
  `rpcUrl`/`baseUrl` field.
- **No secrets beyond the DB password**, which is env-only and never logged.
- **No auth surface** — there is no user identity, ever, so there is nothing to protect via
  guards/JWT/cookies/CSRF.
- **CORS is wildcard** (`origin: '*'`) paired deliberately with `credentials: false` — nothing
  tenant-specific ever crosses an origin on this service.
- **Rate limiting is global**, keyed by IP — the only lever available with no API key. If this
  sits behind a reverse proxy, set `app.set('trust proxy', ...)` in `main.ts`, or the limiter
  rate-limits the proxy instead of real callers.

---

## Scripts

| Script | Description |
|--------|-------------|
| `npm run start:dev` | Watch mode |
| `npm run build` | Compile to `dist/` |
| `npm run start:prod` | Run `dist/main` |
| `npm run lint` | ESLint |
| `npm test` | Jest (unit + SDK-level integration + HTTP smoke tests) |

---

## Error handling

- **MCP tool errors** use `CallToolResult.isError: true` for genuine failures (bad chain, RPC
  failure, missing param) — a `paymentRequired` challenge is deliberately **not** marked as an
  error, since it's an actionable next step for the caller's wallet layer, not a hard failure.
- **Transport-level failures** (malformed JSON-RPC, unknown tool) surface as standard MCP
  protocol errors from the SDK itself.

See `docs/public-mcp-server-design.md` for the full architecture writeup.
