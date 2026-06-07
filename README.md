# x402 Gateway — A2A Compute Relay

Agent-to-Agent compute relay that routes LLM requests to upstream providers with per-request x402 cryptocurrency payment. No API keys, no accounts — pay per request with on-chain USDC.

> **📌 当前里程碑**: [`milestone-x402-v2`](https://github.com/zcf-cyber/x402-gateway/releases/tag/milestone-x402-v2) — x402 v2 官方协议标准对齐完成。若后续迭代出现架构灾难，`git checkout milestone-x402-v2` 可回滚。

## Quick Start

Prerequisites: Node.js 20+, pnpm, Docker

```bash
# Install dependencies
pnpm install

# Start local PostgreSQL + Redis
pnpm db:up

# Copy env and configure
cp .env.example .env
# Edit .env: set CHALLENGE_SECRET (facilitator private key), MERCHANT_ADDRESS, upstream API keys

# Start dev server
pnpm dev
```

Server starts at `http://localhost:3000`.

## Architecture

```
Client (e.g. @x402/fetch)
  │
  ├── POST /v1/chat/completions (no payment)
  │     ← 402 + PAYMENT-REQUIRED header (scheme, network CAIP-2, amount, payTo, extra)
  │
  ├── POST /v1/chat/completions + PAYMENT-SIGNATURE header
  │     │
  │     ▼
  │   PaymentOrchestrator (src/gateway/orchestrator.ts)
  │     ├── transport/decode ──► PAYMENT-SIGNATURE → PaymentPayloadV2
  │     ├── SchemeRegistry.verify ──► ExactScheme (EIP-3009 signature recovery)
  │     ├── RouterService ──► ProviderAdapter ──► LLM Provider
  │     ├── Billing (meter → cost → validate → ledger)
  │     ├── SchemeRegistry.settle ──► transferWithAuthorization (链上结算)
  │     └── Audit (trace → receipt)
  │
  │     ← 200 + PAYMENT-RESPONSE header + usage_receipt + settlement
```

### Modules

| Module | Path | Responsibility |
|---|---|---|
| Gateway | `src/gateway/` | Thin HTTP handlers, schema validation, trace-id injection, orchestrator |
| x402 Transport | `src/x402/transport/` | v2 header encode/decode (base64url), CAIP-2 chain identifiers |
| x402 Schemes | `src/x402/schemes/` | Extensible payment scheme dispatch (Strategy Pattern). Exact scheme: EIP-3009 verify + settle |
| x402 Verify | `src/x402/verify/` | Legacy compatibility wrapper (deprecated, use SchemeRegistry instead) |
| Router | `src/router/` | Manual model routing, provider fallback service (HA failover) |
| Provider | `src/provider/` | Upstream model adapters, model catalog registry |
| Billing | `src/billing/` | Payment estimation, token metering, cost breakdown, append-only ledger |
| Audit | `src/audit/` | Request trace persistence, receipt query |

## x402 v2 Payment Flow

### Headers

| Header | Direction | Format | Description |
|---|---|---|---|
| `PAYMENT-REQUIRED` | Server → Client (402) | base64url JSON | Payment requirements: scheme, network (CAIP-2), asset, amount, payTo, extra |
| `PAYMENT-SIGNATURE` | Client → Server | base64url JSON | Signed payment payload with EIP-3009 authorization |
| `PAYMENT-RESPONSE` | Server → Client (200) | base64url JSON | Settlement result: success, transaction hash, network |
| `idempotency-key` | Client → Server | UUID v4 | Optional idempotent retry |

### Flow

1. Client sends `POST /v1/chat/completions` without `PAYMENT-SIGNATURE`
2. Server returns `402 Payment Required` with `PAYMENT-REQUIRED` header containing:
   ```json
   {
     "x402Version": 2,
     "accepts": [{
       "scheme": "exact",
       "network": "eip155:8453",
       "asset": "USDC",
       "amount": "0.0007035",
       "payTo": "0x...",
       "maxTimeoutSeconds": 300,
       "extra": { "quote_id": "...", "request_hash": "rh_..." }
     }]
   }
   ```
3. Client signs EIP-3009 `TransferWithAuthorization` message
4. Client retries with `PAYMENT-SIGNATURE` header (base64url-encoded `PaymentPayloadV2`)
5. Server verifies EIP-712 signature via `recoverTypedDataAddress`, validates temporal constraints and payment sufficiency
6. Server routes request to upstream model, calculates cost, commits to ledger
7. Server settles on-chain via `transferWithAuthorization`, returns 200 with `PAYMENT-RESPONSE` header + `usage_receipt`

### CAIP-2 Chain Identifiers

| Chain Name | CAIP-2 |
|---|---|
| Ethereum | `eip155:1` |
| Base | `eip155:8453` |
| Arbitrum | `eip155:42161` |
| Optimism | `eip155:10` |
| Polygon | `eip155:137` |
| Avalanche | `eip155:43114` |
| Solana | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |

### Scheme System

Payment schemes follow Strategy Pattern. Adding a new scheme (e.g., `upto`):

```
1. Create src/x402/schemes/upto/index.ts implementing PaymentScheme
2. Register: schemeRegistry.register(createUptoScheme())
3. Zero changes to orchestrator, routes, or ServiceContainer
```

### API Endpoints

| Method | Path | Description | Auth |
|---|---|---|---|
| `POST` | `/v1/chat/completions` | OpenAI-compatible chat completion with x402 payment | x402 v2 |
| `GET` | `/v1/models` | Model catalog and pricing metadata | None |
| `GET` | `/v1/audit/requests/:request_id` | Audit query for route and settlement evidence | None |

## Tester Guide

### Prerequisites

- Node.js 20+, pnpm
- `.env` configured with valid `MERCHANT_ADDRESS` and provider API keys

### Quick Smoke Test

```bash
# 1. Start server
pnpm dev

# 2. Get 402 challenge (no payment)
curl -s -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"openai/gpt-4o","messages":[{"role":"user","content":"Hello"}]}' \
  -D - | head -20

# Expected: HTTP/1.1 402 Payment Required
#           PAYMENT-REQUIRED: <base64url>
#           body: {"error":{"code":"payment_required"}, "payment_requirements":{...}}

# 3. Decode PAYMENT-REQUIRED header (for inspection)
echo "<paste-header-value>" | base64 -d | python3 -m json.tool

# Expected: {"x402Version":2, "accepts":[{...}]}
```

### End-to-End with Mock Payment

```bash
# Build a signed payment payload (test only — not real on-chain signature)
# Use helpers from test/helpers.ts: createPaymentSignatureHeader()

# Submit with PAYMENT-SIGNATURE
SIG=$(node -e "
  const p = {
    x402Version:2,
    accepted:{scheme:'exact',network:'eip155:8453',asset:'USDC',amount:'0.001',
      payTo:'$(grep MERCHANT_ADDRESS .env | cut -d= -f2)',
      maxTimeoutSeconds:300,extra:{quote_id:'test',request_hash:'rh_test'}},
    payload:{signature:'0x$(printf 'ab%.0s' {1..130})1b',
      authorization:{from:'0x1234567890123456789012345678901234567890',
        to:'$(grep MERCHANT_ADDRESS .env | cut -d= -f2)',
        value:'1000000',validAfter:'0',validBefore:'9999999999',
        nonce:'0x0000000000000000000000000000000000000000000000000000000000000001'}}
  };
  console.log(Buffer.from(JSON.stringify(p)).toString('base64url'));
")

curl -s -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "payment-signature: $SIG" \
  -d '{"model":"openai/gpt-4o","messages":[{"role":"user","content":"Hello"}]}' | python3 -m json.tool

# Expected: 200 with usage_receipt, settlement, PAYMENT-RESPONSE header
```

### Running Full Test Suite

```bash
pnpm test          # 258 tests, 16 files
pnpm typecheck     # TypeScript check
pnpm lint          # ESLint
```

### Error Response Codes

| Status | Code | Scenario |
|---|---|---|
| 402 | `payment_required` | No payment signature provided |
| 402 | `payment_verification_failed` | Invalid signature, wrong merchant, expired/not-yet-valid authorization |
| 402 | `insufficient_payment` | Authorized amount < required amount |
| 400 | `request_hash_mismatch` | Request body hash doesn't match payment payload |
| 409 | `payment_replayed` | Duplicate payment signature (double spend) |
| 500 | `internal_error` | Routing failure or unhandled exception |

## Development

```bash
pnpm dev          # Start dev server with hot reload
pnpm build        # Compile TypeScript
pnpm test         # Run tests (258 tests)
pnpm test:watch   # Run tests in watch mode
pnpm lint         # Lint source code
pnpm typecheck    # Type check without emit
pnpm format       # Format code with Prettier
pnpm db:up        # Start PostgreSQL + Redis containers
pnpm db:down      # Stop containers
```

## Project Structure

```
src/
  app.ts              # Fastify application factory + service wiring
  server.ts           # Entry point (listen + graceful shutdown)
  config.ts           # Environment config with zod validation
  errors.ts           # Typed error classes (9 API error codes)
  types.ts            # Shared domain types
  gateway/            # HTTP layer: routes, schemas, orchestrator, middleware
  x402/
    transport/        # v2 header encode/decode + CAIP-2 mapping
    schemes/          # Payment scheme system (Strategy Pattern)
      exact/          # EIP-3009 verify + settle
      types.ts        # PaymentScheme interface
      registry.ts     # SchemeRegistry dispatch
    verify/           # Legacy verification (deprecated compat wrapper)
    chain-config.ts   # EVM chain definitions + token config
    chain-registry.service.ts
    token-registry.service.ts
    replay.service.ts # Idempotency + replay protection
    hash.ts           # Deterministic request body hashing
  router/             # Model routing: manual selection + fallback service
  provider/           # Upstream provider adapters + model catalog
  billing/            # Payment estimation, token metering, cost, ledger
  audit/              # Request tracing + receipt query
test/
  helpers.ts          # Test utilities (mock services, payment signature builder)
  integration/        # End-to-end v2 flow tests
  x402/
    transport/        # encode/decode/CAIP-2 tests
    schemes/exact/    # EIP-3009 verify + settle tests
    verify.test.ts    # Legacy verify tests
  router/             # Router + fallback tests
  billing/            # Payment/cost/ledger tests
  audit/              # Receipt tests
  simulation/         # Full-stack simulation environment
docs/
  plan.md
  api-spec-v0-x402-gateway.md
  ENGINEERING_PLAYBOOK.md
  LEAD_REVIEW_PM_GUIDE.md
  adr-001-x402-only-architecture.md
```

## Tech Stack

- **Runtime**: TypeScript + Fastify
- **Database**: PostgreSQL (ledger, audit) + Redis (replay protection, caching)
- **Chain**: viem (EIP-712 signature recovery, WalletClient for settlement)
- **Validation**: zod
- **Payment Standard**: x402 v2 (EIP-3009 exact scheme)

## Milestones

| Tag | Description |
|---|---|
| `milestone-x402-v2` | x402 v2 官方协议标准重构完成。回滚点。 |

To rollback:

```bash
git checkout milestone-x402-v2
```

## Documentation

See `docs/` for detailed specifications:
- [MVP Plan](docs/plan.md)
- [API Spec](docs/api-spec-v0-x402-gateway.md)
- [Engineering Playbook](docs/ENGINEERING_PLAYBOOK.md)
- [Review Guide](docs/LEAD_REVIEW_PM_GUIDE.md)
- [ADR-001: x402-only Architecture](docs/adr-001-x402-only-architecture.md)
