import type { ChatCompletionRequest } from '../types.js';
import type { ChallengePayload, PaymentRequirements } from './types.js';

export interface IChallengeService {
  /**
   * Generate a 402 challenge for an unpaid request.
   * 1. Create quote_id
   * 2. Compute deterministic request_hash from body (canonical JSON -> SHA-256)
   * 3. Sign challenge_token with HMAC (via jose)
   * 4. Set expires_at = now + CHALLENGE_TTL_SECONDS
   */
  generateChallenge(request: ChatCompletionRequest, estimatedCost: string): Promise<PaymentRequirements>;

  /**
   * Verify a challenge token from the retry request.
   * Checks: signature valid, not expired, request_hash matches current body.
   * Throws ChallengeExpiredError or RequestHashMismatchError on failure.
   */
  verifyChallenge(challengeToken: string, requestBody: ChatCompletionRequest): Promise<ChallengePayload>;

  /**
   * Compute a deterministic hash of the request body.
   * Used for binding challenge to a specific request.
   */
  computeRequestHash(body: ChatCompletionRequest): string;
}

export function createChallengeService(_deps: {
  challengeSecret: string;
  challengeTtlSeconds: number;
  merchantAddress: string;
  paymentChain: string;
  paymentAsset: string;
}): IChallengeService {
  return {
    async generateChallenge(
      _request: ChatCompletionRequest,
      _estimatedCost: string,
    ): Promise<PaymentRequirements> {
      // TODO: Implement
      // 1. Generate quote_id with nanoid
      // 2. Compute request_hash via computeRequestHash()
      // 3. Build ChallengePayload
      // 4. Sign with HMAC using jose
      // 5. Return PaymentRequirements
      throw new Error('Not implemented');
    },

    async verifyChallenge(
      _challengeToken: string,
      _requestBody: ChatCompletionRequest,
    ): Promise<ChallengePayload> {
      // TODO: Implement
      // 1. Verify HMAC signature (jose)
      // 2. Check expires_at > now (throw ChallengeExpiredError)
      // 3. Recompute request_hash from requestBody
      // 4. Compare with payload.request_hash (throw RequestHashMismatchError)
      // 5. Return decoded ChallengePayload
      throw new Error('Not implemented');
    },

    computeRequestHash(_body: ChatCompletionRequest): string {
      // TODO: Implement
      // 1. Canonical JSON stringify (sorted keys)
      // 2. SHA-256 hash
      // 3. Return hex string prefixed with "rh_"
      throw new Error('Not implemented');
    },
  };
}
