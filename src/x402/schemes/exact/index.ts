// ---------------------------------------------------------------------------
// Exact Scheme — PaymentScheme Implementation
//
// Wraps EIP-3009 verify and settle services behind the PaymentScheme
// interface. Both verify() and settle() are functional; settlement is
// routed through the SchemeRegistry, not called directly by the orchestrator.
// ---------------------------------------------------------------------------

import type { PaymentScheme, SchemeVerifyContext, SchemeSettleContext } from "../types.js";
import type { PaymentPayloadV2, SettlementResponseV2 } from "../../transport/types.js";
import type { Address } from "viem";
import { createExactVerifyService, type TokenMeta } from "./verify.service.js";
import type { IExactSettleService } from "./settle.service.js";
import { caip2ToChain } from "../../transport/caip2.js";
import { PaymentVerificationFailedError } from "../../../errors.js";

export function createExactScheme(
  settleService?: IExactSettleService,
): PaymentScheme {
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
        name: tokenConfig.eip712Name,
        version: tokenConfig.eip712Version,
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
      ctx: SchemeSettleContext,
    ): Promise<SettlementResponseV2> {
      if (!settleService) {
        return {
          success: false,
          errorReason: "not_configured",
          errorMessage: "Settlement service not configured for exact scheme",
          transaction: "",
          network: payload.accepted.network,
        };
      }
      return settleService.settlePayment(
        payload,
        ctx.chain,
        ctx.rpcUrl,
        ctx.tokenAddress,
      );
    },
  };
}
