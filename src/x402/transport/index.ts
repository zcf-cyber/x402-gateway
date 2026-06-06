// ---------------------------------------------------------------------------
// x402 v2 Transport Layer — Public API
// ---------------------------------------------------------------------------

export type {
  Caip2Id,
  PaymentRequirementsV2,
  PaymentRequiredV2,
  PaymentPayloadV2,
  SettlementResponseV2,
} from "./types.js";

export {
  encodePaymentRequired,
  encodeSettlementResponse,
} from "./encode.js";

export { decodePaymentPayload } from "./decode.js";

export { chainToCaip2, caip2ToChain, isKnownCaip2 } from "./caip2.js";
