# ADR-001: x402-only MVP Architecture Decision

- Status: Accepted
- Date: 2026-04-06
- Owners: Product + Engineering

## Context

The original platform vision included:

- account system (OAuth/email)
- API keys
- custodial wallet balance
- Stripe payments
- transparent routing and billing

For early-stage MVP, this creates high complexity in:

- compliance and payment operations
- security and dispute handling
- infra and development cost
- time to first market validation

## Decision

Adopt an x402-only MVP architecture:

- no account identity system in MVP
- no Stripe/custodial balance in MVP
- payment is per request via x402
- routing supports manual and auto modes
- every request returns transparent usage receipt

## Decision Drivers

- Minimize time to launch
- Reduce compliance and operational burden
- Validate core value: paid routing + transparency
- Keep architecture extensible for future account channel

## Considered Options

1. Full OpenRouter-style MVP (accounts + Stripe + balance + routing)

- Pros: feature complete for broad users
- Cons: slowest launch, highest risk/cost

1. Hybrid from day one (accounts + x402)

- Pros: broad compatibility
- Cons: still high complexity, dual-path maintenance burden

1. x402-only MVP (selected)

- Pros: shortest path, lower scope risk, clear differentiation
- Cons: narrower initial user segment (agent/native wallet users)

## Consequences

Positive:

- faster delivery cycle
- smaller code and operational surface
- simpler settlement model

Negative:

- no traditional API-key-only users in MVP
- onboarding requires x402-capable clients
- some compliance concerns still remain (regional/legal)

## Architecture Notes

Core services in MVP:

- Edge Gateway
- X402 Gateway (challenge + verification)
- Router Service (manual/auto + fallback)
- Provider Adapters
- Billing Ledger (append-only)
- Audit API

State policy:

- no user account state
- minimal anti-replay state (Redis TTL)
- immutable billing records in PostgreSQL

## Guardrails

- Upstream model execution is blocked unless payment verification passes.
- Actual model used must be exposed in response and audit logs.
- Ledger entries are append-only; no destructive updates.

## Follow-up ADRs

- ADR-002: settlement policy for stream interruption and retries
- ADR-003: payment channel abstraction for future Stripe integration
- ADR-004: MCP market extension boundaries

