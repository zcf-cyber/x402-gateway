import { describe, it, expect } from "vitest";
import { createCostService } from "../../src/billing/cost.service.js";
import { createPaymentService, COST_SAFETY_MARGIN } from "../../src/billing/payment.service.js";
import type { UsageRecord } from "../../src/billing/types.js";
import type { ModelPricing, ChatCompletionRequest } from "../../src/types.js";

/**
 * Real-World Three-Tier Pricing Scenarios
 *
 * Verifies the gateway charges real money based on actual token usage + provider
 * pricing, not demo hardcoded amounts. Validates:
 *   1. Three-tier formula: non_cached*input + cached*cached + completion*output
 *   2. upto safety margin: 1.2x raw estimate
 *   3. Different models → different challenge amounts
 *   4. platformFeeBps configurability
 *
 * Related: #45 (pricing fix), #76 (cached_tokens)
 */

describe("Real-World Three-Tier Pricing Scenarios", () => {
  const costService = createCostService();
  const paymentService = createPaymentService({ costService });

  // [CONFIRMED] DeepSeek V4 Pro: $0.435/1M input, $0.87/1M output, $0.003625/1M cache
  const DEEPSEEK_V4_PRO: ModelPricing = {
    input_usd_per_token: "0.000000435",
    output_usd_per_token: "0.00000087",
    cached_usd_per_token: "0.000000003625",
    effective_at: "2026-06-09T00:00:00Z",
  };

  // [CONFIRMED] Xiaomi MiMo-V2.5: $0.14/1M input, $0.28/1M output, $0.0028/1M cache
  const XIAOMI_MIMO_V25: ModelPricing = {
    input_usd_per_token: "0.00000014",
    output_usd_per_token: "0.00000028",
    cached_usd_per_token: "0.0000000028",
    effective_at: "2026-06-09T00:00:00Z",
  };

  const FEE_BPS = 50; // 0.5%

  function usage(prompt: number, completion: number, cached?: number): UsageRecord {
    return {
      request_id: "req-test" as any,
      model_id: "test-model",
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: prompt + completion,
      cached_tokens: cached,
    };
  }

  // ==========================================================================
  // Scenario 1: DeepSeek V4 Pro — long conversation, 30% cache hit
  // ==========================================================================
  it("DeepSeek V4 Pro: 100K prompt (30% cache) + 50K completion", () => {
    const cost = costService.calculateCost(
      usage(100000, 50000, 30000),
      DEEPSEEK_V4_PRO,
      FEE_BPS,
    );

    // non_cached=70000, cached=30000, completion=50000
    // prompt = 70000 * 0.000000435 = 0.03045
    // cache  = 30000 * 0.000000003625 = 0.00010875
    // completion = 50000 * 0.00000087 = 0.0435
    // subtotal = 0.07405875, fee = 0.00037029375, total = 0.07442904375
    expect(cost.subtotal_usd).toBe("0.07405875");
    expect(cost.platform_fee_usd).toBe("0.00037029375");
    expect(cost.total_usd).toBe("0.07442904375");
    expect(cost.unit_price_cached).toBe("0.000000003625");
  });

  // ==========================================================================
  // Scenario 2: Cold start — 0% cache, full input pricing
  // ==========================================================================
  it("DeepSeek V4 Pro: 10K prompt (0% cache) + 5K completion — cold start", () => {
    const cost = costService.calculateCost(
      usage(10000, 5000, undefined),
      DEEPSEEK_V4_PRO,
      FEE_BPS,
    );

    // prompt = 10000 * 0.000000435 = 0.00435
    // completion = 5000 * 0.00000087 = 0.00435
    // subtotal = 0.0087, fee = 0.0000435, total = 0.0087435
    expect(cost.subtotal_usd).toBe("0.0087");
    expect(cost.total_usd).toBe("0.0087435");
    expect(cost.unit_price_cached).toBe("0.000000003625"); // populated from pricing
  });

  // ==========================================================================
  // Scenario 3: Xiaomi MiMo-V2.5 — high cache hit (multi-turn chat)
  // ==========================================================================
  it("Xiaomi MiMo-V2.5: 50K prompt (80% cache) + 10K completion", () => {
    const cost = costService.calculateCost(
      usage(50000, 10000, 40000),
      XIAOMI_MIMO_V25,
      FEE_BPS,
    );

    // non_cached=10000, cached=40000, completion=10000
    // prompt = 10000 * 0.00000014 = 0.0014
    // cache  = 40000 * 0.0000000028 = 0.000112
    // completion = 10000 * 0.00000028 = 0.0028
    // subtotal = 0.004312, fee = 0.00002156, total = 0.00433356
    expect(cost.subtotal_usd).toBe("0.004312");
    expect(cost.total_usd).toBe("0.00433356");
  });

  // ==========================================================================
  // Scenario 4: upto safety margin — 1.2x ceiling
  // ==========================================================================
  it("upto maxAmount: 1.2x safety margin produces valid ceiling", () => {
    const request: ChatCompletionRequest = {
      model: "deepseek-v4-pro",
      messages: [
        { role: "system", content: "You are a coding assistant." },
        { role: "user", content: "Write a function to sort a list." },
      ],
    };

    const maxAmount = paymentService.estimateMaxAmount(request, DEEPSEEK_V4_PRO, FEE_BPS);
    const rawTokens = paymentService.estimateTokens(request);
    const rawCost = paymentService.estimateTotalCost(rawTokens, DEEPSEEK_V4_PRO, FEE_BPS);

    // Must produce a positive real amount (not demo "0.001")
    expect(parseFloat(maxAmount)).toBeGreaterThan(0);
    expect(maxAmount).not.toBe("0.001");

    // Ratio must be exactly COST_SAFETY_MARGIN (1.2)
    const ratio = parseFloat(maxAmount) / parseFloat(rawCost);
    expect(ratio).toBeCloseTo(COST_SAFETY_MARGIN, 5);
  });

  // ==========================================================================
  // Scenario 5: Different models → different challenge amounts
  // ==========================================================================
  it("different models produce different challenge amounts", () => {
    const baseReq: ChatCompletionRequest = {
      model: "test",
      messages: [{ role: "user", content: "Hello, world! This is a test." }],
    };

    const dsAmount = paymentService.estimateMaxAmount(
      { ...baseReq, model: "deepseek-v4-pro" },
      DEEPSEEK_V4_PRO,
      FEE_BPS,
    );
    const xmAmount = paymentService.estimateMaxAmount(
      { ...baseReq, model: "xiaomi/mimo-v2.5" },
      XIAOMI_MIMO_V25,
      FEE_BPS,
    );

    // Different models → different amounts
    expect(dsAmount).not.toBe(xmAmount);
    // DeepSeek V4 Pro is more expensive than MiMo-V2.5
    expect(parseFloat(dsAmount)).toBeGreaterThan(parseFloat(xmAmount));
  });

  // ==========================================================================
  // Scenario 6: platformFeeBps changes total but not base cost
  // ==========================================================================
  it("platformFeeBps affects total cost, not subtotal", () => {
    const cost50 = costService.calculateCost(usage(10000, 5000), DEEPSEEK_V4_PRO, 50);
    const cost500 = costService.calculateCost(usage(10000, 5000), DEEPSEEK_V4_PRO, 500);

    // Same subtotal (platform fee doesn't change base cost)
    expect(cost50.subtotal_usd).toBe(cost500.subtotal_usd);
    // Higher feeBps → higher total
    expect(parseFloat(cost500.total_usd)).toBeGreaterThan(parseFloat(cost50.total_usd));
  });
});
