// ---------------------------------------------------------------------------
// x402 v2 Transport Layer — Header Decoding
//
// Decodes x402 v2 base64url-encoded headers back to typed structures.
// ---------------------------------------------------------------------------

import type { PaymentPayloadV2 } from "./types.js";

/**
 * Decode the PAYMENT-SIGNATURE header from base64url to a PaymentPayloadV2.
 *
 * The header contains a base64url-encoded JSON object following the
 * x402 v2 PaymentPayload schema (as defined by @x402/core v2.x).
 *
 * @param header - Raw PAYMENT-SIGNATURE header value
 * @returns Parsed payment payload
 * @throws If the header is not valid base64url or invalid JSON
 */
export function decodePaymentPayload(header: string): PaymentPayloadV2 {
  if (!header || header.trim().length === 0) {
    throw new Error("Empty PAYMENT-SIGNATURE header");
  }

  let jsonString: string;
  try {
    jsonString = Buffer.from(header.trim(), "base64url").toString("utf-8");
  } catch {
    throw new Error(
      "Invalid PAYMENT-SIGNATURE header: not valid base64url",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new Error(
      "Invalid PAYMENT-SIGNATURE header: not valid JSON",
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(
      "Invalid PAYMENT-SIGNATURE header: expected a JSON object",
    );
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj["accepted"] !== "object" || obj["accepted"] === null) {
    throw new Error(
      "Invalid PAYMENT-SIGNATURE header: missing 'accepted' field",
    );
  }

  return obj as unknown as PaymentPayloadV2;
}
