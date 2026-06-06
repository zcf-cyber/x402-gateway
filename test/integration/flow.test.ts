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

      // Verify PAYMENT-REQUIRED header is set
      const paymentRequiredHeader = response.headers["payment-required"];
      expect(paymentRequiredHeader).toBeDefined();
    });

    it("should complete full v2 flow: 402 -> pay -> success", async () => {
      const { app, services } = buildMockedTestApp();

      // Step 1: Get 402 with PAYMENT-REQUIRED header
      const challengeResponse = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
      });

      expect(challengeResponse.statusCode).toBe(402);

      // Step 2: Create payment signature header and submit
      const paymentSignatureHeader = createPaymentSignatureHeader();

      const successResponse = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
        headers: {
          "payment-signature": paymentSignatureHeader,
        },
      });

      expect(successResponse.statusCode).toBe(200);
      const body = successResponse.json();
      expect(body.id).toBeDefined();
      expect(body.object).toBe("chat.completion");
      expect(body.model).toBe("openai/gpt-4o");
      expect(body.choices).toHaveLength(1);
      expect(body.choices[0].message.content).toBe("Test response");
      expect(body.usage).toBeDefined();
      expect(body.usage.prompt_tokens).toBe(10);
      expect(body.usage.completion_tokens).toBe(20);
      expect(body.usage.total_tokens).toBe(30);
      expect(body.usage_receipt).toBeDefined();
      expect(body.usage_receipt.request_id).toBeDefined();
      expect(body.usage_receipt.model_used).toBe("openai/gpt-4o");
      expect(body.usage_receipt.total_cost_usd).toBeDefined();
      expect(body.usage_receipt.route_proof_hash).toBeDefined();
      expect(body.settlement).toBeDefined();
      expect(body.settlement.success).toBe(true);

      // Verify trace was created
      const requestId = body.usage_receipt.request_id;
      const trace = await services.traceService.getTrace(requestId);
      expect(trace).toBeDefined();
      expect(trace?.status).toBe("completed");

      // Verify ledger entry was created
      const ledgerEntry =
        await services.ledgerService.getByRequestId(requestId);
      expect(ledgerEntry).toBeDefined();
      expect(ledgerEntry?.model_used).toBe("openai/gpt-4o");
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

      const paymentSignatureHeader = createPaymentSignatureHeader();

      // First request
      const response1 = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
        headers: {
          "payment-signature": paymentSignatureHeader,
          "idempotency-key": idempotencyKey,
        },
      });

      expect(response1.statusCode).toBe(200);
      const body1 = response1.json();

      // Second request with same idempotency key
      const response2 = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
        headers: {
          "payment-signature": paymentSignatureHeader,
          "idempotency-key": idempotencyKey,
        },
      });

      expect(response2.statusCode).toBe(200);
      const body2 = response2.json();

      // Should return same result
      expect(body2.id).toBe(body1.id);
      expect(body2.usage_receipt.request_id).toBe(
        body1.usage_receipt.request_id,
      );
    });
  });

  describe("Payment Verification Failures", () => {
    it("should reject invalid payment signature format", async () => {
      const { app } = buildMockedTestApp();

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

      // Submit invalid payment signature
      const response = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
        headers: {
          "payment-signature": "!!!invalid-base64!!!",
        },
      });

      expect(response.statusCode).toBe(402);
      const body = response.json();
      expect(body.error.code).toBe("payment_verification_failed");
    });

    it("should reject payment with insufficient amount", async () => {
      const { app } = buildMockedTestApp({
        verifyFailWithInsufficientPayment: true,
      });

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

      const paymentSignatureHeader = createPaymentSignatureHeader();

      const response = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
        headers: {
          "payment-signature": paymentSignatureHeader,
        },
      });

      expect(response.statusCode).toBe(402);
      const body = response.json();
      expect(body.error.code).toBe("insufficient_payment");
    });

    it("should reject replayed payment signature (double spend protection)", async () => {
      const { app } = buildMockedTestApp();

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

      const paymentSignatureHeader = createPaymentSignatureHeader();

      // First request should succeed
      const response1 = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
        headers: {
          "payment-signature": paymentSignatureHeader,
        },
      });

      expect(response1.statusCode).toBe(200);

      // Second request with same payment signature should fail (replay protection)
      const response2 = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
        headers: {
          "payment-signature": paymentSignatureHeader,
        },
      });

      expect(response2.statusCode).toBe(409);
      const body2 = response2.json();
      expect(body2.error.code).toBe("payment_replayed");
    });
  });

  describe("Routing Failures", () => {
    it("should handle routing failure gracefully", async () => {
      const { app } = buildMockedTestApp({
        routerShouldFail: true,
      });

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

      const paymentSignatureHeader = createPaymentSignatureHeader();

      const response = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
        headers: {
          "payment-signature": paymentSignatureHeader,
        },
      });

      // Should fail with 500 internal error due to routing failure
      expect(response.statusCode).toBe(500);
    });
  });

  describe("Audit Endpoint", () => {
    it("should return complete audit record for successful request", async () => {
      const { app } = buildMockedTestApp();

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

      const paymentSignatureHeader = createPaymentSignatureHeader();

      // Submit request
      const successResponse = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
        headers: {
          "payment-signature": paymentSignatureHeader,
        },
      });

      expect(successResponse.statusCode).toBe(200);
      const successBody = successResponse.json();
      const requestId = successBody.usage_receipt.request_id;

      // Query audit endpoint
      const auditResponse = await app.inject({
        method: "GET",
        url: `/v1/audit/requests/${requestId}`,
      });

      expect(auditResponse.statusCode).toBe(200);
      const auditRecord = auditResponse.json();
      expect(auditRecord.request_id).toBe(requestId);
      expect(auditRecord.request_hash).toBeDefined();
      expect(auditRecord.route_decision).toBeDefined();
      expect(auditRecord.route_decision.selected_model).toBe("openai/gpt-4o");
      expect(auditRecord.cost).toBeDefined();
      expect(auditRecord.cost.total_usd).toBeDefined();
      expect(auditRecord.payment.verification_status).toBe("verified");
    });

    it("should return 404 for non-existent request", async () => {
      const { app } = buildMockedTestApp();

      const response = await app.inject({
        method: "GET",
        url: "/v1/audit/requests/non-existent-request",
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error.code).toBe("not_found");
    });
  });

  describe("Ledger and Billing", () => {
    it("should create immutable ledger entry after successful request", async () => {
      const { app, services } = buildMockedTestApp();

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

      const paymentSignatureHeader = createPaymentSignatureHeader();

      // Submit request
      const successResponse = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
        headers: {
          "payment-signature": paymentSignatureHeader,
        },
      });

      expect(successResponse.statusCode).toBe(200);
      const successBody = successResponse.json();
      const requestId = successBody.usage_receipt.request_id;

      // Verify ledger entry
      const ledgerEntry =
        await services.ledgerService.getByRequestId(requestId);
      expect(ledgerEntry).toBeDefined();
      expect(ledgerEntry?.request_id).toBe(requestId);
      expect(ledgerEntry?.model_used).toBe("openai/gpt-4o");
      expect(ledgerEntry?.usage.prompt_tokens).toBe(10);
      expect(ledgerEntry?.usage.completion_tokens).toBe(20);
      expect(ledgerEntry?.usage.total_tokens).toBe(30);
      expect(ledgerEntry?.cost.total_usd).toBeDefined();

      // Verify ledger is immutable (cannot create duplicate)
      await expect(
        services.ledgerService.commit({
          request_id: requestId,
          quote_id: "test-quote-123",
          payer_address:
            "0x1234567890123456789012345678901234567890",
          model_used: "openai/gpt-4o",
          usage: ledgerEntry!.usage,
          cost: ledgerEntry!.cost,
        }),
      ).rejects.toThrow("Ledger entry already exists");
    });
  });

  describe("Model Catalog", () => {
    it("should return registered models", async () => {
      const { app } = buildMockedTestApp();

      const response = await app.inject({
        method: "GET",
        url: "/v1/models",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty("data");
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data[0]).toHaveProperty("id");
      expect(body.data[0]).toHaveProperty("pricing");
    });
  });

  describe("PAYMENT_CHAIN Configuration", () => {
    it.each([
      { chain: "base", label: "Base Mainnet" },
      { chain: "arbitrum", label: "Arbitrum" },
      { chain: "optimism", label: "Optimism" },
      { chain: "polygon", label: "Polygon" },
      { chain: "ethereum-sepolia", label: "Ethereum Sepolia Testnet" },
      { chain: "base-sepolia", label: "Base Sepolia Testnet" },
    ])(
      "should generate v2 requirements with chain=$chain ($label)",
      async ({ chain }) => {
        const app = buildTestApp({ paymentChain: chain });

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
        expect(body.payment_requirements.chain).toBe(chain);
      },
    );

    it("x-402-preferred-chain header should override paymentChain config", async () => {
      const app = buildTestApp({ paymentChain: "base" });

      const response = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
        headers: {
          "x-402-preferred-chain": "arbitrum",
        },
      });

      expect(response.statusCode).toBe(402);
      const body = response.json();
      expect(body.payment_requirements.chain).toBe("arbitrum");
    });
  });
});
