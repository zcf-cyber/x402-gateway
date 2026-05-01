import type {
  ChallengePayload,
  PaymentProof,
  VerificationResult,
} from "../types.js";
import type { IChainRegistry } from "../chain-registry.service.js";
import {
  createEvmVerifyService,
  type IEvmVerifyService,
} from "./evm-verify.service.js";
import {
  createSolanaVerifyService,
  type ISolanaVerifyService,
} from "./solana-verify.service.js";
import { PaymentVerificationFailedError } from "../../errors.js";

export interface IPaymentVerifyService {
  verifyPayment(
    proof: PaymentProof,
    challenge: ChallengePayload,
  ): Promise<VerificationResult>;
}

export function createPaymentVerifyService(deps: {
  chainRegistry: IChainRegistry;
  solanaRpcUrl?: string;
}): IPaymentVerifyService {
  const evmVerifier: IEvmVerifyService = createEvmVerifyService(deps.chainRegistry);
  const solanaVerifier: ISolanaVerifyService | undefined = deps.solanaRpcUrl
    ? createSolanaVerifyService({ rpcUrl: deps.solanaRpcUrl })
    : undefined;

  return {
    async verifyPayment(
      proof: PaymentProof,
      challenge: ChallengePayload,
    ): Promise<VerificationResult> {
      const chain = proof.chain.toLowerCase();

      if (chain === "solana") {
        if (!solanaVerifier) {
          throw new PaymentVerificationFailedError(
            "Solana verification is not configured. Set SOLANA_RPC_URL.",
          );
        }
        return solanaVerifier.verifyPayment(proof, challenge);
      }

      // All other chains route through EVM verifier
      return evmVerifier.verifyPayment(proof, challenge);
    },
  };
}
