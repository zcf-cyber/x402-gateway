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

// Shared utilities
export { computeRequestHash } from "./hash.js";

// Scheme System — extensible payment scheme architecture
export type {
  PaymentScheme,
  SchemeVerifyContext,
  SchemeSettleContext,
} from "./schemes/types.js";
export {
  createSchemeRegistry,
  type ISchemeRegistry,
} from "./schemes/registry.js";

// Exact Scheme (EIP-3009)
export { createExactScheme } from "./schemes/exact/index.js";
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

// Legacy Payment Verification (compatibility wrapper)
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

// Other services
export { createReplayProtectionService } from "./replay.service.js";
export type { IReplayProtectionService } from "./replay.service.js";
