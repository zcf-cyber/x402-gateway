import { PaymentReplayedError } from "../errors.js";

/**
 * Minimal Redis-like interface for replay protection.
 * Compatible with ioredis Redis and InMemoryRedis implementations.
 */
export interface RedisLike {
  set(
    key: string,
    value: string,
    exOrPx?: string,
    ms?: number,
    nx?: string,
  ): Promise<string | null>;
  get(key: string): Promise<string | null>;
}

export interface IReplayProtectionService {
  checkAndMark(paymentProofHash: string, ttlSeconds: number): Promise<boolean>;
  checkIdempotency(idempotencyKey: string): Promise<unknown | null>;
  saveIdempotency(
    idempotencyKey: string,
    response: unknown,
    ttlSeconds: number,
  ): Promise<void>;
}

export function createReplayProtectionService(
  redis: RedisLike,
): IReplayProtectionService {
  return {
    async checkAndMark(
      paymentProofHash: string,
      ttlSeconds: number,
    ): Promise<boolean> {
      const key = `payment_proof:${paymentProofHash}`;
      const result = await redis.set(key, "1", "EX", ttlSeconds, "NX");
      if (result === "OK") {
        return true;
      }
      throw new PaymentReplayedError();
    },

    async checkIdempotency(idempotencyKey: string): Promise<unknown | null> {
      const key = `idempotency:${idempotencyKey}`;
      const cached = await redis.get(key);
      if (!cached) return null;
      try {
        return JSON.parse(cached);
      } catch {
        return null;
      }
    },

    async saveIdempotency(
      idempotencyKey: string,
      response: unknown,
      ttlSeconds: number,
    ): Promise<void> {
      const key = `idempotency:${idempotencyKey}`;
      const value = JSON.stringify(response);
      await redis.set(key, value, "EX", ttlSeconds);
    },
  };
}