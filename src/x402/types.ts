// ---------------------------------------------------------------------------
// x402 v2 Types — Public API
//
// Primary types follow the x402 v2 standard (as defined by @x402/core v2.14.0).
// Deprecated v0 types are retained as transitional aliases and will be removed
// once all consumers migrate to the v2 transport layer.
// ---------------------------------------------------------------------------

// ===========================================================================
// x402 v2 Standard Types (primary)
// ===========================================================================

export type {
  Caip2Id,
  PaymentRequirementsV2,
  PaymentRequiredV2,
  PaymentPayloadV2,
  SettlementResponseV2,
} from "./transport/types.js";

// ===========================================================================
// Deprecated v0 Types (transitional — will be removed)
// ===========================================================================

/**
 * @deprecated Use PaymentRequirementsV2 from transport layer instead.
 *   Old challenge payload embedded in HMAC-signed challenge tokens.
 *   Replaced by PaymentPayloadV2.authorization in the x402 v2 exact scheme.
 */
export interface ChallengePayload {
  quote_id: string;
  request_hash: string;
  amount: string;
  asset: string;
  chain: string;
  merchant_address: string;
  expires_at: string;
}

/**
 * @deprecated Use PaymentPayloadV2 from transport layer instead.
 *   Old on-chain tx_hash based payment proof.
 *   Replaced by EIP-3009 signature in PaymentPayloadV2.payload.
 */
export interface PaymentProof {
  tx_hash: string;
  chain: string;
  payer_address: string;
}

/**
 * @deprecated New verification returns `{ payer: Address }` from exact scheme.
 *   Kept for backward compat with solana-verify and legacy tests.
 */
export interface VerificationResult {
  verified: boolean;
  payer_address: string;
  amount: string;
}
