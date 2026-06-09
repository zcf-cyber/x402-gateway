import { describe, it, expect, vi } from "vitest";
import {
  createCostService,
  calculateCostWithDefaultFee,
  DEFAULT_PLATFORM_FEE_BPS,
} from "../../src/billing/cost.service.js";
import type { UsageRecord } from "../../src/billing/types.js";
import type { ModelPricing, RequestId } from "../../src/types.js";

describe("CostService", () => {
  const createTestPricing = (
    inputPrice: string,
    outputPrice: string,
  ): ModelPricing => ({
    input_usd_per_token: inputPrice,
    output_usd_per_token: outputPrice,
    effective_at: "2026-04-17T00:00:00Z",
  });

  const createTestUsage = (
    promptTokens: number,
    completionTokens: number,
  ): UsageRecord => ({
    request_id: "req-test-123" as RequestId,
    model_id: "openai/gpt-4o",
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  });

  describe("calculateCost - basic calculations", () => {
    it("should calculate cost for simple token usage", () => {
      const service = createCostService();
      const usage = createTestUsage(1000, 500);
      const pricing = createTestPricing("0.00001", "0.00002");
      const feeBps = 50; // 0.5%

      const result = service.calculateCost(usage, pricing, feeBps);

      // Expected: (1000 * 0.00001) + (500 * 0.00002) = 0.01 + 0.01 = 0.02
      expect(result.subtotal_usd).toBe("0.02");
      expect(result.platform_fee_usd).toBe("0.0001");
      expect(result.total_usd).toBe("0.0201");
    });

    it("should handle zero tokens", () => {
      const service = createCostService();
      const usage = createTestUsage(0, 0);
      const pricing = createTestPricing("0.00001", "0.00002");

      const result = service.calculateCost(usage, pricing, 50);

      expect(result.subtotal_usd).toBe("0");
      expect(result.platform_fee_usd).toBe("0");
      expect(result.total_usd).toBe("0");
    });

    it("should handle only prompt tokens", () => {
      const service = createCostService();
      const usage = createTestUsage(1000, 0);
      const pricing = createTestPricing("0.00001", "0.00002");

      const result = service.calculateCost(usage, pricing, 50);

      expect(result.subtotal_usd).toBe("0.01");
    });

    it("should handle only completion tokens", () => {
      const service = createCostService();
      const usage = createTestUsage(0, 1000);
      const pricing = createTestPricing("0.00001", "0.00002");

      const result = service.calculateCost(usage, pricing, 50);

      expect(result.subtotal_usd).toBe("0.02");
    });
  });

  describe("calculateCost - nano-dollar precision (9 decimals)", () => {
    it("should handle very small prices with 9-decimal precision", () => {
      const service = createCostService();
      const usage = createTestUsage(1, 0);
      // $0.0000001 = 100 nano-dollars
      const pricing = createTestPricing("0.0000001", "0.0000001");

      const result = service.calculateCost(usage, pricing, 50);

      // Expected: 0.0000001 USD = 100 nano-dollars (not truncated to 0)
      expect(result.subtotal_usd).toBe("0.0000001");
    });

    it("should handle prices at nano-dollar scale limit", () => {
      const service = createCostService();
      const usage = createTestUsage(100, 0);
      // $0.000000001 = 1 nano-dollar (minimum precision)
      const pricing = createTestPricing("0.000000001", "0.000000001");

      const result = service.calculateCost(usage, pricing, 50);

      // Expected: 100 * 0.000000001 = 0.0000001
      expect(result.subtotal_usd).toBe("0.0000001");
    });

    it("should not lose precision with micro-dollar prices", () => {
      const service = createCostService();
      const usage = createTestUsage(1000000, 0);
      // $0.000001 per token
      const pricing = createTestPricing("0.000001", "0.000001");

      const result = service.calculateCost(usage, pricing, 50);

      // Expected: 1000000 * 0.000001 = 1 USD
      expect(result.subtotal_usd).toBe("1");
    });

    it("should handle fractional nano-dollar calculations accurately", () => {
      const service = createCostService();
      const usage = createTestUsage(3, 0);
      // $0.000000001 = 1 nano-dollar per token
      const pricing = createTestPricing("0.000000001", "0.000000001");

      const result = service.calculateCost(usage, pricing, 50);

      // Expected: 3 * 0.000000001 = 0.000000003
      expect(result.subtotal_usd).toBe("0.000000003");
    });
  });

  describe("calculateCost - edge cases", () => {
    it("should handle large token counts", () => {
      const service = createCostService();
      const usage = createTestUsage(10000000, 5000000);
      const pricing = createTestPricing("0.00001", "0.00002");

      const result = service.calculateCost(usage, pricing, 50);

      // (10M * 0.00001) + (5M * 0.00002) = 100 + 100 = 200
      expect(result.subtotal_usd).toBe("200");
    });

    it("should handle zero platform fee", () => {
      const service = createCostService();
      const usage = createTestUsage(1000, 500);
      const pricing = createTestPricing("0.00001", "0.00002");

      const result = service.calculateCost(usage, pricing, 0);

      expect(result.platform_fee_usd).toBe("0");
      expect(result.total_usd).toBe(result.subtotal_usd);
    });

    it("should handle high platform fee", () => {
      const service = createCostService();
      const usage = createTestUsage(1000, 500);
      const pricing = createTestPricing("0.00001", "0.00002");
      const feeBps = 1000; // 10%

      const result = service.calculateCost(usage, pricing, feeBps);

      // subtotal = 0.02, fee = 0.02 * 0.10 = 0.002
      expect(result.platform_fee_usd).toBe("0.002");
      expect(result.total_usd).toBe("0.022");
    });
  });

  describe("calculateCost - error handling", () => {
    it("should throw error for negative token counts", () => {
      const service = createCostService();
      const usage: UsageRecord = {
        request_id: "req-test-123" as RequestId,
        model_id: "openai/gpt-4o",
        prompt_tokens: -1,
        completion_tokens: 0,
        total_tokens: -1,
      };
      const pricing = createTestPricing("0.00001", "0.00002");

      expect(() => service.calculateCost(usage, pricing, 50)).toThrow(
        "Token counts cannot be negative",
      );
    });

    it("should throw error for negative fee basis points", () => {
      const service = createCostService();
      const usage = createTestUsage(100, 50);
      const pricing = createTestPricing("0.00001", "0.00002");

      expect(() => service.calculateCost(usage, pricing, -1)).toThrow(
        "Fee basis points cannot be negative",
      );
    });

    it("should throw error for missing usage", () => {
      const service = createCostService();
      const pricing = createTestPricing("0.00001", "0.00002");

      expect(() =>
        service.calculateCost(undefined as unknown as UsageRecord, pricing, 50),
      ).toThrow("Usage record is required");
    });

    it("should throw error for missing pricing", () => {
      const service = createCostService();
      const usage = createTestUsage(100, 50);

      expect(() =>
        service.calculateCost(usage, undefined as unknown as ModelPricing, 50),
      ).toThrow("Pricing data is required");
    });
  });

  describe("calculateCost - logging", () => {
    it("should log calculation when logger is provided", () => {
      const logger = vi.fn();
      const service = createCostService({ log: logger });
      const usage = createTestUsage(100, 50);
      const pricing = createTestPricing("0.00001", "0.00002");

      service.calculateCost(usage, pricing, 50);

      expect(logger).toHaveBeenCalledWith(
        "Cost calculated",
        expect.any(Object),
      );
    });

    it("should not throw when logger is not provided", () => {
      const service = createCostService();
      const usage = createTestUsage(100, 50);
      const pricing = createTestPricing("0.00001", "0.00002");

      expect(() => service.calculateCost(usage, pricing, 50)).not.toThrow();
    });
  });

  describe("calculateCosts - batch processing", () => {
    it("should calculate costs for multiple usage records", () => {
      const service = createCostService();
      const usages: UsageRecord[] = [
        createTestUsage(1000, 500),
        createTestUsage(2000, 1000),
      ];
      const pricing = createTestPricing("0.00001", "0.00002");

      const results = service.calculateCosts(usages, pricing, 50);

      expect(results).toHaveLength(2);
      // First: (1000 * 0.00001) + (500 * 0.00002) = 0.02
      expect(results[0].subtotal_usd).toBe("0.02");
      // Second: (2000 * 0.00001) + (1000 * 0.00002) = 0.04
      expect(results[1].subtotal_usd).toBe("0.04");
    });

    it("should handle empty array", () => {
      const service = createCostService();
      const pricing = createTestPricing("0.00001", "0.00002");

      const results = service.calculateCosts([], pricing, 50);

      expect(results).toEqual([]);
    });

    it("should handle single record array", () => {
      const service = createCostService();
      const usages: UsageRecord[] = [createTestUsage(1000, 500)];
      const pricing = createTestPricing("0.00001", "0.00002");

      const results = service.calculateCosts(usages, pricing, 50);

      expect(results).toHaveLength(1);
      expect(results[0].subtotal_usd).toBe("0.02");
    });
  });

  describe("calculatePlatformFee", () => {
    it("should calculate platform fee correctly", () => {
      const service = createCostService();

      const fee = service.calculatePlatformFee("100", 50); // 0.5% of 100

      expect(fee).toBe("0.5");
    });

    it("should handle zero subtotal", () => {
      const service = createCostService();

      const fee = service.calculatePlatformFee("0", 50);

      expect(fee).toBe("0");
    });

    it("should handle zero fee rate", () => {
      const service = createCostService();

      const fee = service.calculatePlatformFee("100", 0);

      expect(fee).toBe("0");
    });

    it("should throw error for negative fee bps", () => {
      const service = createCostService();

      expect(() => service.calculatePlatformFee("100", -1)).toThrow(
        "Fee basis points cannot be negative",
      );
    });

    it("should handle very small subtotal", () => {
      const service = createCostService();

      const fee = service.calculatePlatformFee("0.01", 50);

      // 0.5% of 0.01 = 0.00005 (truncated to nano-dollar precision)
      expect(fee).toBe("0.00005");
    });
  });

  describe("validatePricing", () => {
    it("should return true for valid pricing", () => {
      const service = createCostService();
      const pricing = createTestPricing("0.00001", "0.00002");

      const isValid = service.validatePricing(pricing);

      expect(isValid).toBe(true);
    });

    it("should return true for zero prices", () => {
      const service = createCostService();
      const pricing = createTestPricing("0", "0");

      const isValid = service.validatePricing(pricing);

      expect(isValid).toBe(true);
    });

    it("should return false for negative input price", () => {
      const service = createCostService();
      const pricing = createTestPricing("-0.00001", "0.00002");

      const isValid = service.validatePricing(pricing);

      expect(isValid).toBe(false);
    });

    it("should return false for negative output price", () => {
      const service = createCostService();
      const pricing = createTestPricing("0.00001", "-0.00002");

      const isValid = service.validatePricing(pricing);

      expect(isValid).toBe(false);
    });

    it("should return false for null pricing", () => {
      const service = createCostService();

      const isValid = service.validatePricing(null as unknown as ModelPricing);

      expect(isValid).toBe(false);
    });

    it("should return false for undefined pricing", () => {
      const service = createCostService();

      const isValid = service.validatePricing(
        undefined as unknown as ModelPricing,
      );

      expect(isValid).toBe(false);
    });

    it("should return false for invalid price format", () => {
      const service = createCostService();
      const pricing = createTestPricing("invalid", "0.00002");

      const isValid = service.validatePricing(pricing);

      expect(isValid).toBe(false);
    });
  });

  describe("calculateCostWithDefaultFee - convenience function", () => {
    it("should use default platform fee", () => {
      const usage = createTestUsage(1000, 500);
      const pricing = createTestPricing("0.00001", "0.00002");

      const result = calculateCostWithDefaultFee(usage, pricing);

      expect(result.platform_fee_usd).toBe("0.0001"); // 0.5% of 0.02
    });

    it("should match manual calculation with DEFAULT_PLATFORM_FEE_BPS", () => {
      const usage = createTestUsage(1000, 500);
      const pricing = createTestPricing("0.00001", "0.00002");

      const manualResult = createCostService().calculateCost(
        usage,
        pricing,
        DEFAULT_PLATFORM_FEE_BPS,
      );
      const convenienceResult = calculateCostWithDefaultFee(usage, pricing);

      expect(convenienceResult).toEqual(manualResult);
    });
  });

  // ---------------------------------------------------------------------------
  // Three-tier pricing: cached token support (Issue #76 + #45)
  // ---------------------------------------------------------------------------

  describe("calculateCost - cached tokens (three-tier pricing)", () => {
    const createTestPricingWithCached = (
      inputPrice: string,
      outputPrice: string,
      cachedPrice?: string,
    ): ModelPricing => ({
      input_usd_per_token: inputPrice,
      output_usd_per_token: outputPrice,
      cached_usd_per_token: cachedPrice,
      effective_at: "2026-06-09T00:00:00Z",
    });

    const createTestUsageWithCached = (
      promptTokens: number,
      completionTokens: number,
      cachedTokens?: number,
    ): UsageRecord => ({
      request_id: "req-test-cached" as RequestId,
      model_id: "deepseek-v4-pro",
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      cached_tokens: cachedTokens,
    });

    it("should charge cached tokens at cached price", () => {
      const service = createCostService();
      // deepseek-v4-pro: cached=$0.000000003625, input=$0.000000435, output=$0.00000087
      const usage = createTestUsageWithCached(1000000, 500000, 200000);
      const pricing = createTestPricingWithCached(
        "0.000000435",
        "0.00000087",
        "0.000000003625",
      );

      const result = service.calculateCost(usage, pricing, 50);

      // non-cached prompt = 1000000 - 200000 = 800000
      // prompt cost = 800000 * 0.000000435 = 0.348
      // cached cost = 200000 * 0.000000003625 = 0.000725
      // completion cost = 500000 * 0.00000087 = 0.435
      // subtotal = 0.348 + 0.000725 + 0.435 = 0.783725
      expect(result.subtotal_usd).toBe("0.783725");
      expect(result.unit_price_cached).toBe("0.000000003625");
    });

    it("should handle zero cached tokens (all prompt charged at input price)", () => {
      const service = createCostService();
      const usage = createTestUsageWithCached(1000, 500, 0);
      const pricing = createTestPricingWithCached(
        "0.00001",
        "0.00003",
        "0.000005",
      );

      const result = service.calculateCost(usage, pricing, 50);

      // non-cached = 1000 - 0 = 1000
      // cached cost = 0 * 0.000005 = 0
      // subtotal = 1000*0.00001 + 500*0.00003 = 0.01 + 0.015 = 0.025
      expect(result.subtotal_usd).toBe("0.025");
      expect(result.unit_price_cached).toBe("0.000005");
    });

    it("should handle all prompt tokens cached", () => {
      const service = createCostService();
      const usage = createTestUsageWithCached(5000, 1000, 5000);
      const pricing = createTestPricingWithCached(
        "0.00001",
        "0.00003",
        "0.000005",
      );

      const result = service.calculateCost(usage, pricing, 50);

      // non-cached = 5000 - 5000 = 0
      // cached cost = 5000 * 0.000005 = 0.025
      // completion cost = 1000 * 0.00003 = 0.03
      // subtotal = 0 + 0.025 + 0.03 = 0.055
      expect(result.subtotal_usd).toBe("0.055");
    });

    it("should fall back to input price when no cached price defined", () => {
      const service = createCostService();
      // No cached_usd_per_token → falls back to input price
      const pricing = createTestPricingWithCached("0.00001", "0.00003");
      const usage = createTestUsageWithCached(1000, 500, 200);

      const result = service.calculateCost(usage, pricing, 50);

      // Cached tokens charged at input price (fallback)
      // non-cached = 1000 - 200 = 800
      // All prompt tokens (including cached) effectively at input price
      // 1000 * 0.00001 + 500 * 0.00003 = 0.025
      expect(result.subtotal_usd).toBe("0.025");
      expect(result.unit_price_cached).toBe("");
    });

    it("should handle nano-dollar scale cached price", () => {
      const service = createCostService();
      // deepseek-v4-flash: cached=$0.0000000028 per token
      const usage = createTestUsageWithCached(100000, 0, 100000);
      const pricing = createTestPricingWithCached(
        "0.00000014",
        "0.00000028",
        "0.0000000028",
      );

      const result = service.calculateCost(usage, pricing, 50);

      // All 100000 tokens are cached
      // 100000 * 0.0000000028 = 0.00028
      expect(result.subtotal_usd).toBe("0.00028");
    });

    it("should include cached info in log output", () => {
      const logger = vi.fn();
      const service = createCostService({ log: logger });
      const usage = createTestUsageWithCached(1000, 500, 200);
      const pricing = createTestPricingWithCached(
        "0.00001",
        "0.00003",
        "0.000005",
      );

      service.calculateCost(usage, pricing, 50);

      expect(logger).toHaveBeenCalledWith(
        "Cost calculated",
        expect.objectContaining({
          cached_tokens: 200,
          cached_price: "0.000005",
        }),
      );
    });
  });
});
