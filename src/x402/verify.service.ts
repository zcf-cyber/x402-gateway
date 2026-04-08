import type { ChallengePayload, PaymentProof, VerificationResult } from './types.js';

export interface IPaymentVerifyService {
  /**
   * Verify on-chain payment proof against the challenge requirements.
   * Uses viem for EVM RPC interaction.
   *
   * Checks:
   * 1. Payment amount >= challenge amount
   * 2. Asset matches (e.g. USDC)
   * 3. Recipient matches merchant_address
   *
   * Throws PaymentVerificationFailedError or InsufficientPaymentError on failure.
   */
  verifyPayment(proof: PaymentProof, challenge: ChallengePayload): Promise<VerificationResult>;
}

export function createPaymentVerifyService(): IPaymentVerifyService {
  return {
    async verifyPayment(
      _proof: PaymentProof,
      _challenge: ChallengePayload,
    ): Promise<VerificationResult> {
      // TODO: Implement
      // 1. Use viem to query on-chain transaction by tx_hash
      // 2. Verify amount >= challenge.amount
      // 3. Verify asset matches challenge.asset
      // 4. Verify recipient matches challenge.merchant_address
      // 5. Return VerificationResult
      throw new Error('Not implemented');
    },
  };
}
