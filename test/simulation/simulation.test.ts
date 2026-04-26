/**
 * Simulation Tests - Full-stack simulation testing
 *
 * Tests the x402 gateway under simulated production conditions
 * using realistic provider behavior and network conditions.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  buildSimulationEnvironment,
  createSimulatedAdapter,
  createSimulatedVerifyService,
  createSimulatedReplayService,
  createSimulatedRouterService,
  DEFAULT_SIMULATION_CONFIG,
  type SimulatedProvider,
} from "./environment.js";
import type { PaymentProof } from "../../src/x402/types.js";

describe("Simulation Environment", () => {
  describe("Simulated Adapter", () => {
    it("should simulate provider latency", async () => {
      const provider: SimulatedProvider = {
        name: "test-provider",
        models: ["test-model"],
        latencyMs: { min: 50, max: 100 },
        failureRate: 0,
        rateLimitRPS: 1000,
      };

      const adapter = createSimulatedAdapter(provider);
      const startTime = Date.now();

      const response = await adapter.execute(
        {
          model: "test-model",
          messages: [{ role: "user", content: "Hello" }],
        },
        "test-model",
      );

      const elapsed = Date.now() - startTime;

      expect(response).toBeDefined();
      expect(response.model_used).toContain("test-provider");
      expect(elapsed).toBeGreaterThanOrEqual(45); // Allow small variance
      expect(response.usage.prompt_tokens).toBeGreaterThan(0);
      expect(response.usage.completion_tokens).toBeGreaterThan(0);
    });

    it("should simulate provider failures based on failure rate", async () => {
      const provider: SimulatedProvider = {
        name: "unstable-provider",
        models: ["test-model"],
        latencyMs: { min: 10, max: 20 },
        failureRate: 1.0, // Always fail
        rateLimitRPS: 1000,
      };

      const adapter = createSimulatedAdapter(provider);

      await expect(
        adapter.execute(
          {
            model: "test-model",
            messages: [{ role: "user", content: "Hello" }],
          },
          "test-model",
        ),
      ).rejects.toThrow("Simulated unstable-provider API failure");
    });

    it("should calculate prompt tokens based on message length", async () => {
      const provider: SimulatedProvider = {
        name: "test-provider",
        models: ["test-model"],
        latencyMs: { min: 1, max: 5 },
        failureRate: 0,
        rateLimitRPS: 1000,
      };

      const adapter = createSimulatedAdapter(provider);

      const response = await adapter.execute(
        {
          model: "test-model",
          messages: [
            { role: "user", content: "a".repeat(100) }, // 100 chars
          ],
        },
        "test-model",
      );

      // Token count should be roughly content.length / 4
      expect(response.usage.prompt_tokens).toBeGreaterThan(20);
      expect(response.usage.prompt_tokens).toBeLessThan(30);
    });
  });

  describe("Simulated Verification Service", () => {
    it("should verify payment with realistic latency", async () => {
      const service = createSimulatedVerifyService({
        latencyMs: { min: 50, max: 100 },
        failureRate: 0,
      });

      const proof: PaymentProof = {
        tx_hash: "0x" + "a".repeat(64),
        chain: "base",
        payer_address: "0x1234567890123456789012345678901234567890",
      };

      const startTime = Date.now();
      const result = await service.verifyPayment(proof, { amount: "0.001" });
      const elapsed = Date.now() - startTime;

      expect(result.verified).toBe(true);
      expect(result.payer_address).toBe(proof.payer_address);
      expect(elapsed).toBeGreaterThanOrEqual(45);
    });

    it("should fail verification based on failure rate", async () => {
      const service = createSimulatedVerifyService({
        latencyMs: { min: 10, max: 20 },
        failureRate: 1.0, // Always fail
      });

      const proof: PaymentProof = {
        tx_hash: "0x" + "a".repeat(64),
        chain: "base",
        payer_address: "0x1234567890123456789012345678901234567890",
      };

      await expect(
        service.verifyPayment(proof, { amount: "0.001" }),
      ).rejects.toThrow("Simulated verification failure");
    });
  });

  describe("Simulated Replay Service", () => {
    it("should prevent replay attacks", async () => {
      const service = createSimulatedReplayService();
      const hash = "test-hash-123";

      // First check should pass
      await expect(service.checkAndMark(hash, 60)).resolves.toBe(true);

      // Second check should fail with replay error
      await expect(service.checkAndMark(hash, 60)).rejects.toThrow();
    });

    it("should support idempotency", async () => {
      const service = createSimulatedReplayService();
      const key = "idem-key-123";
      const response = { id: "test-123", status: "success" };

      // Check should return null initially
      expect(await service.checkIdempotency(key)).toBeNull();

      // Save idempotency
      await service.saveIdempotency(key, response, 60);

      // Check should return saved response
      expect(await service.checkIdempotency(key)).toEqual(response);
    });
  });

  describe("Simulated Router", () => {
    it("should route to provider in manual mode", async () => {
      const providers: SimulatedProvider[] = [
        {
          name: "openai",
          models: ["gpt-4o"],
          latencyMs: { min: 10, max: 20 },
          failureRate: 0,
          rateLimitRPS: 1000,
        },
      ];

      const router = createSimulatedRouterService(providers, {
        mode: "manual",
      });

      const result = await router.route(
        {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
        "manual",
      );

      expect(result.decision.selected_model).toBe("openai/gpt-4o");
      expect(result.response.model_used).toContain("openai");
    });

    it("should throw error for unknown provider", async () => {
      const providers: SimulatedProvider[] = [
        {
          name: "openai",
          models: ["gpt-4o"],
          latencyMs: { min: 10, max: 20 },
          failureRate: 0,
          rateLimitRPS: 1000,
        },
      ];

      const router = createSimulatedRouterService(providers, {
        mode: "manual",
      });

      await expect(
        router.route(
          {
            model: "unknown/model",
            messages: [{ role: "user", content: "Hello" }],
          },
          "manual",
        ),
      ).rejects.toThrow("Provider unknown not found");
    });
  });

  describe("Full Simulation Environment", () => {
    let env: ReturnType<typeof buildSimulationEnvironment>;

    beforeEach(() => {
      const stableConfig = {
        ...DEFAULT_SIMULATION_CONFIG,
        providers: DEFAULT_SIMULATION_CONFIG.providers.map((p) => ({
          ...p,
          failureRate: 0,
        })),
      };
      env = buildSimulationEnvironment(stableConfig);
      env.metrics.reset();
    });

    it("should complete full 402 flow in simulation", async () => {
      // Step 1: Get challenge
      const challengeResponse = await env.app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
      });

      expect(challengeResponse.statusCode).toBe(402);
      const challengeBody = challengeResponse.json();
      const challengeToken = challengeBody.payment_requirements.challenge_token;

      // Step 2: Submit payment
      const paymentProof: PaymentProof = {
        tx_hash: "0x" + "a".repeat(64),
        chain: "base",
        payer_address: "0x1234567890123456789012345678901234567890",
      };
      const paymentHeader = Buffer.from(JSON.stringify(paymentProof)).toString(
        "base64url",
      );

      const successResponse = await env.app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
        headers: {
          "x-402-challenge": challengeToken,
          "x-402-payment": paymentHeader,
        },
      });

      expect(successResponse.statusCode).toBe(200);
      const body = successResponse.json();
      expect(body.usage_receipt).toBeDefined();
      expect(body.usage_receipt.model_used).toContain("openai");
    });

    it("should track metrics correctly", async () => {
      const paymentProof: PaymentProof = {
        tx_hash: "0x" + "b".repeat(64),
        chain: "base",
        payer_address: "0x1234567890123456789012345678901234567890",
      };

      // Get challenge
      const challengeResponse = await env.app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Test" }],
        },
      });

      const challengeToken =
        challengeResponse.json().payment_requirements.challenge_token;
      const paymentHeader = Buffer.from(JSON.stringify(paymentProof)).toString(
        "base64url",
      );

      // Submit request
      await env.app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Test" }],
        },
        headers: {
          "x-402-challenge": challengeToken,
          "x-402-payment": paymentHeader,
        },
      });

      // Verify metrics were tracked
      expect(env.metrics.getRequestCount()).toBeGreaterThan(0);
      expect(env.metrics.getAverageLatency()).toBeGreaterThan(0);
    });
  });

  describe("Simulation with Custom Config", () => {
    it("should use custom provider configuration", async () => {
      const customConfig = {
        ...DEFAULT_SIMULATION_CONFIG,
        providers: [
          {
            name: "custom-provider",
            models: ["custom-model"],
            latencyMs: { min: 5, max: 10 },
            failureRate: 0,
            rateLimitRPS: 10000,
          },
        ],
      };

      const env = buildSimulationEnvironment(customConfig);

      const challengeResponse = await env.app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "custom-provider/custom-model",
          messages: [{ role: "user", content: "Hello" }],
        },
      });

      expect(challengeResponse.statusCode).toBe(402);

      const paymentProof: PaymentProof = {
        tx_hash: "0x" + "c".repeat(64),
        chain: "base",
        payer_address: "0x1234567890123456789012345678901234567890",
      };

      const successResponse = await env.app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "custom-provider/custom-model",
          messages: [{ role: "user", content: "Hello" }],
        },
        headers: {
          "x-402-challenge":
            challengeResponse.json().payment_requirements.challenge_token,
          "x-402-payment": Buffer.from(JSON.stringify(paymentProof)).toString(
            "base64url",
          ),
        },
      });

      expect(successResponse.statusCode).toBe(200);
      expect(successResponse.json().model).toContain("custom-provider");
    });
  });
});
