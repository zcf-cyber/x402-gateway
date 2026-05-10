import type {
  ChallengePayload,
  PaymentProof,
  VerificationResult,
} from "../types.js";
import type { IChainRegistry } from "../chain-registry.service.js";
import type { ITokenRegistry } from "../token-registry.service.js";
import {
  buildTokenRegistryFromChains,
} from "../token-registry.service.js";
import { getSupportedChains } from "../chain-config.js";
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
  tokenRegistry?: ITokenRegistry;
}): IPaymentVerifyService {
  // Build default token registry from static chain config when not provided.
  // Production should always inject an explicit registry via app.ts.
  const tokenRegistry: ITokenRegistry =
    deps.tokenRegistry ??
    buildTokenRegistryFromChains(getSupportedChains("testnet"));

  const evmVerifier: IEvmVerifyService = createEvmVerifyService(
    deps.chainRegistry,
    tokenRegistry,
  );
  const solanaVerifier: ISolanaVerifyService | undefined = deps.solanaRpcUrl
    ? createSolanaVerifyService({ rpcUrl: deps.solanaRpcUrl, tokenRegistry })
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
