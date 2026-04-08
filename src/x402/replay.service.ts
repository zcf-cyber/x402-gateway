import type { Redis } from 'ioredis';

export interface IReplayProtectionService {
  /**
   * Atomically check if a payment proof hash has been seen.
   * Uses Redis SET NX EX for atomic check-and-mark.
   * Throws PaymentReplayedError if the proof is a duplicate.
   */
  checkAndMark(paymentProofHash: string, ttlSeconds: number): Promise<boolean>;

  /**
   * Check Redis for a cached response for this idempotency key.
   * Returns the cached response if found, null if not.
   */
  checkIdempotency(idempotencyKey: string): Promise<unknown | null>;

  /**
   * Cache a response for an idempotency key.
   */
  saveIdempotency(idempotencyKey: string, response: unknown, ttlSeconds: number): Promise<void>;
}

export function createReplayProtectionService(_redis: Redis): IReplayProtectionService {
  return {
    async checkAndMark(
      _paymentProofHash: string,
      _ttlSeconds: number,
    ): Promise<boolean> {
      // TODO: Implement
      // 1. Redis SET payment_proof:<hash> NX EX <ttl>
      // 2. If SET succeeded -> return true (fresh)
      // 3. If SET failed -> throw PaymentReplayedError (duplicate)
      throw new Error('Not implemented');
    },

    async checkIdempotency(_idempotencyKey: string): Promise<unknown | null> {
      // TODO: Redis GET idempotency:<key>
      // Return parsed JSON if found, null if not
      throw new Error('Not implemented');
    },

    async saveIdempotency(
      _idempotencyKey: string,
      _response: unknown,
      _ttlSeconds: number,
    ): Promise<void> {
      // TODO: Redis SET idempotency:<key> <json> EX <ttl>
      throw new Error('Not implemented');
    },
  };
}
