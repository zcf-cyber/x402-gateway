import type {
  ChallengePayload,
  PaymentProof,
  VerificationResult,
} from "./types.js";
import { createPublicClient, http } from "viem";
import type { ChainConfig } from "./chain-config.js";
import {
  PaymentVerificationFailedError,
  InsufficientPaymentError,
} from "../errors.js";

/**
 * Parse a wei amount string to a bigint.
 * Handles both plain numbers and ether-style strings (e.g., "0.001")
 */
function parseAmount(amount: string): bigint {
  if (amount.includes(".")) {
    const [whole, fraction = ""] = amount.split(".");
    const paddedFraction = fraction.padEnd(18, "0").slice(0, 18);
    return BigInt(whole + paddedFraction);
  }
  return BigInt(amount);
}

/**
 * ERC-20 Transfer event signature
 * keccak256("Transfer(address,address,uint256)")
 */
const ERC20_TRANSFER_SIGNATURE =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df35b9d8";

export interface IPaymentVerifyService {
  verifyPayment(
    proof: PaymentProof,
    challenge: ChallengePayload,
  ): Promise<VerificationResult>;
}

export function createPaymentVerifyService(
  evmRpcUrl: string,
  supportedChains: Record<string, ChainConfig>,
): IPaymentVerifyService {
  const clients = new Map<string, ReturnType<typeof createPublicClient>>();
  for (const [key, config] of Object.entries(supportedChains)) {
    clients.set(key.toLowerCase(), createPublicClient({
      chain: config.chain,
      transport: http(evmRpcUrl),
    }));
  }

  return {
    async verifyPayment(
      proof: PaymentProof,
      challenge: ChallengePayload,
    ): Promise<VerificationResult> {
      const chainKey = proof.chain.toLowerCase();
      const chainConfig = supportedChains[chainKey];
      const publicClient = clients.get(chainKey);

      if (!chainConfig || !publicClient) {
        throw new PaymentVerificationFailedError(
          `Unsupported chain: ${proof.chain}`,
        );
      }

      const usdcContract = chainConfig.usdcAddress;
      const txHash = proof.tx_hash as `0x${string}`;

      let receipt;
      try {
        receipt = await publicClient.getTransactionReceipt({ hash: txHash });
      } catch (error) {
        throw new PaymentVerificationFailedError(
          `Failed to fetch transaction: ${(error as Error).message}`,
        );
      }

      if (receipt.status !== "success") {
        throw new PaymentVerificationFailedError("Transaction failed on-chain");
      }

      const tx = await publicClient.getTransaction({ hash: txHash });
      const payerAddress = proof.payer_address as `0x${string}`;

      if (tx.from.toLowerCase() !== payerAddress.toLowerCase()) {
        throw new PaymentVerificationFailedError(
          "Payer address does not match transaction sender",
        );
      }

      const requiredAmount = parseAmount(challenge.amount);
      const isNativeAsset =
        challenge.asset === "ETH" ||
        challenge.asset === "MATIC" ||
        challenge.asset === "BASE";

      if (isNativeAsset) {
        if (tx.value < requiredAmount) {
          throw new InsufficientPaymentError(
            challenge.amount,
            tx.value.toString(),
          );
        }
        if (tx.to?.toLowerCase() !== challenge.merchant_address.toLowerCase()) {
          throw new PaymentVerificationFailedError(
            `Wrong recipient: expected ${challenge.merchant_address}, got ${tx.to}`,
          );
        }
      } else {
        const transferLogs = receipt.logs.filter((log) => {
          if (log.address.toLowerCase() !== usdcContract.toLowerCase())
            return false;
          if (log.topics.length !== 3) return false;
          return log.topics[0] === ERC20_TRANSFER_SIGNATURE;
        });

        if (transferLogs.length === 0) {
          throw new PaymentVerificationFailedError(
            "No USDC Transfer event found",
          );
        }

        const transferLog = transferLogs[0]!;
        const topic2 = transferLog.topics[2];
        if (!topic2) {
          throw new PaymentVerificationFailedError(
            "Invalid Transfer event: missing recipient topic",
          );
        }
        const toAddress = `0x${topic2.slice(26)}`.toLowerCase();
        const transferValue = BigInt(transferLog.data);

        if (toAddress !== challenge.merchant_address.toLowerCase()) {
          throw new PaymentVerificationFailedError(
            `Wrong recipient: expected ${challenge.merchant_address}, got ${toAddress}`,
          );
        }
        if (transferValue < requiredAmount) {
          throw new InsufficientPaymentError(
            challenge.amount,
            transferValue.toString(),
          );
        }
      }

      return {
        verified: true,
        payer_address: tx.from,
        amount: challenge.amount,
      };
    },
  };
}
