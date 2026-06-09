import type { ModelPricing } from "../types.js";
import type { UsageRecord, CostBreakdown } from "./types.js";

/**
 * Dependencies for CostService
 */
export interface CostServiceDeps {
  /** Optional logger for cost calculation events */
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Interface for cost calculation service.
 * Responsible for deterministic cost calculation based on token usage and pricing.
 *
 * Design Principles:
 * 1. Deterministic - same inputs always produce same outputs
 * 2. Transparent - all calculations are explicit and auditable
 * 3. Precision-safe - uses string arithmetic to avoid floating-point errors
 * 4. Immutable - no state mutation, pure functions
 */
export interface ICostService {
  /**
   * Deterministic cost calculation.
   *
   * Formula:
   * - non_cached_prompt = prompt_tokens - cached_tokens
   * - subtotal = (non_cached_prompt * input_price)
   *            + (cached_tokens * cached_price)
   *            + (completion_tokens * output_price)
   * - platform_fee = subtotal * feeBps / 10000
   * - total = subtotal + platform_fee
   *
   * All amounts are returned as string-encoded decimals to avoid floating-point
   * precision issues. USD currency is implied.
   *
   * @param usage - Token usage record with prompt, completion, and optional cached counts
   * @param pricing - Model pricing with input/output/cached unit prices (USD per token)
   * @param feeBps - Platform fee in basis points (e.g., 50 = 0.5%)
   * @returns CostBreakdown with detailed cost components
   * @throws Error if pricing data is invalid or token counts are negative
   *
   * @example
   * ```typescript
   * const usage = { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, cached_tokens: 200 };
   * const pricing = { input_usd_per_token: "0.00001", output_usd_per_token: "0.00002", cached_usd_per_token: "0.000005" };
   * const breakdown = costService.calculateCost(usage, pricing, 50);
   * // breakdown.subtotal_usd = (800*0.00001) + (200*0.000005) + (500*0.00002) = 0.008 + 0.001 + 0.01 = 0.019
   * // breakdown.platform_fee_usd = 0.019 * 50/10000 = 0.000095
   * // breakdown.total_usd = 0.019095
   * ```
   */
  calculateCost(
    usage: UsageRecord,
    pricing: ModelPricing,
    feeBps: number,
  ): CostBreakdown;

  /**
   * Batch calculate costs for multiple usage records.
   * Useful for generating reports and aggregating billing data.
   *
   * @param usages - Array of usage records
   * @param pricing - Model pricing (same pricing applied to all)
   * @param feeBps - Platform fee in basis points
   * @returns Array of cost breakdowns in same order as input
   */
  calculateCosts(
    usages: UsageRecord[],
    pricing: ModelPricing,
    feeBps: number,
  ): CostBreakdown[];

  /**
   * Calculate platform fee from subtotal.
   *
   * @param subtotalUsd - Subtotal amount in USD (as string)
   * @param feeBps - Platform fee in basis points
   * @returns Platform fee amount in USD (as string)
   */
  calculatePlatformFee(subtotalUsd: string, feeBps: number): string;

  /**
   * Validate pricing data.
   * Ensures prices are non-negative and properly formatted.
   *
   * @param pricing - Model pricing to validate
   * @returns true if valid, false otherwise
   */
  validatePricing(pricing: ModelPricing): boolean;
}

/**
 * Parse a decimal string to a BigInt representing the value in pico-dollars (1 USD = 1_000_000_000_000).
 * This provides 12 decimal places of precision for accurate token pricing,
 * including cached token prices at the $0.00000000xxxx scale.
 *
 * Design decision: Use 12-digit precision to handle very small cached token prices
 * (down to $0.000000000001). Example: $0.0000000028 per token = 2800 pico-dollars.
 *
 * @param decimalStr - Decimal string (e.g., "0.000000003625")
 * @returns BigInt representing the value in pico-dollars
 * @throws Error if the string is not a valid decimal
 */
function parseToPicoDollars(decimalStr: string): bigint {
  const trimmed = decimalStr.trim();

  if (!/^\d*\.?\d*$/.test(trimmed)) {
    throw new Error(`Invalid decimal string: ${decimalStr}`);
  }

  const [wholePart = "0", decimalPart = ""] = trimmed.split(".");
  const paddedDecimal = (decimalPart + "000000000000").slice(0, 12);

  const wholeValue = BigInt(wholePart) * BigInt(1_000_000_000_000);
  const decimalValue = BigInt(paddedDecimal);

  return wholeValue + decimalValue;
}

/**
 * Convert pico-dollars to a decimal string.
 *
 * @param picoDollars - Value in pico-dollars
 * @returns Decimal string (e.g., "0.000000003625")
 */
function formatFromPicoDollars(picoDollars: bigint): string {
  const isNegative = picoDollars < 0;
  const absValue = isNegative ? -picoDollars : picoDollars;

  const wholePart = absValue / BigInt(1_000_000_000_000);
  const decimalPart = absValue % BigInt(1_000_000_000_000);

  const decimalStr = decimalPart.toString().padStart(12, "0");
  // Trim trailing zeros but keep at least one decimal place if there's a decimal part
  const trimmedDecimal = decimalStr.replace(/0+$/, "");

  if (trimmedDecimal.length === 0) {
    return isNegative ? `-${wholePart.toString()}` : wholePart.toString();
  }

  const result = `${wholePart.toString()}.${trimmedDecimal}`;
  return isNegative ? `-${result}` : result;
}

/**
 * Create a CostService instance.
 *
 * Implementation uses BigInt arithmetic with pico-dollar precision (12 decimal places)
 * to ensure deterministic calculations without floating-point errors.
 *
 * @param deps - Optional service dependencies
 * @returns ICostService implementation
 */
export function createCostService(deps?: CostServiceDeps): ICostService {
  const { log } = deps || {};

  function calculateCost(
    usage: UsageRecord,
    pricing: ModelPricing,
    feeBps: number,
  ): CostBreakdown {
    // Validate inputs
    if (!usage) {
      throw new Error("Usage record is required");
    }
    if (!pricing) {
      throw new Error("Pricing data is required");
    }
    if (feeBps < 0) {
      throw new Error("Fee basis points cannot be negative");
    }
    if (usage.prompt_tokens < 0 || usage.completion_tokens < 0) {
      throw new Error("Token counts cannot be negative");
    }

    // Parse prices to pico-dollars for precision-safe calculation
    const inputPricePico = parseToPicoDollars(pricing.input_usd_per_token);
    const outputPricePico = parseToPicoDollars(pricing.output_usd_per_token);
    const cachedPricePico = pricing.cached_usd_per_token
      ? parseToPicoDollars(pricing.cached_usd_per_token)
      : inputPricePico; // fallback to input price if no cached price defined

    // Calculate subtotal with three-tier pricing:
    //   non_cached_prompt * input_price
    //   + cached_tokens * cached_price
    //   + completion_tokens * output_price
    const cachedTokens = usage.cached_tokens ?? 0;
    const safeCachedTokens = Math.max(0, Math.min(cachedTokens, usage.prompt_tokens));
    const nonCachedPrompt = Math.max(0, usage.prompt_tokens - safeCachedTokens);
    const promptCostPico = BigInt(nonCachedPrompt) * inputPricePico;
    const cachedCostPico = BigInt(safeCachedTokens) * cachedPricePico;
    const completionCostPico =
      BigInt(usage.completion_tokens) * outputPricePico;
    const subtotalPico = promptCostPico + cachedCostPico + completionCostPico;

    // Calculate platform fee: subtotal * feeBps / 10000
    const platformFeePico = (subtotalPico * BigInt(feeBps)) / BigInt(10000);

    // Calculate total: subtotal + platform_fee
    const totalPico = subtotalPico + platformFeePico;

    // Format results back to decimal strings
    const subtotalUsd = formatFromPicoDollars(subtotalPico);
    const platformFeeUsd = formatFromPicoDollars(platformFeePico);
    const totalUsd = formatFromPicoDollars(totalPico);

    // Log calculation if logger provided
    if (log) {
      log("Cost calculated", {
        prompt_tokens: usage.prompt_tokens,
        cached_tokens: safeCachedTokens,
        completion_tokens: usage.completion_tokens,
        input_price: pricing.input_usd_per_token,
        cached_price: pricing.cached_usd_per_token,
        output_price: pricing.output_usd_per_token,
        fee_bps: feeBps,
        subtotal_usd: subtotalUsd,
        platform_fee_usd: platformFeeUsd,
        total_usd: totalUsd,
      });
    }

    return {
      subtotal_usd: subtotalUsd,
      platform_fee_usd: platformFeeUsd,
      total_usd: totalUsd,
      unit_price_input: pricing.input_usd_per_token,
      unit_price_output: pricing.output_usd_per_token,
      unit_price_cached: pricing.cached_usd_per_token ?? "",
    };
  }

  function calculateCosts(
    usages: UsageRecord[],
    pricing: ModelPricing,
    feeBps: number,
  ): CostBreakdown[] {
    return usages.map((usage) => calculateCost(usage, pricing, feeBps));
  }

  function calculatePlatformFee(subtotalUsd: string, feeBps: number): string {
    if (feeBps < 0) {
      throw new Error("Fee basis points cannot be negative");
    }

    const subtotalPico = parseToPicoDollars(subtotalUsd);
    const platformFeePico = (subtotalPico * BigInt(feeBps)) / BigInt(10000);

    return formatFromPicoDollars(platformFeePico);
  }

  function validatePricing(pricing: ModelPricing): boolean {
    if (!pricing) return false;

    try {
      const inputPrice = parseToPicoDollars(pricing.input_usd_per_token);
      const outputPrice = parseToPicoDollars(pricing.output_usd_per_token);

      // Prices must be non-negative
      if (inputPrice < 0 || outputPrice < 0) {
        return false;
      }

      // Validate cached price if provided
      if (pricing.cached_usd_per_token) {
        const cachedPrice = parseToPicoDollars(pricing.cached_usd_per_token);
        if (cachedPrice < 0) return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  return {
    calculateCost,
    calculateCosts,
    calculatePlatformFee,
    validatePricing,
  };
}

/**
 * Default platform fee in basis points (0.5% = 50 bps).
 * Can be overridden via configuration.
 */
export const DEFAULT_PLATFORM_FEE_BPS = 50;

/**
 * Calculate cost with default platform fee.
 * Convenience function for common use case.
 *
 * @param usage - Token usage record
 * @param pricing - Model pricing
 * @returns CostBreakdown with default 0.5% platform fee
 */
export function calculateCostWithDefaultFee(
  usage: UsageRecord,
  pricing: ModelPricing,
): CostBreakdown {
  const service = createCostService();
  return service.calculateCost(usage, pricing, DEFAULT_PLATFORM_FEE_BPS);
}
