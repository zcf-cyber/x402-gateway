# x402 Gateway -- A2A Compute Relay

Agent-to-Agent compute relay that routes LLM requests to upstream providers with per-request x402 cryptocurrency payment. No API keys, no accounts -- pay per request with on-chain USDC.

## Quick Start

Prerequisites: Node.js 20+, pnpm, Docker

```bash
# Install dependencies
pnpm install

# Start local PostgreSQL + Redis
pnpm db:up

# Copy env and configure
cp .env.example .env
# Edit .env: set CHALLENGE_SECRET, MERCHANT_ADDRESS, upstream API keys

# Start dev server
pnpm dev
```

Server starts at `http://localhost:3000`.

## Architecture

```
AgentClient --> EdgeGateway --> X402Gateway --> PaymentVerifier --> ChainRPC
                                    |
                              RouterService --> ProviderAdapters --> LLM Providers
                                    |
                              BillingLedger --> PostgreSQL
                              Cache/Dedup  --> Redis
```

### Modules

| Module | Path | Responsibility |
|--------|------|---------------|
| Gateway | `src/gateway/` | Request validation, rate limiting, trace-id injection, route handlers |
| x402 | `src/x402/` | Challenge generation, payment proof verification, replay protection |
| Router | `src/router/` | Manual/auto model selection, fallback chains, route proof |
| Provider | `src/provider/` | Upstream model adapters, model catalog registry |
| Billing | `src/billing/` | Token metering, cost breakdown, append-only ledger |
| Audit | `src/audit/` | Request trace persistence, receipt query |

## API Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `POST` | `/v1/chat/completions` | OpenAI-compatible chat completion with x402 payment | x402 challenge-response |
| `GET` | `/v1/models` | Model catalog and pricing metadata | None |
| `GET` | `/v1/audit/requests/:request_id` | Audit query for route and settlement evidence | None |

## x402 Payment Flow

1. Client sends `POST /v1/chat/completions` without payment headers
2. Server returns `402 Payment Required` with `payment_requirements` (quote_id, amount, chain, asset, challenge_token)
3. Client pays on-chain (e.g. USDC on Base)
4. Client retries the same request with headers: `X-402-Challenge`, `X-402-Payment`, `Idempotency-Key`
5. Server verifies challenge validity, request hash binding, and on-chain payment proof
6. Server routes request to upstream model, returns response with `usage_receipt`

## Development

```bash
pnpm dev          # Start dev server with hot reload
pnpm build        # Compile TypeScript
pnpm test         # Run tests
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
  app.ts              # Fastify application factory
  server.ts           # Entry point (listen + graceful shutdown)
  config.ts           # Environment config with zod validation
  errors.ts           # Typed error classes (9 API error codes)
  types.ts            # Shared domain types
  gateway/            # Edge gateway (routes, middleware, schemas)
  x402/               # Payment challenge & verification
  router/             # Model routing (manual/auto, fallback)
  provider/           # Upstream provider adapters
  billing/            # Usage metering & append-only ledger
  audit/              # Request tracing & receipt query
test/
  setup.ts            # Test setup
  helpers.ts          # Test utilities
  x402/               # x402 module tests
  router/             # Router module tests
  integration/        # End-to-end flow tests
docs/
  plan.md             # MVP plan
  api-spec-v0-x402-gateway.md  # API specification
  ENGINEERING_PLAYBOOK.md      # Developer execution guide
  LEAD_REVIEW_PM_GUIDE.md      # Review & merge gates
  adr-001-x402-only-architecture.md  # Architecture decision record
```

## Tech Stack

- **Runtime**: TypeScript + Fastify
- **Database**: PostgreSQL (ledger, audit) + Redis (replay protection, caching)
- **Chain Verification**: viem (EVM RPC)
- **Validation**: zod
- **Auth Tokens**: jose (JWT/JWS)

## Documentation

See `docs/` for detailed specifications:
- [MVP Plan](docs/plan.md)
- [API Spec](docs/api-spec-v0-x402-gateway.md)
- [Engineering Playbook](docs/ENGINEERING_PLAYBOOK.md)
- [Review Guide](docs/LEAD_REVIEW_PM_GUIDE.md)
- [ADR-001: x402-only Architecture](docs/adr-001-x402-only-architecture.md)
