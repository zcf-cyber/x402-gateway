# AGENTS.md

## Commands

- **Lint**: `pnpm lint`
- **Typecheck**: `pnpm typecheck`
- **Test**: `pnpm test`
- **Dev**: `pnpm dev`
- **Build**: `pnpm build`

## Architecture

- 6 modules: `gateway`, `x402`, `router`, `provider`, `billing`, `audit`
- Handlers are thin -- all business logic lives in services
- Append-only ledger -- never UPDATE or DELETE ledger entries
- x402-only payment -- no API keys, no Stripe, no user accounts

## Key Constraints

- Every successful response must include `usage_receipt`
- No hidden model substitution: declared model = actual model
- Payment verification must complete before upstream execution
- All error codes defined in `docs/api-spec-v0-x402-gateway.md` section 6
- PR size target: under 500 lines changed, split by module

## Service Pattern

Each service follows:
1. Export an **interface** describing the contract
2. Export a **factory function** `createXxxService(deps)` returning the implementation
3. Dependencies injected via factory argument (no globals)

## Branch Strategy

- `ai-dev` -- AI automated development (OpenHands)
- `dev` -- integration branch
- `main` -- production-ready, merge via reviewed PR only
