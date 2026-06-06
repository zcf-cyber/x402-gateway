// ---------------------------------------------------------------------------
// x402 Scheme Registry — Central Payment Scheme Dispatch
//
// Maintains a registry of PaymentScheme implementations keyed by scheme name.
// Routes (or orchestrator) look up the scheme from the payment payload's
// `accepted.scheme` field and delegate verify/settle to the matching instance.
// ---------------------------------------------------------------------------

import { PaymentVerificationFailedError } from "../../errors.js";
import type { PaymentPayloadV2 } from "../transport/types.js";
import type {
  PaymentScheme,
  SchemeVerifyContext,
  SchemeSettleContext,
} from "./types.js";
import type { Address } from "viem";
import type { SettlementResponseV2 } from "../transport/types.js";

export interface ISchemeRegistry {
  /** Register a payment scheme. Throws if a scheme with the same name already exists. */
  register(scheme: PaymentScheme): void;

  /** Look up a scheme by name. */
  get(name: string): PaymentScheme | undefined;

  /**
   * Verify a payment payload by dispatching to the correct scheme.
   * Reads `payload.accepted.scheme` to determine which scheme to use.
   */
  verify(
    payload: PaymentPayloadV2,
    ctx: SchemeVerifyContext,
  ): Promise<{ payer: Address }>;

  /**
   * Settle a verified payment by dispatching to the correct scheme.
   */
  settle(
    payload: PaymentPayloadV2,
    ctx: SchemeSettleContext,
  ): Promise<SettlementResponseV2>;
}

export function createSchemeRegistry(): ISchemeRegistry {
  const schemes = new Map<string, PaymentScheme>();

  return {
    register(scheme: PaymentScheme): void {
      if (schemes.has(scheme.name)) {
        throw new Error(`Payment scheme "${scheme.name}" is already registered`);
      }
      schemes.set(scheme.name, scheme);
    },

    get(name: string): PaymentScheme | undefined {
      return schemes.get(name);
    },

    async verify(
      payload: PaymentPayloadV2,
      ctx: SchemeVerifyContext,
    ): Promise<{ payer: Address }> {
      const schemeName = payload.accepted.scheme;
      const scheme = schemes.get(schemeName);
      if (!scheme) {
        throw new PaymentVerificationFailedError(
          `Unsupported payment scheme: "${schemeName}". ` +
          `Supported: ${Array.from(schemes.keys()).join(", ")}`,
        );
      }
      return scheme.verify(payload, ctx);
    },

    async settle(
      payload: PaymentPayloadV2,
      ctx: SchemeSettleContext,
    ): Promise<SettlementResponseV2> {
      const schemeName = payload.accepted.scheme;
      const scheme = schemes.get(schemeName);
      if (!scheme) {
        return {
          success: false,
          errorReason: "unsupported_scheme",
          errorMessage: `Unsupported payment scheme: "${schemeName}"`,
          transaction: "",
          network: payload.accepted.network,
        };
      }
      return scheme.settle(payload, ctx);
    },
  };
}
