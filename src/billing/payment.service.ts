import type { ChatCompletionRequest, ModelPricing } from "../types.js";
import { InsufficientPaymentError } from "../errors.js";
import type { ICostService } from "./cost.service.js";

// ---------------------------------------------------------------------------
// Payment Amount Estimation & Validation Layer
//
// This service is the modular payment amount layer, decoupled from x402
// challenge generation. Responsible for:
//   1. Token estimation from chat completion requests (pre-execution)
//   2. Estimated cost calculation (model pricing × estimated tokens + fee)
//   3. Post-execution payment validation (actual ≤ authorized)
//
// Design follows x402 "upto" scheme principles:
//   - Client authorizes a maximum amount (estimated via this service)
//   - Actual usage may be less than or equal to the authorized amount
//   - If actual exceeds authorized, the request is rejected
//
// This layer is protocol-agnostic and can be reused when #77 introduces
// the official x402 upto scheme.
// ---------------------------------------------------------------------------

/** Default max completion tokens for cost estimation (when not specified). */
const DEFAULT_MAX_COMPLETION_TOKENS = 4096;

/** Approximate token-to-character ratio for English text. */
const CHARS_PER_TOKEN = 4;

/** Estimated token counts from a chat completion request. */
export interface EstimatedTokens {
  estimated_prompt_tokens: number;
  estimated_completion_tokens: number;
  estimated_total_tokens: number;
}

/**
 * Interface for the payment estimation & validation service.
 * Part of the modular payment amount layer (Issue #45).
 */
export interface IPaymentService {
  /**
   * Estimate token usage from a chat completion request body.
   *
   * Heuristic:
   *   - Prompt tokens ≈ ceil(total_message_characters / 4)
   *   - Completion tokens = DEFAULT_MAX_COMPLETION_TOKENS (4096)
   *
   * This provides a conservative upper bound for the "upto" scheme.
   *
   * @param request - The chat completion request with messages
   * @returns Estimated token counts
   */
  estimateTokens(request: ChatCompletionRequest): EstimatedTokens;

  /**
   * Calculate the total estimated cost based on token estimates and model pricing.
   *
   * Uses nano-dollar precision via the injected cost service.
   * Formula: (prompt_tokens × input_price) + (completion_tokens × output_price)
   *          + platform_fee
   *
   * @param estimatedTokens - Token estimates from estimateTokens()
   * @param pricing - Model pricing (input/output USD per token)
   * @param feeBps - Platform fee in basis points
   * @returns Total estimated cost as decimal string (e.g., "0.0012")
   */
  estimateTotalCost(
    estimatedTokens: EstimatedTokens,
    pricing: ModelPricing,
    feeBps: number,
  ): string;

  /**
   * Validate that the actual execution cost does not exceed the authorized amount.
   *
   * Follows x402 "upto" semantics: actual usage must be ≤ authorized maximum.
   * Throws InsufficientPaymentError with details if actual > authorized.
   *
   * @param actualTotalUsd - Actual total cost after LLM execution (decimal string)
   * @param authorizedAmount - Amount authorized in the 402 challenge (decimal string)
   * @throws InsufficientPaymentError if actual exceeds authorized
   */
  validatePayment(actualTotalUsd: string, authorizedAmount: string): void;
}

/** Dependencies for PaymentService factory. */
export interface PaymentServiceDeps {
  costService: ICostService;
}

/**
 * Create a PaymentService instance.
 *
 * The payment service is protocol-agnostic — it knows nothing about x402
 * challenge tokens or on-chain verification. It only handles the monetary
 * estimation and validation layer.
 *
 * @param deps - Service dependencies
 * @returns IPaymentService implementation
 */
export function createPaymentService(deps: PaymentServiceDeps): IPaymentService {
  const { costService } = deps;

  function estimateTokens(request: ChatCompletionRequest): EstimatedTokens {
    const totalChars = request.messages.reduce(
      (sum, msg) => sum + (msg.content?.length ?? 0),
      0,
    );
    const estimatedPromptTokens = Math.ceil(totalChars / CHARS_PER_TOKEN);
    const estimatedCompletionTokens = DEFAULT_MAX_COMPLETION_TOKENS;

    return {
      estimated_prompt_tokens: estimatedPromptTokens,
      estimated_completion_tokens: estimatedCompletionTokens,
      estimated_total_tokens:
        estimatedPromptTokens + estimatedCompletionTokens,
    };
  }

  function estimateTotalCost(
    estimatedTokens: EstimatedTokens,
    pricing: ModelPricing,
    feeBps: number,
  ): string {
    // Build a synthetic usage record for cost calculation
    const usage = {
      request_id: "" as import("../types.js").RequestId,
      model_id: "",
      prompt_tokens: estimatedTokens.estimated_prompt_tokens,
      completion_tokens: estimatedTokens.estimated_completion_tokens,
      total_tokens: estimatedTokens.estimated_total_tokens,
    };

    const breakdown = costService.calculateCost(usage, pricing, feeBps);
    return breakdown.total_usd;
  }

  function validatePayment(
    actualTotalUsd: string,
    authorizedAmount: string,
  ): void {
    const actual = parseFloat(actualTotalUsd);
    const authorized = parseFloat(authorizedAmount);

    if (Number.isNaN(actual) || Number.isNaN(authorized)) {
      throw new Error(
        `Invalid numeric values for payment validation: actual="${actualTotalUsd}", authorized="${authorizedAmount}"`,
      );
    }

    if (actual > authorized) {
      throw new InsufficientPaymentError(authorizedAmount, actualTotalUsd);
    }
  }

  return {
    estimateTokens,
    estimateTotalCost,
    validatePayment,
  };
}
