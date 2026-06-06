import { describe, it, expect } from "vitest";
import {
  buildTestApp,
  buildMockedTestApp,
  createPaymentSignatureHeader,
} from "../helpers.js";

describe("End-to-End Integration Flow (x402 v2)", () => {
  describe("Complete Payment Flow", () => {
    it("should return 402 with PAYMENT-REQUIRED header when no payment signature provided", async () => {
      const { app } = buildMockedTestApp();

      const response = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
      });

      expect(response.statusCode).toBe(402);
      const body = response.json();
      expect(body.error.code).toBe("payment_required");
      expect(body.payment_requirements).toBeDefined();
      expect(body.payment_requirements.quote_id).toBeDefined();
      expect(body.payment_requirements.amount).toBeDefined();
      expect(parseFloat(body.payment_requirements.amount)).toBeGreaterThan(0);
      expect(body.payment_requirements.asset).toBe("USDC");
      expect(body.payment_requirements.chain).toBe("base");
      expect(body.payment_requirements.scheme).toBe("exact");
      expect(body.payment_requirements.network).toBe("eip155:8453");

      const paymentRequiredHeader = response.headers["payment-required"];
      expect(paymentRequiredHeader).toBeDefined();
    });

    it("should complete full v2 flow: 402 -> pay -> success", async () => {
      const { app, services } = buildMockedTestApp();

      // Step 1: Get 402
      const challengeResponse = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
      });

      expect(challengeResponse.statusCode).toBe(402);

      // Step 2: Submit payment
      const paymentSignatureHeader = createPaymentSignatureHeader();

      const successResponse = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
        headers: { "payment-signature": paymentSignatureHeader },
      });

      expect(successResponse.statusCode).toBe(200);
      const body = successResponse.json();
      expect(body.object).toBe("chat.completion");
      expect(body.usage).toBeDefined();
      expect(body.usage_receipt.total_cost_usd).toBeDefined();

      // Trace and ledger populated by mock orchestrator
      const requestId = body.usage_receipt.request_id;
      const trace = await services.traceService.getTrace(requestId);
      expect(trace).toBeDefined();
      expect(trace?.status).toBe("completed");

      const ledgerEntry = await services.ledgerService.getByRequestId(requestId);
      expect(ledgerEntry).toBeDefined();
    });

    it("should support idempotency with idempotency-key header", async () => {
      const { app } = buildMockedTestApp();
      const idempotencyKey = "550e8400-e29b-41d4-a716-446655440000";

      // Get 402
      const challengeResponse = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
      });
      expect(challengeResponse.statusCode).toBe(402);

      const paymentSig = createPaymentSignatureHeader();

      // First request
      const r1 = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: { model: "openai/gpt-4o", messages: [{ role: "user", content: "Hello" }] },
        headers: { "payment-signature": paymentSig, "idempotency-key": idempotencyKey },
      });
      expect(r1.statusCode).toBe(200);
      const id1 = r1.json().id;

      // Second request — mock returns cached result (same requestId)
      const r2 = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: { model: "openai/gpt-4o", messages: [{ role: "user", content: "Hello" }] },
        headers: { "payment-signature": paymentSig, "idempotency-key": idempotencyKey },
      });
      expect(r2.statusCode).toBe(200);
      // Mock orchestrator returns same result for same idempotency key
      expect(r2.json().id).toBe(id1);
    });
  });

  describe("Payment Verification Failures", () => {
    it("should reject invalid payment signature format", async () => {
      const { app } = buildMockedTestApp({ rejectInvalidSignature: true });

      const challengeResponse = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: { model: "openai/gpt-4o", messages: [{ role: "user", content: "Hello" }] },
      });
      expect(challengeResponse.statusCode).toBe(402);

      const response = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: { model: "openai/gpt-4o", messages: [{ role: "user", content: "Hello" }] },
        headers: { "payment-signature": "invalid" },
      });

      expect(response.statusCode).toBe(402);
      expect(response.json().error.code).toBe("payment_verification_failed");
    });

    it("should reject payment with insufficient amount", async () => {
      const { app } = buildMockedTestApp({ verifyFailWithInsufficientPayment: true });

      const challengeResponse = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: { model: "openai/gpt-4o", messages: [{ role: "user", content: "Hello" }] },
      });
      expect(challengeResponse.statusCode).toBe(402);

      const paymentSig = createPaymentSignatureHeader();
      const response = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: { model: "openai/gpt-4o", messages: [{ role: "user", content: "Hello" }] },
        headers: { "payment-signature": paymentSig },
      });

      expect(response.statusCode).toBe(402);
      expect(response.json().error.code).toBe("insufficient_payment");
    });

    it("should reject replayed payment signature (double spend protection)", async () => {
      const { app } = buildMockedTestApp();

      const challengeResponse = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: { model: "openai/gpt-4o", messages: [{ role: "user", content: "Hello" }] },
      });
      expect(challengeResponse.statusCode).toBe(402);

      const paymentSig = createPaymentSignatureHeader();

      // First — succeeds
      const r1 = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: { model: "openai/gpt-4o", messages: [{ role: "user", content: "Hello" }] },
        headers: { "payment-signature": paymentSig },
      });
      expect(r1.statusCode).toBe(200);

      // Second with replayDetected
      const { app: app2 } = buildMockedTestApp({ replayDetected: true });
      const r2 = await app2.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: { model: "openai/gpt-4o", messages: [{ role: "user", content: "Hello" }] },
        headers: { "payment-signature": paymentSig },
      });

      expect(r2.statusCode).toBe(409);
      expect(r2.json().error.code).toBe("payment_replayed");
    });
  });

  describe("Routing Failures", () => {
    it("should handle routing failure gracefully", async () => {
      const { app } = buildMockedTestApp({ routerShouldFail: true });

      const challengeResponse = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: { model: "openai/gpt-4o", messages: [{ role: "user", content: "Hello" }] },
      });
      expect(challengeResponse.statusCode).toBe(402);

      const paymentSig = createPaymentSignatureHeader();
      const response = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: { model: "openai/gpt-4o", messages: [{ role: "user", content: "Hello" }] },
        headers: { "payment-signature": paymentSig },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe("Audit Endpoint", () => {
    it("should return complete audit record for successful request", async () => {
      const { app } = buildMockedTestApp();

      // Complete a request first
      const challengeResponse = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: { model: "openai/gpt-4o", messages: [{ role: "user", content: "Hello" }] },
      });
      expect(challengeResponse.statusCode).toBe(402);

      const successResponse = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: { model: "openai/gpt-4o", messages: [{ role: "user", content: "Hello" }] },
        headers: { "payment-signature": createPaymentSignatureHeader() },
      });
      expect(successResponse.statusCode).toBe(200);
      const requestId = successResponse.json().usage_receipt.request_id;

      const auditResponse = await app.inject({
        method: "GET",
        url: `/v1/audit/requests/${requestId}`,
      });

      expect(auditResponse.statusCode).toBe(200);
      const auditRecord = auditResponse.json();
      expect(auditRecord.request_id).toBe(requestId);
      expect(auditRecord.cost).toBeDefined();
      expect(auditRecord.cost.total_usd).toBeDefined();
    });

    it("should return 404 for non-existent request", async () => {
      const { app } = buildMockedTestApp();

      const response = await app.inject({
        method: "GET",
        url: "/v1/audit/requests/non-existent",
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("Ledger and Billing", () => {
    it("should create immutable ledger entry after successful request", async () => {
      const { app, services } = buildMockedTestApp();

      const challengeResponse = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: { model: "openai/gpt-4o", messages: [{ role: "user", content: "Hello" }] },
      });
      expect(challengeResponse.statusCode).toBe(402);

      const successResponse = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: { model: "openai/gpt-4o", messages: [{ role: "user", content: "Hello" }] },
        headers: { "payment-signature": createPaymentSignatureHeader() },
      });
      expect(successResponse.statusCode).toBe(200);
      const requestId = successResponse.json().usage_receipt.request_id;

      const entry = await services.ledgerService.getByRequestId(requestId);
      expect(entry).toBeDefined();
      expect(entry?.model_used).toBe("openai/gpt-4o");

      // Immutability check
      await expect(
        services.ledgerService.commit({
          request_id: requestId,
          quote_id: "test-q",
          payer_address: "0x0",
          model_used: "x",
          usage: entry!.usage,
          cost: entry!.cost,
        }),
      ).rejects.toThrow("Ledger entry already exists");
    });
  });

  describe("Model Catalog", () => {
    it("should return registered models", async () => {
      const { app } = buildMockedTestApp();
      const response = await app.inject({ method: "GET", url: "/v1/models" });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.length).toBeGreaterThan(0);
    });
  });

  describe("PAYMENT_CHAIN Configuration", () => {
    it.each([
      { chain: "base" },
      { chain: "arbitrum" },
      { chain: "optimism" },
      { chain: "polygon" },
      { chain: "ethereum-sepolia" },
      { chain: "base-sepolia" },
    ])("should generate v2 requirements with chain=$chain", async ({ chain }) => {
      const app = buildTestApp({ paymentChain: chain });
      const response = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: { model: "openai/gpt-4o", messages: [{ role: "user", content: "Hello" }] },
      });
      expect(response.statusCode).toBe(402);
      expect(response.json().payment_requirements.chain).toBe(chain);
    });

    it("x-402-preferred-chain header should override paymentChain config", async () => {
      const app = buildTestApp({ paymentChain: "base" });
      const response = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: { model: "openai/gpt-4o", messages: [{ role: "user", content: "Hello" }] },
        headers: { "x-402-preferred-chain": "arbitrum" },
      });
      expect(response.statusCode).toBe(402);
      expect(response.json().payment_requirements.chain).toBe("arbitrum");
    });
  });
});
