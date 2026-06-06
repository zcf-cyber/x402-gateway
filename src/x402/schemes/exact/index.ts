// ---------------------------------------------------------------------------
// Exact Scheme — PaymentScheme Implementation
//
// Wraps the existing EIP-3009 verify and settle services behind the
// PaymentScheme interface so that the SchemeRegistry can dispatch to it
// by scheme name "exact".
//
// The underlying verify.service.ts and settle.service.ts remain unchanged
// and can still be used directly if needed (e.g., in tests or CLI tools).
// ---------------------------------------------------------------------------

import type { PaymentScheme, SchemeVerifyContext, SchemeSettleContext } from "../types.js";
import type { PaymentPayloadV2, SettlementResponseV2 } from "../../transport/types.js";
import type { Address } from "viem";
import { createExactVerifyService, type TokenMeta } from "./verify.service.js";
import { caip2ToChain } from "../../transport/caip2.js";
import { PaymentVerificationFailedError } from "../../../errors.js";

export function createExactScheme(): PaymentScheme {
  const verifyService = createExactVerifyService();

  return {
    name: "exact",

    async verify(
      payload: PaymentPayloadV2,
      ctx: SchemeVerifyContext,
    ): Promise<{ payer: Address }> {
      const caip2Net = payload.accepted.network;
      const chainName = caip2ToChain(caip2Net);

      const chainConfig = ctx.chainRegistry.get(chainName);
      if (!chainConfig) {
        throw new PaymentVerificationFailedError(
          `Chain not configured: ${chainName}`,
        );
      }

      const asset = payload.accepted.asset;
      const tokenConfig = ctx.tokenRegistry.get(chainName, asset);
      if (!tokenConfig) {
        throw new PaymentVerificationFailedError(
          `Unsupported asset: ${asset} on chain ${chainName}`,
        );
      }

      const tokenMeta: TokenMeta = {
        name: tokenConfig.eip712Name,       // "USD Coin" — correct EIP-712 domain name
        version: tokenConfig.eip712Version, // "2"
        address: tokenConfig.address,
        decimals: tokenConfig.decimals,
      };

      return verifyService.verifyExactPayment(
        payload,
        tokenMeta,
        chainConfig.chain.id,
        ctx.merchantAddress,
      );
    },

    async settle(
      payload: PaymentPayloadV2,
      _ctx: SchemeSettleContext,
    ): Promise<SettlementResponseV2> {
      // Settlement is handled by the orchestrator using the exact settle service.
      // The scheme here could also delegate, but for exact scheme the settle
      // logic depends on the facilitator's wallet which is wired at the app level.
      // We return a not-implemented sentinel; the orchestrator handles settlement
      // via the separately-injected settleService.
      return {
        success: false,
        errorReason: "not_implemented",
        errorMessage:
          "Exact scheme settlement is handled by the orchestrator via IExactSettleService",
        transaction: "",
        network: payload.accepted.network,
      };
    },
  };
}
