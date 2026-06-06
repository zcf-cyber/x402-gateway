// ---------------------------------------------------------------------------
// x402 Module — Public API
// ---------------------------------------------------------------------------

// v2 Transport Layer
export type {
  Caip2Id,
  PaymentRequirementsV2,
  PaymentRequiredV2,
  PaymentPayloadV2,
  SettlementResponseV2,
} from "./transport/types.js";
export {
  encodePaymentRequired,
  encodeSettlementResponse,
} from "./transport/encode.js";
export { decodePaymentPayload } from "./transport/decode.js";
export { chainToCaip2, caip2ToChain, isKnownCaip2 } from "./transport/caip2.js";

// Exact Scheme (EIP-3009)
export {
  createExactVerifyService,
  type IExactVerifyService,
  type TokenMeta,
  type ExactPaymentPayloadData,
} from "./schemes/exact/verify.service.js";
export {
  createExactSettleService,
  type IExactSettleService,
} from "./schemes/exact/settle.service.js";

// Payment Verification (unified entry point)
export {
  createPaymentVerifyService,
  type IPaymentVerifyService,
} from "./verify/index.js";

// Legacy Types (deprecated — transitional compat)
export type {
  ChallengePayload,
  PaymentProof,
  VerificationResult,
} from "./types.js";

// Other services (unchanged)
export { createReplayProtectionService } from "./replay.service.js";
export type { IReplayProtectionService } from "./replay.service.js";
