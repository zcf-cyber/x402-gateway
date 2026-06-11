// ---------------------------------------------------------------------------
// x402 v2 Transport Layer — Header Encoding
//
// Encodes x402 v2 data structures to base64url for HTTP header transport.
// Conforms to @x402/core v2.14.0 PaymentRequiredV2Schema.
// ---------------------------------------------------------------------------

import type {
  PaymentRequirementsV2,
  ResourceInfo,
  SettlementResponseV2,
} from "./types.js";

/**
 * Encode payment requirements to base64url for the PAYMENT-REQUIRED header.
 *
 * Serializes the requirements array to JSON, then encodes as base64url.
 * The x402 v2 wire format uses JSON → base64url for transport.
 *
 * The `resource` field is REQUIRED per @x402/core v2.14.0 PaymentRequiredV2Schema.
 * If not provided, a default resource with the endpoint URL is used.
 *
 * @param requirements - Array of payment requirements to offer clients
 * @param resource - Resource info (required per x402 v2 spec). Defaults to /v1/chat/completions.
 * @returns base64url-encoded payment required payload
 */
export function encodePaymentRequired(
  requirements: PaymentRequirementsV2[],
  resource: ResourceInfo = { url: "/v1/chat/completions" },
): string {
  const payload = JSON.stringify({
    x402Version: 2,
    resource,
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
