import { describe, it, expect } from "vitest";
import { createChallengeService } from "../../src/x402/challenge.service.js";
import {
  RequestHashMismatchError,
  ChallengeExpiredError,
} from "../../src/errors.js";

describe("ChallengeService Security", () => {
  const service = createChallengeService({
    challengeSecret: "test-secret-at-least-32-chars-long-for-testing",
    challengeTtlSeconds: 300,
    merchantAddress: "0x0000000000000000000000000000000000000001",
    paymentChain: "base",
    paymentAsset: "USDC",
  });

  it("should reject invalid challenge token due to wrong signature", async () => {
    const request = {
      model: "gpt-4",
      messages: [{ role: "user" as const, content: "hello" }],
    };

    const validChallenge = await service.generateChallenge(request, "0.001");
    const tamperedToken = validChallenge.challenge_token.slice(0, -1) + "X";

    await expect(
      service.verifyChallenge(tamperedToken, request),
    ).rejects.toThrow();
  });

  it("should reject invalid challenge token due to malformed structure", async () => {
    const request = {
      model: "gpt-4",
      messages: [{ role: "user" as const, content: "hello" }],
    };

    const malformedToken = "invalid.token.format.extra";

    await expect(
      service.verifyChallenge(malformedToken, request),
    ).rejects.toThrow("Invalid challenge token format");
  });

  it("should reject expired challenge token", async () => {
    const request = {
      model: "gpt-4",
      messages: [{ role: "user" as const, content: "hello" }],
    };

    const shortLivedService = createChallengeService({
      challengeSecret: "test-secret-at-least-32-chars-long-for-testing",
      challengeTtlSeconds: -1,
      merchantAddress: "0x0000000000000000000000000000000000000001",
      paymentChain: "base",
      paymentAsset: "USDC",
    });

    const challenge = await shortLivedService.generateChallenge(request, "0.001");

    await expect(
      shortLivedService.verifyChallenge(challenge.challenge_token, request),
    ).rejects.toThrow(ChallengeExpiredError);
  });

  it("should reject request hash mismatch", async () => {
    const request1 = {
      model: "gpt-4",
      messages: [{ role: "user" as const, content: "hello" }],
    };

    const request2 = {
      model: "gpt-4",
      messages: [{ role: "user" as const, content: "different content" }],
    };

    const challenge = await service.generateChallenge(request1, "0.001");

    await expect(
      service.verifyChallenge(challenge.challenge_token, request2),
    ).rejects.toThrow(RequestHashMismatchError);
  });

  it("should accept valid challenge token with correct signature and request body", async () => {
    const request = {
      model: "gpt-4",
      messages: [{ role: "user" as const, content: "hello" }],
    };

    const challenge = await service.generateChallenge(request, "0.001");

    const result = await service.verifyChallenge(challenge.challenge_token, request);

    expect(result).toEqual({
      quote_id: challenge.quote_id,
      request_hash: challenge.request_hash,
      amount: "0.001",
      asset: "USDC",
      chain: "base",
      merchant_address: "0x0000000000000000000000000000000000000001",
      expires_at: expect.any(String),
    });
  });
});