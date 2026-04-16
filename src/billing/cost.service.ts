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
   * - subtotal = (prompt_tokens * input_price) + (completion_tokens * output_price)
   * - platform_fee = subtotal * feeBps / 10000
   * - total = subtotal + platform_fee
   *
   * All amounts are returned as string-encoded decimals to avoid floating-point
   * precision issues. USD currency is implied.
   *
   * @param usage - Token usage record with prompt and completion counts
   * @param pricing - Model pricing with input/output unit prices (USD per token)
   * @param feeBps - Platform fee in basis points (e.g., 50 = 0.5%)
   * @returns CostBreakdown with detailed cost components
   * @throws Error if pricing data is invalid or token counts are negative
   *
   * @example
   * ```typescript
   * const usage = { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 };
   * const pricing = { input_usd_per_token: "0.00001", output_usd_per_token: "0.00002" };
   * const breakdown = costService.calculateCost(usage, pricing, 50);
   * // breakdown.subtotal_usd = "0.02"
   * // breakdown.platform_fee_usd = "0.0001"
   * // breakdown.total_usd = "0.0201"
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
 * Parse a decimal string to a BigInt representing the value in micro-dollars (1 USD = 1_000_000).
 * This provides 6 decimal places of precision which is sufficient for token pricing.
 *
 * @param decimalStr - Decimal string (e.g., "0.00001")
 * @returns BigInt representing the value in micro-dollars
 * @throws Error if the string is not a valid decimal
 */
function parseToMicroDollars(decimalStr: string): bigint {
  const trimmed = decimalStr.trim();

  if (!/^\d*\.?\d*$/.test(trimmed)) {
    throw new Error(`Invalid decimal string: ${decimalStr}`);
  }

  const [wholePart = "0", decimalPart = ""] = trimmed.split(".");
  const paddedDecimal = (decimalPart + "000000").slice(0, 6);

  const wholeValue = BigInt(wholePart) * BigInt(1_000_000);
  const decimalValue = BigInt(paddedDecimal);

  return wholeValue + decimalValue;
}

/**
 * Convert micro-dollars to a decimal string with exactly 6 decimal places.
 *
 * @param microDollars - Value in micro-dollars
 * @returns Decimal string (e.g., "0.000010")
 */
function formatFromMicroDollars(microDollars: bigint): string {
  const isNegative = microDollars < 0;
  const absValue = isNegative ? -microDollars : microDollars;

  const wholePart = absValue / BigInt(1_000_000);
  const decimalPart = absValue % BigInt(1_000_000);

  const decimalStr = decimalPart.toString().padStart(6, "0");
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
 * Implementation uses BigInt arithmetic with micro-dollar precision (6 decimal places)
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

    // Parse prices to micro-dollars for precision-safe calculation
    const inputPriceMicro = parseToMicroDollars(pricing.input_usd_per_token);
    const outputPriceMicro = parseToMicroDollars(pricing.output_usd_per_token);

    // Calculate subtotal: (prompt_tokens * input_price) + (completion_tokens * output_price)
    const promptCostMicro = BigInt(usage.prompt_tokens) * inputPriceMicro;
    const completionCostMicro =
      BigInt(usage.completion_tokens) * outputPriceMicro;
    const subtotalMicro = promptCostMicro + completionCostMicro;

    // Calculate platform fee: subtotal * feeBps / 10000
    const platformFeeMicro = (subtotalMicro * BigInt(feeBps)) / BigInt(10000);

    // Calculate total: subtotal + platform_fee
    const totalMicro = subtotalMicro + platformFeeMicro;

    // Format results back to decimal strings
    const subtotalUsd = formatFromMicroDollars(subtotalMicro);
    const platformFeeUsd = formatFromMicroDollars(platformFeeMicro);
    const totalUsd = formatFromMicroDollars(totalMicro);

    // Log calculation if logger provided
    if (log) {
      log("Cost calculated", {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        input_price: pricing.input_usd_per_token,
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

    const subtotalMicro = parseToMicroDollars(subtotalUsd);
    const platformFeeMicro = (subtotalMicro * BigInt(feeBps)) / BigInt(10000);

    return formatFromMicroDollars(platformFeeMicro);
  }

  function validatePricing(pricing: ModelPricing): boolean {
    if (!pricing) return false;

    try {
      const inputPrice = parseToMicroDollars(pricing.input_usd_per_token);
      const outputPrice = parseToMicroDollars(pricing.output_usd_per_token);

      // Prices must be non-negative
      if (inputPrice < 0 || outputPrice < 0) {
        return false;
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