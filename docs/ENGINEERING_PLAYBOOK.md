# ENGINEERING PLAYBOOK (Junior Dev, Dev Branch)

## 1. Purpose

This document is the execution guide for junior engineers working on the dev branch.
The source of truth for product scope is `plan.md`.

## 2. MVP Scope (Must / Must Not)

Must implement:

- OpenAI-compatible chat completion endpoint
- x402 challenge-response payment flow
- manual/auto routing switch
- transparent usage receipt per request
- audit query by `request_id`

Must not implement in MVP:

- user login / OAuth
- API key account system
- Stripe or custodial wallet
- subscription plans

## 3. Suggested Project Modules

- `src/gateway/`
  - request validation
  - rate limiting
  - trace id injection
- `src/x402/`
  - challenge generation
  - payment proof verification
  - replay protection
- `src/router/`
  - manual/auto selection
  - fallback chain execution
  - route proof hash generation
- `src/provider/`
  - upstream model adapters
  - unified error mapping
- `src/billing/`
  - token usage metering
  - cost breakdown
  - immutable ledger write
- `src/audit/`
  - request trace persistence
  - receipt query endpoint

## 4. Core Implementation Tasks (Priority Order)

P0:

- Build `POST /v1/chat/completions` skeleton
- Implement `402 Payment Required` response contract
- Implement `challenge_token` signing and verification
- Implement payment proof validation interface
- Implement idempotency + replay protection with Redis

P1:

- Implement manual routing path
- Implement provider adapter for first upstream provider
- Persist request trace and usage receipt
- Return `usage_receipt` in response payload

P2:

- Implement auto routing switch and fallback chain
- Add route decision summary and `route_proof_hash`
- Add `GET /v1/audit/requests/{request_id}`

## 5. Data Contract Checklist

Required persisted records:

- `request_trace`
- `route_decision`
- `usage_record`
- `cost_breakdown`
- `payment_attempt`
- `payment_verification`
- `ledger_entry`

Never mutate ledger rows after commit.
Use append-only entries for compensation.

## 6. Coding Rules

- Keep handlers thin; move logic to services.
- Any payment verification failure must map to explicit error codes.
- Any retry path must preserve `request_id` and idempotency behavior.
- Do not add hidden model substitutions; actual model must be logged and returned.

## 7. Test Requirements (Before PR)

Unit tests:

- challenge token expiry and signature validation
- replay attack rejection
- request hash mismatch rejection
- idempotent retry behavior
- cost calculation determinism

Integration tests:

- 402 challenge -> pay -> retry -> success
- insufficient payment -> rejection
- upstream failure -> fallback model path
- audit endpoint returns full receipt

Load baseline:

- 20 RPS for 10 minutes
- P95 under target
- error rate < 1%

## 8. PR Rules (Dev Branch)

Each PR must include:

- scope statement (what and why)
- API contract changes (if any)
- test evidence
- risk notes and rollback note

PR size target:

- under 500 lines changed where possible
- split by module for faster review

## 9. Done Definition

A feature is done only when:

- code + tests pass
- docs updated (if API changes)
- observability fields are present
- audit query can prove model used, token usage, and total cost