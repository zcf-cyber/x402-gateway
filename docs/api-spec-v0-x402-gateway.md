# API Spec v0: x402 Gateway + OpenAI-Compatible Inference

- Version: v0
- Status: Draft for MVP implementation
- Base URL: `https://<your-domain>`

## 1. Principles

- OpenAI-compatible request body for chat completion
- x402 challenge-response payment for authorization
- no API key required in MVP
- deterministic request/payment binding
- transparent usage receipt in successful responses

## 2. Endpoint Summary

- `POST /v1/chat/completions`
- `GET /v1/models`
- `GET /v1/audit/requests/{request_id}`

## 3. POST /v1/chat/completions

### 3.1 Request (OpenAI-compatible)

Headers:

- `Content-Type: application/json`
- `X-402-Challenge: <token>` (required on retry after 402)
- `X-402-Payment: <proof>` (required on retry after 402)
- `Idempotency-Key: <uuid>` (required on retry after 402)

Body example:

```json
{
  "model": "auto",
  "messages": [
    {"role": "user", "content": "Explain TCP/IP briefly"}
  ],
  "temperature": 0.2,
  "stream": false,
  "routing_mode": "auto"
}
```

### 3.2 402 Response (payment challenge)

Status: `402 Payment Required`

```json
{
  "error": {
    "code": "payment_required",
    "message": "Payment proof required"
  },
  "payment_requirements": {
    "quote_id": "q_01J...",
    "chain": "base",
    "asset": "USDC",
    "amount": "0.0021",
    "expires_at": "2026-04-06T12:00:00Z",
    "merchant_address": "0xabc...",
    "request_hash": "rh_...",
    "challenge_token": "eyJ..."
  }
}
```

### 3.3 Success Response

Status: `200 OK`

```json
{
  "id": "chatcmpl_...",
  "object": "chat.completion",
  "created": 1770000000,
  "model": "provider/model-id",
  "choices": [
    {
      "index": 0,
      "message": {"role": "assistant", "content": "TCP/IP is..."},
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 30,
    "completion_tokens": 80,
    "total_tokens": 110
  },
  "usage_receipt": {
    "request_id": "req_...",
    "quote_id": "q_01J...",
    "payer_address": "0x123...",
    "routing_mode": "auto",
    "model_used": "provider/model-id",
    "unit_price_input_usd": "0.000001",
    "unit_price_output_usd": "0.000002",
    "total_cost_usd": "0.00019",
    "route_proof_hash": "rph_..."
  }
}
```

## 4. GET /v1/models

Returns available model catalog and pricing metadata.

Example:

```json
{
  "data": [
    {
      "id": "provider/model-id",
      "provider": "provider-name",
      "context_window": 128000,
      "capabilities": ["chat", "json_mode"],
      "pricing": {
        "input_usd_per_token": "0.000001",
        "output_usd_per_token": "0.000002",
        "effective_at": "2026-04-06T00:00:00Z"
      }
    }
  ]
}
```

## 5. GET /v1/audit/requests/{request_id}

Returns route and settlement evidence for a completed request.

Example:

```json
{
  "request_id": "req_...",
  "request_hash": "rh_...",
  "routing_mode": "auto",
  "route_decision": {
    "selected_model": "provider/model-id",
    "fallback_chain": ["provider/model-b", "provider/model-c"],
    "score_summary": "cost_weighted_v1"
  },
  "usage": {
    "prompt_tokens": 30,
    "completion_tokens": 80,
    "total_tokens": 110
  },
  "cost": {
    "subtotal_usd": "0.00019",
    "platform_fee_usd": "0.00001",
    "total_usd": "0.00020"
  },
  "payment": {
    "quote_id": "q_01J...",
    "chain": "base",
    "asset": "USDC",
    "payer_address": "0x123...",
    "verification_status": "verified"
  }
}
```

## 6. Error Codes

- `payment_required` (402)
- `challenge_expired` (402)
- `request_hash_mismatch` (400)
- `payment_verification_failed` (402)
- `payment_replayed` (409)
- `insufficient_payment` (402)
- `upstream_timeout` (504)
- `upstream_unavailable` (503)
- `internal_error` (500)

## 7. Security and Idempotency Rules

- `challenge_token` must be signed and short-lived.
- `request_hash` must bind challenge to request payload.
- `Idempotency-Key` required on payment retry path.
- same payment proof cannot be consumed twice.
- reject any payment where amount/asset/merchant mismatch challenge.

## 8. Streaming Note (SSE)

For `stream=true`:

- payment verification must complete before first token is streamed
- if stream fails mid-way, settlement policy follows ADR-002 (to be defined)

## 9. Compatibility

- Request body remains OpenAI-compatible.
- x402 is implemented through additional headers and 402 challenge response.
- traditional API key auth is intentionally out of MVP scope.

