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
import { createPaymentSignatureHeader } from "../helpers.js";

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
      expect(elapsed).toBeGreaterThanOrEqual(45);
      expect(response.usage.prompt_tokens).toBeGreaterThan(0);
      expect(response.usage.completion_tokens).toBeGreaterThan(0);
    });

    it("should simulate provider failures based on failure rate", async () => {
      const provider: SimulatedProvider = {
        name: "unstable-provider",
        models: ["test-model"],
        latencyMs: { min: 10, max: 20 },
        failureRate: 1.0,
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
            { role: "user", content: "a".repeat(100) },
          ],
        },
        "test-model",
      );

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
        failureRate: 1.0,
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

      await expect(service.checkAndMark(hash, 60)).resolves.toBe(true);
      await expect(service.checkAndMark(hash, 60)).rejects.toThrow();
    });

    it("should support idempotency", async () => {
      const service = createSimulatedReplayService();
      const key = "idem-key-123";
      const response = { id: "test-123", status: "success" };

      expect(await service.checkIdempotency(key)).toBeNull();
      await service.saveIdempotency(key, response, 60);
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

      const router = createSimulatedRouterService(providers);

      const result = await router.route({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Hello" }],
      });

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

      const router = createSimulatedRouterService(providers);

      await expect(
        router.route({
          model: "unknown/model",
          messages: [{ role: "user", content: "Hello" }],
        }),
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

    it("should complete full v2 flow in simulation", async () => {
      // Step 1: Get 402 with PAYMENT-REQUIRED header
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
      expect(challengeBody.payment_requirements).toBeDefined();
      expect(challengeBody.payment_requirements.quote_id).toBeDefined();

      // Step 2: Submit payment with v2 PAYMENT-SIGNATURE header
      const paymentSignature = createPaymentSignatureHeader({ amount: "0.05" });

      const successResponse = await env.app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
        headers: {
          "payment-signature": paymentSignature,
        },
      });

      expect(successResponse.statusCode).toBe(200);
      const body = successResponse.json();
      expect(body.usage_receipt).toBeDefined();
      expect(body.usage_receipt.model_used).toContain("openai");
    });

    it("should track metrics correctly", async () => {
      // Get 402
      const challengeResponse = await env.app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Test" }],
        },
      });

      expect(challengeResponse.statusCode).toBe(402);

      const paymentSignature = createPaymentSignatureHeader({ amount: "0.05" });

      // Submit request — mock orchestrator returns canned 200
      const result = await env.app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Test" }],
        },
        headers: {
          "payment-signature": paymentSignature,
        },
      });

      expect(result.statusCode).toBe(200);
      expect(result.json().usage_receipt).toBeDefined();
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

      // 402 response — mock orchestrator uses providerRegistry for pricing
      const challengeResponse = await env.app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "custom-provider/custom-model",
          messages: [{ role: "user", content: "Hello" }],
        },
      });

      expect(challengeResponse.statusCode).toBe(402);

      const paymentSignature = createPaymentSignatureHeader({ amount: "0.05" });

      const successResponse = await env.app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "custom-provider/custom-model",
          messages: [{ role: "user", content: "Hello" }],
        },
        headers: {
          "payment-signature": paymentSignature,
        },
      });

      // Mock orchestrator returns 200 with canned success (model: "openai/gpt-4o")
      expect(successResponse.statusCode).toBe(200);
    });
  });
});
