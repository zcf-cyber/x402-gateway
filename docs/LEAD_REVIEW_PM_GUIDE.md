# LEAD REVIEW & PM GUIDE (Senior Engineer + Project Manager)

## 1. Purpose

This document defines review gates, merge criteria, and delivery governance.
Product scope baseline is `plan.md`.

## 2. Non-Negotiable Architecture Constraints

- MVP must remain x402-only.
- No hidden model substitution is allowed.
- Every successful response must include verifiable usage receipt.
- Payment verification and replay protection are mandatory before upstream execution.
- Ledger must be append-only.

## 3. Senior Engineer Review Checklist

Security:

- replay protection implemented and tested
- challenge token signature and expiration enforced
- request hash binding enforced
- idempotency key logic safe under concurrency

Correctness:

- payment amount and settlement checks are deterministic
- token metering and cost calculation are reproducible
- fallback chain does not double-charge
- partial stream failures handled with defined settlement policy

Reliability:

- upstream timeout/retry strategy bounded
- error mapping stable and documented
- Redis/PostgreSQL failures degrade safely

Observability:

- request_id end-to-end trace continuity
- structured logs include payer, model_used, cost, route_mode
- dashboards and alerts cover payment failures and cost spikes

## 4. Merge Gates (Go / No-Go)

Must pass before merge to main:

- unit + integration tests green
- security checklist completed
- migration safety reviewed
- rollback procedure documented
- API contract changes reflected in spec

No-Go examples:

- any path can execute upstream without payment verification
- audit endpoint cannot reconstruct route + billing proof
- missing replay protection in any payment path

## 5. PM Delivery Control

Weekly milestone control:

- Week 1: gateway and x402 handshake
- Week 2: routing and first provider
- Week 3: auto mode and transparent receipt
- Week 4: audit endpoint + hardening

Tracking dimensions:

- delivery risk
- dependency blockers
- production readiness score
- burn and infra cost trend

## 6. Risk Register (Top Priority)

- chain RPC instability
- pricing drift from upstream providers
- settlement disputes from stream interruption
- abuse traffic targeting payment verification path
- legal/compliance ambiguity by region

Each risk needs:

- owner
- detection signal
- mitigation plan
- fallback plan

## 7. Release Readiness Criteria

Functional:

- x402 flow works for success and failure paths
- manual and auto routing are both available
- usage receipt and audit query consistent

Operational:

- SLO dashboard available
- error budget policy defined
- on-call and incident process ready

Business:

- transparent pricing statement published
- support FAQ includes payment and dispute handling

## 8. Post-Launch Priorities

- optimize verification latency
- tune routing policy by real traffic
- decide timing for account/Stripe expansion
- draft MCP market ADR and monetization model