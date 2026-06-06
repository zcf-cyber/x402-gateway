// ---------------------------------------------------------------------------
// x402 v2 Transport Layer — Header Encoding
//
// Encodes x402 v2 data structures to base64url for HTTP header transport.
// ---------------------------------------------------------------------------

import type {
  PaymentRequirementsV2,
  SettlementResponseV2,
} from "./types.js";

/**
 * Encode payment requirements to base64url for the PAYMENT-REQUIRED header.
 *
 * Serializes the requirements array to JSON, then encodes as base64url.
 * The x402 v2 wire format uses JSON → base64url for transport.
 *
 * @param requirements - Array of payment requirements to offer clients
 * @returns base64url-encoded payment required payload
 */
export function encodePaymentRequired(
  requirements: PaymentRequirementsV2[],
): string {
  const payload = JSON.stringify({
    x402Version: 2,
    accepts: requirements,
  });
  return Buffer.from(payload).toString("base64url");
}

/**
 * Encode settlement response to base64url for the PAYMENT-RESPONSE header.
 *
 * Serializes the settlement result to JSON, then encodes as base64url.
 *
 * @param response - Settlement outcome from the scheme's settle method
 * @returns base64url-encoded settlement response
 */
export function encodeSettlementResponse(
  response: SettlementResponseV2,
): string {
  const payload = JSON.stringify(response);
  return Buffer.from(payload).toString("base64url");
}
