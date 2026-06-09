import { describe, it, expect } from "vitest";
import { createPaymentService, COST_SAFETY_MARGIN } from "../../src/billing/payment.service.js";
import { createCostService } from "../../src/billing/cost.service.js";
import { InsufficientPaymentError } from "../../src/errors.js";
import type { ChatCompletionRequest, ModelPricing } from "../../src/types.js";

const TEST_PRICING: ModelPricing = {
  input_usd_per_token: "0.00001",
  output_usd_per_token: "0.00003",
  effective_at: new Date().toISOString(),
};

const TEST_FEE_BPS = 50;

function makeService() {
  const costService = createCostService();
  return createPaymentService({ costService });
}

function makeRequest(
  content: string,
  model = "openai/gpt-4o",
): ChatCompletionRequest {
  return {
    model,
    messages: [{ role: "user" as const, content }],
  };
}

describe("PaymentService", () => {
  describe("estimateTokens", () => {
    it("should estimate prompt tokens from message content length", () => {
      const service = makeService();
      const request = makeRequest("Hello, how are you?");
      const tokens = service.estimateTokens(request);

      // "Hello, how are you?" = 19 chars → ceil(19/4) = 5
      expect(tokens.estimated_prompt_tokens).toBeGreaterThan(0);
      // 4096 default completion tokens
      expect(tokens.estimated_completion_tokens).toBe(4096);
      expect(tokens.estimated_total_tokens).toBe(
        tokens.estimated_prompt_tokens + tokens.estimated_completion_tokens,
      );
    });

    it("should estimate 1 prompt token for very short messages", () => {
      const service = makeService();
      const request = makeRequest("Hi");
      const tokens = service.estimateTokens(request);

      // "Hi" = 2 chars → ceil(2/4) = 1
      expect(tokens.estimated_prompt_tokens).toBe(1);
    });

    it("should handle multi-message requests", () => {
      const service = makeService();
      const request: ChatCompletionRequest = {
        model: "openai/gpt-4o",
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Tell me about the weather." },
          { role: "assistant", content: "The weather today is sunny." },
          { role: "user", content: "What about tomorrow?" },
        ],
      };
      const tokens = service.estimateTokens(request);

      // Sum of all content lengths / 4
      expect(tokens.estimated_prompt_tokens).toBeGreaterThan(0);
      expect(tokens.estimated_completion_tokens).toBe(4096);
    });

    it("should handle empty content messages", () => {
      const service = makeService();
      const request: ChatCompletionRequest = {
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "" }],
      };
      const tokens = service.estimateTokens(request);

      expect(tokens.estimated_prompt_tokens).toBe(0);
    });
  });

  describe("estimateTotalCost", () => {
    it("should calculate estimated total cost based on model pricing", () => {
      const service = makeService();
      const tokens = {
        estimated_prompt_tokens: 1000,
        estimated_completion_tokens: 500,
        estimated_total_tokens: 1500,
      };
      const total = service.estimateTotalCost(tokens, TEST_PRICING, TEST_FEE_BPS);

      // prompt: 1000 * 0.00001 = 0.01
      // completion: 500 * 0.00003 = 0.015
      // subtotal = 0.025
      // fee = 0.025 * 50 / 10000 = 0.000125
      // total = 0.025125
      expect(total).toBeDefined();
      expect(parseFloat(total)).toBeGreaterThan(0);
    });

    it("should return total greater than subtotal due to fee", () => {
      const service = makeService();
      const tokens = {
        estimated_prompt_tokens: 100,
        estimated_completion_tokens: 100,
        estimated_total_tokens: 200,
      };

      const total = service.estimateTotalCost(tokens, TEST_PRICING, TEST_FEE_BPS);
      const totalWithFee = service.estimateTotalCost(
        tokens,
        TEST_PRICING,
        500, // 5% fee
      );

      // Higher feeBps should produce higher total
      expect(parseFloat(totalWithFee)).toBeGreaterThan(parseFloat(total));
    });

    it("should return deterministic results for same inputs", () => {
      const service = makeService();
      const tokens = {
        estimated_prompt_tokens: 1000,
        estimated_completion_tokens: 500,
        estimated_total_tokens: 1500,
      };

      const result1 = service.estimateTotalCost(
        tokens,
        TEST_PRICING,
        TEST_FEE_BPS,
      );
      const result2 = service.estimateTotalCost(
        tokens,
        TEST_PRICING,
        TEST_FEE_BPS,
      );

      expect(result1).toBe(result2);
    });
  });

  describe("validatePayment", () => {
    it("should not throw when actual cost equals authorized amount", () => {
      const service = makeService();
      expect(() =>
        service.validatePayment("0.001", "0.001"),
      ).not.toThrow();
    });

    it("should not throw when actual cost is less than authorized amount", () => {
      const service = makeService();
      expect(() =>
        service.validatePayment("0.0005", "0.001"),
      ).not.toThrow();
    });

    it("should throw InsufficientPaymentError when actual exceeds authorized", () => {
      const service = makeService();
      expect(() =>
        service.validatePayment("0.002", "0.001"),
      ).toThrow(InsufficientPaymentError);
    });

    it("should include actual and required amounts in error message", () => {
      const service = makeService();
      try {
        service.validatePayment("0.002", "0.001");
      } catch (error) {
        expect(error).toBeInstanceOf(InsufficientPaymentError);
        expect((error as InsufficientPaymentError).message).toContain(
          "0.002",
        );
        expect((error as InsufficientPaymentError).message).toContain(
          "0.001",
        );
      }
    });

    it("should throw on invalid numeric inputs", () => {
      const service = makeService();
      expect(() =>
        service.validatePayment("not-a-number", "0.001"),
      ).toThrow("Invalid numeric values");
      expect(() =>
        service.validatePayment("0.001", "not-a-number"),
      ).toThrow("Invalid numeric values");
    });

    it("should handle zero authorized amount", () => {
      const service = makeService();
      // Actual > 0 authorized → should throw
      expect(() =>
        service.validatePayment("0.001", "0"),
      ).toThrow(InsufficientPaymentError);
    });
  });

  // ---------------------------------------------------------------------------
  // max_tokens & safety margin (Issue #45 upto scheme)
  // ---------------------------------------------------------------------------

  describe("estimateTokens - max_tokens support", () => {
    it("should use request.max_tokens when provided", () => {
      const service = makeService();
      const request = makeRequest("Hello, world!");
      const tokens = service.estimateTokens(request);

      // Default: 4096
      expect(tokens.estimated_completion_tokens).toBe(4096);

      // With max_tokens specified
      const requestWithMax: ChatCompletionRequest = {
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 1024,
      };
      const tokensWithMax = service.estimateTokens(requestWithMax);
      expect(tokensWithMax.estimated_completion_tokens).toBe(1024);
    });
  });

  describe("estimateMaxAmount - safety margin", () => {
    it("should return amount ≥ raw estimate", () => {
      const service = makeService();
      const request: ChatCompletionRequest = {
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Hello, world!" }],
        max_tokens: 100,
      };

      const maxAmount = service.estimateMaxAmount(
        request,
        TEST_PRICING,
        TEST_FEE_BPS,
      );
      const rawCost = service.estimateTotalCost(
        service.estimateTokens(request),
        TEST_PRICING,
        TEST_FEE_BPS,
      );

      expect(parseFloat(maxAmount)).toBeGreaterThanOrEqual(
        parseFloat(rawCost),
      );
    });

    it("should apply 1.2x safety margin for typical requests", () => {
      const service = makeService();
      const request: ChatCompletionRequest = {
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Hi" }],
      };

      // Very short message: prompt ≈ 1 token, completion = 4096
      // raw cost ≈ 4097 tokens * prices ≈ small number
      // maxAmount should be ~1.2x rawCost
      const tokens = service.estimateTokens(request);
      const rawCost = service.estimateTotalCost(
        tokens,
        TEST_PRICING,
        TEST_FEE_BPS,
      );
      const maxAmount = service.estimateMaxAmount(
        request,
        TEST_PRICING,
        TEST_FEE_BPS,
      );

      const ratio = parseFloat(maxAmount) / parseFloat(rawCost);
      expect(ratio).toBeCloseTo(COST_SAFETY_MARGIN, 1);
    });

    it("should be deterministic", () => {
      const service = makeService();
      const request: ChatCompletionRequest = {
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Test message" }],
      };

      const r1 = service.estimateMaxAmount(
        request,
        TEST_PRICING,
        TEST_FEE_BPS,
      );
      const r2 = service.estimateMaxAmount(
        request,
        TEST_PRICING,
        TEST_FEE_BPS,
      );

      expect(r1).toBe(r2);
    });

    it("should return '0' not empty string for zero-cost requests", () => {
      const service = makeService();
      // Zero input tokens → zero cost → should return "0", not ""
      const request: ChatCompletionRequest = {
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "" }],
        max_tokens: 0,
      };

      const amount = service.estimateMaxAmount(
        request,
        TEST_PRICING,
        TEST_FEE_BPS,
      );

      expect(amount).toBe("0");
      expect(amount).not.toBe("");
    });

    it("should return a valid number string for minimal request", () => {
      const service = makeService();
      const request: ChatCompletionRequest = {
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 1,
      };

      const amount = service.estimateMaxAmount(
        request,
        TEST_PRICING,
        TEST_FEE_BPS,
      );

      // Must be a parseable, non-negative number string
      expect(parseFloat(amount)).toBeGreaterThanOrEqual(0);
      expect(amount).not.toBe("");
      expect(amount).not.toBe("NaN");
    });
  });
});
