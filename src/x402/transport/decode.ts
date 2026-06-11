// ---------------------------------------------------------------------------
// x402 v2 Transport Layer — Header Decoding
//
// Decodes x402 v2 base64url-encoded headers back to typed structures.
// Validates against @x402/core v2.14.0 official Zod schemas.
// ---------------------------------------------------------------------------

import { validatePaymentPayload } from "@x402/core/schemas";
import type { PaymentPayloadV2 } from "./types.js";

/**
 * Decode the PAYMENT-SIGNATURE header from base64url to a PaymentPayloadV2.
 *
 * Validates against @x402/core v2.14.0 PaymentPayloadV2Schema to ensure
 * the decoded payload conforms to the official x402 v2 specification.
 *
 * @param header - Raw PAYMENT-SIGNATURE header value
 * @returns Parsed payment payload (validated against official schema)
 * @throws If the header is not valid base64url, invalid JSON, or fails schema validation
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

  // Validate against official @x402/core v2.14.0 PaymentPayloadV2Schema
  try {
    return validatePaymentPayload(parsed) as unknown as PaymentPayloadV2;
  } catch (err) {
    throw new Error(
      `Invalid PAYMENT-SIGNATURE header: ${(err as Error).message}`,
    );
  }
}
