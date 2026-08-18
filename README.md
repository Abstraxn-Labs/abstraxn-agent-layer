# Abstraxn Public Web3 MCP Service

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)

A free, public **[MCP](https://modelcontextprotocol.io) (Model Context Protocol) server** for
Web3 data. Point any MCP client — Claude Desktop, Cursor, your own agent — at it and it can read
live chain data (block height, gas, transaction status, ERC-20 info, spot prices), build unsigned
EVM/Solana transfer transactions, and, for a handful of pay-per-call tools, look up market data,
wallets/tokens/ENS, travel search, places/solar/aerial-view data, and social-profile identity.

**No API key, no account, no signup.** Free tools are open to anyone; paid tools are settled
directly from the caller's own wallet via the [x402](https://www.x402.org) payment protocol —
this service never holds or signs funds on your behalf.

Built on the official [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk)
and [NestJS](https://nestjs.com) 11.

## Contents

- [Quick start](#quick-start)
- [Use it from Claude Desktop / Cursor](#use-it-from-claude-desktop--cursor)
- [Available tools](#available-tools)
- [Calling tools directly (curl)](#calling-tools-directly-curl)
- [Configuration](#configuration)
- [How it works](#how-it-works)
- [Database](#database)
- [Security](#security)
- [Scripts](#scripts)
- [Contributing](#contributing)

---

## Quick start

```bash
git clone https://github.com/Abstraxn-Labs/abstraxn-agent-layer.git
cd abstraxn-agent-layer
npm install
cp .env.example .env
# Edit .env: Postgres connection + UPSTREAM_RELAY_BASE_URL / ENRICHMENT_RELAY_BASE_URL
# (each required for its own group of paid tools)
npm run start:dev
```

- Health check: `GET http://localhost:3011/health`
- MCP endpoint: `POST http://localhost:3011/mcp`
- API docs (health only): `http://localhost:3011/api/docs`

Database migrations run automatically on boot — no separate CLI step needed.

## Use it from Claude Desktop / Cursor

Add this to your MCP client's config (e.g. `claude_desktop_config.json` or Cursor's `mcp.json`):

```json
{
  "mcpServers": {
    "abstraxn-public-web3": {
      "url": "http://localhost:3011/mcp"
    }
  }
}
```

Restart the client and the tools below become available to it — no further setup.

## Available tools

| Tool | Paid? | What it does |
|------|-------|--------------|
| `network.blocknumber` | No | Current EVM block number or Solana slot. Query one chain or all at once. |
| `network.transaction_status` | No | Look up a transaction/signature by hash on EVM or Solana. |
| `network.gas_info` | No | Current gas price + EIP-1559 fee hints for an EVM chain. |
| `network.token_info` | No | ERC-20 name / symbol / decimals / total supply. |
| `network.token_price` | No | Spot price via CoinGecko (defaults to ETH/USD). |
| `network.prepare_transfer` | No | Build an unsigned native/ERC-20/SPL transfer transaction from an explicit `from`/`to`/`amount`. Never signs or broadcasts. |
| `market.crypto` | Yes | Crypto market-data lookups (CoinGecko-sourced), 6 actions. |
| `web3.lookup` | Yes | Multi-chain wallet / token / ENS / tx-simulation lookups, 7 actions. |
| `travel.search` | Yes | Flight and hotel search, 2 actions. |
| `places.lookup` | Yes | Place / solar / aerial-view lookups, 11 actions. |
| `social.profile_lookup` | Yes | Person / social-profile identity resolution for a batch of records. |

Tools are namespaced by area (`network.*`, `market.*`, `web3.*`, `travel.*`, `places.*`,
`social.*`) so an MCP client can browse them as a tree rather than a flat list.

**How paid tools work:** call one with no payment, and you get back a `paymentRequired` challenge
(not an error). Your wallet client signs it and retries the same call with `paymentPayload` set —
your wallet pays directly; this service only relays the request.

## Calling tools directly (curl)

Most people will use an MCP client (above), but the endpoint is plain JSON-RPC over HTTP if you
want to script against it directly:

```bash
BASE=http://localhost:3011
ACCEPT='Accept: application/json, text/event-stream'   # required by the MCP spec

# 1. Initialize a session
curl -s -X POST "$BASE/mcp" -H 'Content-Type: application/json' -H "$ACCEPT" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"my-client","version":"1.0"}}}'

# 2. List available tools
curl -s -X POST "$BASE/mcp" -H 'Content-Type: application/json' -H "$ACCEPT" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# 3. Call a tool
curl -s -X POST "$BASE/mcp" -H 'Content-Type: application/json' -H "$ACCEPT" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"network.token_price","arguments":{"symbol":"bitcoin"}}}'
```

`GET /mcp` returns `405` by design — every call is stateless, so there's no session to resume.

## Configuration

Copy [`.env.example`](.env.example) to `.env`. Everything has a safe default except the one
marked **required**:

| Variable | Required | Description |
|----------|----------|--------------|
| `PORT` | No | HTTP port (default `3011`) |
| `POSTGRES_HOST` / `PORT` / `USER` / `PASSWORD` / `DB` | No | Postgres connection, used only for abuse tracking |
| `PUBLIC_MCP_RATE_LIMIT_PER_MIN` / `_WINDOW_MS` | No | Global per-IP rate limit (default 30/min) |
| `CHAIN_RPC_*` | No | Per-chain EVM RPC overrides — public defaults are used if unset (see `src/mcp/utils/chain-registry.util.ts`) |
| `SOLANA_RPC_URL` / `SOLANA_DEVNET_RPC_URL` | No | Solana cluster RPC overrides |
| `UPSTREAM_RELAY_BASE_URL` | **Yes** | Base URL for the upstream relay behind `market.crypto` / `web3.lookup` / `travel.search` — no default is committed, so those 3 tools fail until this is set |
| `ENRICHMENT_RELAY_BASE_URL` | **Yes** | Base URL for the upstream relay behind `places.lookup` / `social.profile_lookup` — a separate upstream from `UPSTREAM_RELAY_BASE_URL`, no default is committed |

## How it works

```
MCP client (Claude Desktop, Cursor, your agent)
    → POST /mcp  (this service, stateless — a fresh McpServer per request)
    → free tools: direct chain RPC / CoinGecko calls
    → paid tools: relayed upstream, settled by the caller's wallet via x402
```

This is a single, standalone deployable — it doesn't share a workspace or database with any
other Abstraxn service. That's deliberate: several MCP registries expect a public MCP server to
live in its own repo with one route and one fixed tool set, reviewable end to end.

**Stack:** Node.js 20+ · NestJS 11 · [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk)
`^1.30.0` (official SDK) · PostgreSQL + TypeORM · [`@x402/core`](https://www.x402.org) ·
`viem` (EVM) + raw JSON-RPC (Solana reads) · `@solana/web3.js` + `@solana/spl-token` (Solana
transfer building) · `@skalenetwork/bite` (SKALE privacy-encrypted transfers) · `helmet`,
`@nestjs/throttler`

## Database

Postgres is used for abuse tracking only — no tenant, policy, or config tables exist:

| Table | Purpose |
|-------|---------|
| `observed_ips` | One row per caller IP, with a running call count and last-seen time. |
| `observed_wallets` | One row per wallet address seen paying via x402. |
| `public_mcp_transactions` | Append-only history of completed paid calls. |

If Postgres is unreachable, a call still succeeds — tracking writes are best-effort and never
block or fail a real MCP request.

## Security

Since anyone can call this service with no key, a few invariants matter:

- **No SSRF surface:** every outbound URL (chain RPC, upstream relay, CoinGecko) comes from
  server-side config — no tool accepts a caller-supplied URL.
- **Rate limiting is global and IP-keyed** — the only lever available with no accounts. If you
  deploy behind a reverse proxy, set `app.set('trust proxy', ...)` in `main.ts`, or the limiter
  ends up rate-limiting the proxy instead of real callers.
- **No secrets beyond the DB password**, which is env-only and never logged.
- **CORS is wildcard** by design — nothing tenant-specific ever crosses an origin here.

Found a security issue? See [CONTRIBUTING.md](CONTRIBUTING.md#reporting-bugs--security-issues)
before opening a public issue.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run start:dev` | Run in watch mode |
| `npm run build` | Compile to `dist/` |
| `npm run start:prod` | Run the compiled build (`dist/main`) |
| `npm run lint` | ESLint |
| `npm test` | Jest — unit, SDK-level integration, and HTTP smoke tests |

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for how to add a new tool
and the project's definition of done.

**License:** [MIT](LICENSE)
