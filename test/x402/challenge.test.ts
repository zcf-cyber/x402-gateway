import { describe, it, expect } from "vitest";
import { createChallengeService } from "../../src/x402/challenge.service.js";

describe("ChallengeService", () => {
  const service = createChallengeService({
    challengeSecret: "test-secret-at-least-32-chars-long-for-testing",
    challengeTtlSeconds: 300,
    merchantAddress: "0x0000000000000000000000000000000000000001",
    paymentChain: "base",
    paymentAsset: "USDC",
  });

  it("should exist and have the expected interface", () => {
    expect(service).toBeDefined();
    expect(typeof service.generateChallenge).toBe("function");
    expect(typeof service.verifyChallenge).toBe("function");
    expect(typeof service.computeRequestHash).toBe("function");
  });

  it("generateChallenge should return valid PaymentRequirements", async () => {
    const request = {
      model: "gpt-4",
      messages: [{ role: "user" as const, content: "hello" }],
    };
    const result = await service.generateChallenge(request, "0.001");

    expect(result).toHaveProperty("quote_id");
    expect(result).toHaveProperty("chain", "base");
    expect(result).toHaveProperty("asset", "USDC");
    expect(result).toHaveProperty("amount", "0.001");
    expect(result).toHaveProperty("expires_at");
    expect(result).toHaveProperty("merchant_address");
    expect(result).toHaveProperty("request_hash");
    expect(result).toHaveProperty("challenge_token");

    expect(result.request_hash).toMatch(/^rh_[a-f0-9]{64}$/);
  });
});