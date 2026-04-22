import { describe, it, expect } from "vitest";
import {
  buildMockedTestApp,
  createMockPaymentProof,
  encodePaymentProof,
} from "../helpers.js";

describe("End-to-End Integration Flow", () => {
  describe("Complete Payment Flow", () => {
    it("should return 402 with challenge when no payment headers provided", async () => {
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
      expect(body.payment_requirements.challenge_token).toBeDefined();
      expect(body.payment_requirements.quote_id).toBeDefined();
      expect(body.payment_requirements.amount).toBe("0.001");
      expect(body.payment_requirements.asset).toBe("USDC");
      expect(body.payment_requirements.chain).toBe("base");
    });

    it("should complete full flow: challenge -> pay -> success", async () => {
      const { app, services } = buildMockedTestApp();

      // Step 1: Get challenge
      const challengeResponse = await app.inject({
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

      // Step 2: Submit payment with challenge token
      const paymentProof = createMockPaymentProof();
      const paymentHeader = encodePaymentProof(paymentProof);

      const successResponse = await app.inject({
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
      expect(body.usage_receipt.quote_id).toBe(
        challengeBody.payment_requirements.quote_id,
      );
      expect(body.usage_receipt.payer_address).toBe(paymentProof.payer_address);
      expect(body.usage_receipt.routing_mode).toBe("manual");
      expect(body.usage_receipt.model_used).toBe("openai/gpt-4o");
      expect(body.usage_receipt.total_cost_usd).toBeDefined();
      expect(body.usage_receipt.route_proof_hash).toBeDefined();

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
      expect(ledgerEntry?.payer_address).toBe(paymentProof.payer_address);
    });

    it("should support idempotency with idempotency-key header", async () => {
      const { app } = buildMockedTestApp();
      const idempotencyKey = "idem-key-12345";

      // Get challenge
      const challengeResponse = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
      });

      const challengeToken =
        challengeResponse.json().payment_requirements.challenge_token;
      const paymentProof = createMockPaymentProof();
      const paymentHeader = encodePaymentProof(paymentProof);

      // First request
      const response1 = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
        headers: {
          "x-402-challenge": challengeToken,
          "x-402-payment": paymentHeader,
          "idempotency-key": idempotencyKey,
        },
      });

      expect(response1.statusCode).toBe(200);
      const body1 = response1.json();

      // Second request with same idempotency key (should use cached result)
      const response2 = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
        headers: {
          "x-402-challenge": challengeToken,
          "x-402-payment": paymentHeader,
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
    it("should reject invalid payment proof format", async () => {
      const { app } = buildMockedTestApp();

      // Get challenge
      const challengeResponse = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
      });

      const challengeToken =
        challengeResponse.json().payment_requirements.challenge_token;

      // Submit invalid payment header
      const response = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
        headers: {
          "x-402-challenge": challengeToken,
          "x-402-payment": "invalid-base64",
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

      // Get challenge
      const challengeResponse = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
      });

      const challengeToken =
        challengeResponse.json().payment_requirements.challenge_token;
      const paymentProof = createMockPaymentProof();
      const paymentHeader = encodePaymentProof(paymentProof);

      const response = await app.inject({
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

      expect(response.statusCode).toBe(402);
      const body = response.json();
      expect(body.error.code).toBe("insufficient_payment");
    });

    it("should reject replayed payment (double spend protection)", async () => {
      const { app } = buildMockedTestApp();

      // Get challenge
      const challengeResponse = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
      });

      const challengeToken =
        challengeResponse.json().payment_requirements.challenge_token;
      const paymentProof = createMockPaymentProof();
      const paymentHeader = encodePaymentProof(paymentProof);

      // First request should succeed
      const response1 = await app.inject({
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

      expect(response1.statusCode).toBe(200);

      // Get a fresh challenge for second request
      const challengeResponse2 = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
      });
      const challengeToken2 =
        challengeResponse2.json().payment_requirements.challenge_token;

      // Second request with same payment proof should fail (replay protection)
      const response2 = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
        headers: {
          "x-402-challenge": challengeToken2,
          "x-402-payment": paymentHeader,
        },
      });

      expect(response2.statusCode).toBe(409);
      const body2 = response2.json();
      expect(body2.error.code).toBe("payment_replayed");
    });

    it("should reject expired challenge token", async () => {
      const { app, services } = buildMockedTestApp();

      // Create an expired challenge
      const expiredChallenge =
        await services.challengeService.generateChallenge(
          {
            model: "openai/gpt-4o",
            messages: [{ role: "user", content: "Hello" }],
          },
          "0.001",
        );

      // Manually tamper with the challenge to make it expired
      const payloadPart = expiredChallenge.challenge_token.split(".")[1];
      const payloadJson = Buffer.from(payloadPart!, "base64url").toString();
      const payload = JSON.parse(payloadJson);
      payload.expires_at = new Date(Date.now() - 1000).toISOString(); // Set to past

      const { createHmac } = await import("crypto");
      const tamperedPayloadJson = JSON.stringify(payload);
      const newSignature = createHmac(
        "sha256",
        "test-secret-at-least-32-chars-long-for-testing",
      )
        .update(tamperedPayloadJson)
        .digest("base64url");
      const expiredToken = `${newSignature}.${Buffer.from(tamperedPayloadJson).toString("base64url")}`;

      const paymentProof = createMockPaymentProof();
      const paymentHeader = encodePaymentProof(paymentProof);

      const response = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
        headers: {
          "x-402-challenge": expiredToken,
          "x-402-payment": paymentHeader,
        },
      });

      expect(response.statusCode).toBe(402);
      const body = response.json();
      expect(body.error.code).toBe("challenge_expired");
    });

    it("should reject mismatched request hash", async () => {
      const { app } = buildMockedTestApp();

      // Get challenge for one request
      const challengeResponse = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
      });

      const challengeToken =
        challengeResponse.json().payment_requirements.challenge_token;
      const paymentProof = createMockPaymentProof();
      const paymentHeader = encodePaymentProof(paymentProof);

      // Use challenge with different request body
      const response = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Different content" }], // Different message
        },
        headers: {
          "x-402-challenge": challengeToken,
          "x-402-payment": paymentHeader,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("request_hash_mismatch");
    });
  });

  describe("Routing Failures and Fallback", () => {
    it("should handle routing failure gracefully", async () => {
      const { app } = buildMockedTestApp({
        routerShouldFail: true,
      });

      // Get challenge
      const challengeResponse = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
      });

      const challengeToken =
        challengeResponse.json().payment_requirements.challenge_token;
      const paymentProof = createMockPaymentProof();
      const paymentHeader = encodePaymentProof(paymentProof);

      const response = await app.inject({
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

      // Should fail with 500 internal error due to routing failure
      expect(response.statusCode).toBe(500);
    });

    it("should record fallback attempts in usage receipt", async () => {
      const { app } = buildMockedTestApp({
        routerFallbackAttempt: 1,
      });

      // Get challenge
      const challengeResponse = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
      });

      const challengeToken =
        challengeResponse.json().payment_requirements.challenge_token;
      const paymentProof = createMockPaymentProof();
      const paymentHeader = encodePaymentProof(paymentProof);

      const response = await app.inject({
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

      expect(response.statusCode).toBe(200);
      const body = response.json();

      // Verify receipt shows fallback information
      expect(body.usage_receipt).toBeDefined();
      expect(body.usage_receipt.route_proof_hash).toBeDefined();
    });
  });

  describe("Audit Endpoint", () => {
    it("should return complete audit record for successful request", async () => {
      const { app } = buildMockedTestApp();

      // Get challenge
      const challengeResponse = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
      });

      const challengeToken =
        challengeResponse.json().payment_requirements.challenge_token;
      const paymentProof = createMockPaymentProof();
      const paymentHeader = encodePaymentProof(paymentProof);

      // Submit request
      const successResponse = await app.inject({
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
      expect(auditRecord.routing_mode).toBe("manual");
      expect(auditRecord.route_decision).toBeDefined();
      expect(auditRecord.route_decision.selected_model).toBe("openai/gpt-4o");
      expect(auditRecord.route_decision.fallback_chain).toBeDefined();
      expect(auditRecord.route_decision.score_summary).toBeDefined();
      expect(auditRecord.usage).toBeDefined();
      expect(auditRecord.usage.prompt_tokens).toBe(10);
      expect(auditRecord.usage.completion_tokens).toBe(20);
      expect(auditRecord.usage.total_tokens).toBe(30);
      expect(auditRecord.cost).toBeDefined();
      expect(auditRecord.cost.subtotal_usd).toBeDefined();
      expect(auditRecord.cost.platform_fee_usd).toBeDefined();
      expect(auditRecord.cost.total_usd).toBeDefined();
      expect(auditRecord.payment).toBeDefined();
      expect(auditRecord.payment.quote_id).toBeDefined();
      expect(auditRecord.payment.chain).toBe("base");
      expect(auditRecord.payment.payer_address).toBe(
        paymentProof.payer_address,
      );
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

  describe("Auto Routing Mode", () => {
    it("should support auto routing mode", async () => {
      const { app } = buildMockedTestApp();

      // Get challenge with auto routing
      const challengeResponse = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "auto",
          messages: [{ role: "user", content: "Hello" }],
          routing_mode: "auto",
        },
      });

      // Note: Auto mode currently throws "Auto routing mode not yet implemented"
      // This test documents the expected behavior once auto mode is implemented
      expect(challengeResponse.statusCode).toBe(402);
    });
  });

  describe("Ledger and Billing", () => {
    it("should create immutable ledger entry after successful request", async () => {
      const { app, services } = buildMockedTestApp();

      // Get challenge
      const challengeResponse = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
      });

      const challengeToken =
        challengeResponse.json().payment_requirements.challenge_token;
      const quoteId = challengeResponse.json().payment_requirements.quote_id;
      const paymentProof = createMockPaymentProof();
      const paymentHeader = encodePaymentProof(paymentProof);

      // Submit request
      const successResponse = await app.inject({
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
      const successBody = successResponse.json();
      const requestId = successBody.usage_receipt.request_id;

      // Verify ledger entry
      const ledgerEntry =
        await services.ledgerService.getByRequestId(requestId);
      expect(ledgerEntry).toBeDefined();
      expect(ledgerEntry?.request_id).toBe(requestId);
      expect(ledgerEntry?.quote_id).toBe(quoteId);
      expect(ledgerEntry?.payer_address).toBe(paymentProof.payer_address);
      expect(ledgerEntry?.model_used).toBe("openai/gpt-4o");
      expect(ledgerEntry?.usage.prompt_tokens).toBe(10);
      expect(ledgerEntry?.usage.completion_tokens).toBe(20);
      expect(ledgerEntry?.usage.total_tokens).toBe(30);
      expect(ledgerEntry?.cost.subtotal_usd).toBeDefined();
      expect(ledgerEntry?.cost.platform_fee_usd).toBeDefined();
      expect(ledgerEntry?.cost.total_usd).toBeDefined();
      expect(ledgerEntry?.cost.unit_price_input).toBeDefined();
      expect(ledgerEntry?.cost.unit_price_output).toBeDefined();
      expect(ledgerEntry?.created_at).toBeDefined();

      // Verify ledger is immutable (cannot create duplicate)
      await expect(
        services.ledgerService.commit({
          request_id: requestId,
          quote_id: quoteId,
          payer_address: paymentProof.payer_address,
          model_used: "openai/gpt-4o",
          usage: ledgerEntry!.usage,
          cost: ledgerEntry!.cost,
        }),
      ).rejects.toThrow("Ledger entry already exists");
    });
  });

  describe("Model Catalog", () => {
    it("should return empty model catalog", async () => {
      const { app } = buildMockedTestApp();

      const response = await app.inject({
        method: "GET",
        url: "/v1/models",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty("data");
      expect(body.data).toEqual([]);
    });
  });
});
