// ---------------------------------------------------------------------------
// x402 Payment Verification Service — Unified Entry Point
//
// Routes payment verification to the appropriate scheme:
//   - EVM chains → exact scheme (EIP-3009 signature verification)
//   - Solana    → solana-verify.service.ts (unchanged, tx_hash based)
//
// Both old (tx_hash) and new (EIP-3009) verification paths are supported
// during the transition period. New flows should use verifyPaymentV2().
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
import { PaymentVerificationFailedError } from "../../errors.js";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface IPaymentVerifyService {
  /**
   * @deprecated Use verifyPaymentV2() for new x402 v2 flows.
   *   Legacy verification based on tx_hash lookup.
   *   Kept for backward compatibility during migration.
   */
  verifyPayment(
    proof: PaymentProof,
    challenge: ChallengePayload,
  ): Promise<VerificationResult>;

  /**
   * Verify payment using x402 v2 PaymentPayload (EIP-3009 signature).
   * Primary verification path for the x402 v2 exact scheme.
   *
   * @param paymentPayload - Decoded x402 v2 payment payload
   * @param merchantAddress - Gateway facilitator/merchant address
   * @returns Verified payer address
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
    // Legacy method — kept for transitional backward compatibility
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

      // For EVM chains, legacy path is no longer the primary method.
      // Delegate to the EVM verifier's tx_hash logic (kept for compat).
      // In practice, all new flows will use verifyPaymentV2() instead.
      const { createEvmVerifyService } = await import(
        "./evm-verify.service.js"
      );
      const evmVerifier = createEvmVerifyService(
        chainRegistry,
        tokenRegistry,
      );
      return evmVerifier.verifyPayment(proof, challenge);
    },

    // New v2 primary verification path
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

      // Solana fallback — keep existing logic for now
      if (chainName === "solana") {
        if (!solanaVerifier) {
          throw new PaymentVerificationFailedError(
            "Solana verification is not configured. Set SOLANA_RPC_URL.",
          );
        }
        // Convert v2 payload to legacy format for solana-verify
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
        name: tokenConfig.symbol,
        version: "2", // USDC v2 for EIP-3009
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
