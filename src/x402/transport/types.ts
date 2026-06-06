// ---------------------------------------------------------------------------
// x402 v2 Transport Layer Types
//
// x402 v2 standard (as defined by @x402/core v2.14.0) uses:
//   - PAYMENT-REQUIRED header: base64-encoded PaymentRequired
//   - PAYMENT-SIGNATURE header: base64-encoded PaymentPayload
//   - PAYMENT-RESPONSE header: base64-encoded SettleResponse
//
// The encoding format is JSON → base64url for wire transport.
// CAIP-2 network identifiers are used for chain identification.
// ---------------------------------------------------------------------------

/**
 * CAIP-2 network identifier (e.g., "eip155:8453" for Base mainnet).
 * Format: `<namespace>:<reference>`
 */
export type Caip2Id = `${string}:${string}`;

/** Payment requirement for a single scheme/network/token combination. */
export interface PaymentRequirementsV2 {
  scheme: string;               // e.g., "exact"
  network: Caip2Id;             // CAIP-2 chain identifier
  asset: string;                // e.g., "USDC"
  amount: string;               // human-readable amount (e.g., "0.001")
  payTo: string;                // merchant/facilitator address
  maxTimeoutSeconds: number;    // expiration in seconds
  extra: Record<string, unknown>; // scheme-specific extensions
}

/** PAYMENT-REQUIRED header payload. */
export interface PaymentRequiredV2 {
  x402Version: number;
  error?: string;
  resource?: {
    url?: string;
    description?: string;
    mimeType?: string;
    serviceName?: string;
  };
  accepts: PaymentRequirementsV2[];
  extensions?: Record<string, unknown>;
}

/** PAYMENT-SIGNATURE header payload (client → gateway). */
export interface PaymentPayloadV2 {
  x402Version: number;
  resource?: {
    url?: string;
    description?: string;
  };
  accepted: PaymentRequirementsV2;   // the requirement being accepted
  payload: Record<string, unknown>;   // scheme-specific data (e.g., signature)
  extensions?: Record<string, unknown>;
}

/** PAYMENT-RESPONSE header payload (gateway → client after settlement). */
export interface SettlementResponseV2 {
  success: boolean;
  errorReason?: string;
  errorMessage?: string;
  payer?: string;
  transaction: string;           // on-chain tx hash
  network: Caip2Id;
  amount?: string;               // actual amount settled (atomic units)
  extensions?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}
