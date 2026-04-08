import type { ModelPricing } from '../types.js';
import type { UsageRecord, CostBreakdown } from './types.js';

export interface ICostService {
  /**
   * Deterministic cost calculation.
   * subtotal = (prompt_tokens * input_price) + (completion_tokens * output_price)
   * platform_fee = subtotal * feeBps / 10000
   * total = subtotal + platform_fee
   *
   * Must be reproducible: same inputs always produce same outputs.
   */
  calculateCost(usage: UsageRecord, pricing: ModelPricing, feeBps: number): CostBreakdown;
}

export function createCostService(): ICostService {
  return {
    calculateCost(
      _usage: UsageRecord,
      _pricing: ModelPricing,
      _feeBps: number,
    ): CostBreakdown {
      // TODO: Implement deterministic cost calculation
      // 1. Parse input/output unit prices from pricing
      // 2. Calculate subtotal from token counts
      // 3. Calculate platform fee from feeBps
      // 4. Return CostBreakdown with string-formatted USD values
      throw new Error('Not implemented');
    },
  };
}
