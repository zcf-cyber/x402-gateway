import { Connection } from "@solana/web3.js";
import type {
  ChallengePayload,
  PaymentProof,
  VerificationResult,
} from "../types.js";
import type { ITokenRegistry } from "../token-registry.service.js";
import {
  PaymentVerificationFailedError,
  InsufficientPaymentError,
} from "../../errors.js";

/** Official Solana Mainnet USDC SPL Token mint address */
export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** SPL Token program ID (legacy) */
export const SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
/** SPL Token 2022 program ID */
const SPL_TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/**
 * Parse a decimal amount string to base units using specified decimals.
 * e.g. "0.001" -> 1000n (for 6-decimal tokens like USDC)
 */
function parseSolanaAmount(amount: string, decimals: number): bigint {
  if (amount.includes(".")) {
    const [whole, fraction = ""] = amount.split(".");
    const paddedFraction = fraction
      .padEnd(decimals, "0")
      .slice(0, decimals);
    return BigInt(whole + paddedFraction);
  }
  return BigInt(amount) * BigInt(10 ** decimals);
}

export interface ISolanaVerifyService {
  verifyPayment(
    proof: PaymentProof,
    challenge: ChallengePayload,
  ): Promise<VerificationResult>;
}

export function createSolanaVerifyService(deps: {
  rpcUrl: string;
  tokenRegistry: ITokenRegistry;
}): ISolanaVerifyService {
  const connection = new Connection(deps.rpcUrl, "confirmed");

  return {
    async verifyPayment(
      proof: PaymentProof,
      challenge: ChallengePayload,
    ): Promise<VerificationResult> {
      let signature: string;
      try {
        signature = proof.tx_hash;
        if (!signature || signature.length < 64 || signature.length > 88) {
          throw new PaymentVerificationFailedError("Invalid Solana transaction signature");
        }
      } catch {
        throw new PaymentVerificationFailedError("Invalid Solana transaction signature");
      }

      let parsedTx;
      try {
        parsedTx = await connection.getParsedTransaction(signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
      } catch (error) {
        throw new PaymentVerificationFailedError(
          `Failed to fetch Solana transaction: ${(error as Error).message}`,
        );
      }

      if (!parsedTx) {
        throw new PaymentVerificationFailedError(
          "Solana transaction not found or not yet confirmed",
        );
      }

      if (parsedTx.meta?.err) {
        throw new PaymentVerificationFailedError(
          `Solana transaction failed: ${JSON.stringify(parsedTx.meta.err)}`,
        );
      }

      const feePayer = parsedTx.transaction.message.accountKeys[0]?.pubkey.toBase58();
      if (!feePayer || feePayer.toLowerCase() !== proof.payer_address.toLowerCase()) {
        throw new PaymentVerificationFailedError(
          "Payer address does not match transaction fee payer",
        );
      }

      // Resolve token config from TokenRegistry
      const tokenConfig = deps.tokenRegistry.get("solana", challenge.asset);
      if (!tokenConfig) {
        throw new PaymentVerificationFailedError(
          `Unsupported asset: ${challenge.asset} on chain solana`,
        );
      }

      const tokenMint = tokenConfig.address;
      const tokenDecimals = tokenConfig.decimals;
      const tokenSymbol = tokenConfig.symbol;
      const requiredAmount = parseSolanaAmount(challenge.amount, tokenDecimals);

      const accountOwners = new Map<number, string>();
      for (const pre of parsedTx.meta?.preTokenBalances ?? []) {
        if (pre.mint === tokenMint && pre.owner) {
          accountOwners.set(pre.accountIndex, pre.owner);
        }
      }
      for (const post of parsedTx.meta?.postTokenBalances ?? []) {
        if (post.mint === tokenMint && post.owner && !accountOwners.has(post.accountIndex)) {
          accountOwners.set(post.accountIndex, post.owner);
        }
      }

      const pubkeyToIndex = new Map<string, number>();
      parsedTx.transaction.message.accountKeys.forEach((acc, idx) => {
        pubkeyToIndex.set(acc.pubkey.toBase58(), idx);
      });

      let totalReceived = 0n;
      let foundTransfer = false;

      const instructions = parsedTx.transaction.message.instructions;
      for (const ix of instructions) {
        const programId = ix.programId?.toBase58?.() ?? (ix as unknown as Record<string, unknown>).programId;
        if (
          programId !== SPL_TOKEN_PROGRAM_ID &&
          programId !== SPL_TOKEN_2022_PROGRAM_ID
        ) {
          continue;
        }

        const parsed = (ix as unknown as { parsed?: { type?: string; info?: Record<string, unknown> } }).parsed;
        if (!parsed) continue;

        const type = parsed.type;
        if (type !== "transfer" && type !== "transferChecked") continue;

        const info = parsed.info;
        if (!info) continue;

        if (type === "transferChecked") {
          const mint = info.mint as string | undefined;
          if (mint !== tokenMint) continue;
        }

        const sourceAccount = info.source as string | undefined;
        const destAccount = info.destination as string | undefined;
        if (!sourceAccount || !destAccount) continue;

        const sourceIdx = pubkeyToIndex.get(sourceAccount);
        const destIdx = pubkeyToIndex.get(destAccount);
        if (sourceIdx === undefined || destIdx === undefined) continue;

        const sourceOwner = accountOwners.get(sourceIdx);
        const destOwner = accountOwners.get(destIdx);

        if (
          sourceOwner?.toLowerCase() === proof.payer_address.toLowerCase() &&
          destOwner?.toLowerCase() === challenge.merchant_address.toLowerCase()
        ) {
          foundTransfer = true;
          if (type === "transferChecked") {
            const tokenAmount = info.tokenAmount as { amount?: string } | undefined;
            if (tokenAmount?.amount) {
              totalReceived += BigInt(tokenAmount.amount);
            }
          } else {
            const amount = info.amount as string | undefined;
            if (amount) {
              totalReceived += BigInt(amount);
            }
          }
        }
      }

      if (!foundTransfer) {
        throw new PaymentVerificationFailedError(
          `No ${tokenSymbol} transfer from payer to merchant found in transaction`,
        );
      }

      if (totalReceived < requiredAmount) {
        throw new InsufficientPaymentError(
          challenge.amount,
          (Number(totalReceived) / 10 ** tokenDecimals).toFixed(tokenDecimals),
        );
      }

      return {
        verified: true,
        payer_address: proof.payer_address,
        amount: challenge.amount,
      };
    },
  };
}
