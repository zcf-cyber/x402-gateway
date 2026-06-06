// ---------------------------------------------------------------------------
// x402 Payment Verification Service — Legacy Compatibility Wrapper
//
// NOTE: The primary verification path is now through the SchemeRegistry
// (see src/x402/schemes/). This file exists for backward compatibility
// with tests and simulation environments that still use the old interface.
//
// New production code should use SchemeRegistry.verify() instead of
// IPaymentVerifyService.verifyPaymentV2().
// ---------------------------------------------------------------------------

import type { Address } from "viem";
import type {
  ChallengePayload,
  PaymentProof,
  VerificationResult,
} from "../types.js";
import type { PaymentPayloadV2 } from "../transport/types.js";
import { caip2ToChain } from "../transport/caip2.js";
import type { IChainRegistry } from "../chain-registry.service.js";
import type { ITokenRegistry } from "../token-registry.service.js";
import {
  createExactVerifyService,
  type IExactVerifyService,
  type TokenMeta,
} from "../schemes/exact/verify.service.js";
import {
  createSolanaVerifyService,
  type ISolanaVerifyService,
} from "./solana-verify.service.js";
import {
  createEvmVerifyService,
} from "./evm-verify.service.js";
import { PaymentVerificationFailedError } from "../../errors.js";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface IPaymentVerifyService {
  /**
   * @deprecated Use SchemeRegistry.verify() for new flows.
   *   Legacy verification based on tx_hash lookup.
   */
  verifyPayment(
    proof: PaymentProof,
    challenge: ChallengePayload,
  ): Promise<VerificationResult>;

  /**
   * @deprecated Use SchemeRegistry.verify() for new flows.
   *   Verify payment using x402 v2 PaymentPayload.
   */
  verifyPaymentV2(
    paymentPayload: PaymentPayloadV2,
    merchantAddress: string,
  ): Promise<{ payer: Address }>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPaymentVerifyService(deps: {
  chainRegistry: IChainRegistry;
  tokenRegistry: ITokenRegistry;
  solanaRpcUrl?: string;
  merchantAddress: string;
}): IPaymentVerifyService {
  const exactVerify: IExactVerifyService = createExactVerifyService();
  const solanaVerifier: ISolanaVerifyService | undefined = deps.solanaRpcUrl
    ? createSolanaVerifyService({
        rpcUrl: deps.solanaRpcUrl,
        tokenRegistry: deps.tokenRegistry,
      })
    : undefined;

  const { chainRegistry, tokenRegistry } = deps;

  return {
    // Legacy tx_hash verification — used by simulation tests
    async verifyPayment(
      proof: PaymentProof,
      challenge: ChallengePayload,
    ): Promise<VerificationResult> {
      const chainKey = proof.chain.toLowerCase();

      if (chainKey === "solana") {
        if (!solanaVerifier) {
          throw new PaymentVerificationFailedError(
            "Solana verification is not configured. Set SOLANA_RPC_URL.",
          );
        }
        return solanaVerifier.verifyPayment(proof, challenge);
      }

      const evmVerifier = createEvmVerifyService(
        chainRegistry,
        tokenRegistry,
      );
      return evmVerifier.verifyPayment(proof, challenge);
    },

    // v2 verification — delegates to exact scheme (EIP-3009)
    async verifyPaymentV2(
      paymentPayload: PaymentPayloadV2,
      merchAddr: string,
    ): Promise<{ payer: Address }> {
      const caip2Net = paymentPayload.accepted.network;
      let chainName: string;
      try {
        chainName = caip2ToChain(caip2Net);
      } catch {
        throw new PaymentVerificationFailedError(
          `Unsupported network in payment payload: ${caip2Net}`,
        );
      }

      if (chainName === "solana") {
        if (!solanaVerifier) {
          throw new PaymentVerificationFailedError(
            "Solana verification is not configured.",
          );
        }
        const legacyProof: PaymentProof = {
          tx_hash: (paymentPayload.payload as Record<string, unknown>)[
            "tx_hash"
          ] as string,
          chain: chainName,
          payer_address: (paymentPayload.payload as Record<string, unknown>)[
            "from"
          ] as string,
        };
        const legacyChallenge: ChallengePayload = {
          quote_id: "",
          request_hash: "",
          amount: paymentPayload.accepted.amount,
          asset: paymentPayload.accepted.asset,
          chain: chainName,
          merchant_address: merchAddr,
          expires_at: new Date(
            Date.now() + paymentPayload.accepted.maxTimeoutSeconds * 1000,
          ).toISOString(),
        };
        const result = await solanaVerifier.verifyPayment(
          legacyProof,
          legacyChallenge,
        );
        return { payer: result.payer_address as Address };
      }

      // EVM chains → exact scheme (EIP-3009)
      const chainConfig = chainRegistry.get(chainName);
      if (!chainConfig) {
        throw new PaymentVerificationFailedError(
          `Chain not configured: ${chainName}`,
        );
      }

      const asset = paymentPayload.accepted.asset;
      const tokenConfig = tokenRegistry.get(chainName, asset);
      if (!tokenConfig) {
        throw new PaymentVerificationFailedError(
          `Unsupported asset: ${asset} on chain ${chainName}`,
        );
      }

      const tokenMeta: TokenMeta = {
        // Use EIP-712 domain name from token config, not the symbol
        name: tokenConfig.eip712Name,
        version: tokenConfig.eip712Version,
        address: tokenConfig.address,
        decimals: tokenConfig.decimals,
      };

      return exactVerify.verifyExactPayment(
        paymentPayload,
        tokenMeta,
        chainConfig.chain.id,
        merchAddr,
      );
    },
  };
}
