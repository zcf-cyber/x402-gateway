import type { RequestId } from "../types.js";

/**
 * Token usage record for a single request.
 * Captures the actual token consumption from upstream provider.
 */
export interface UsageRecord {
  /** Unique request identifier (branded type) */
  request_id: RequestId;
  /** Model used for the request (e.g., "openai/gpt-4o") */
  model_id: string;
  /** Number of input/prompt tokens consumed */
  prompt_tokens: number;
  /** Number of output/completion tokens consumed */
  completion_tokens: number;
  /** Total tokens consumed (should be >= prompt + completion) */
  total_tokens: number;
}

/**
 * Deterministic cost breakdown for billing transparency.
 * All amounts are string-encoded decimals to avoid floating-point precision issues.
 */
export interface CostBreakdown {
  /** Base cost calculated from input/output tokens and unit prices (USD) */
  subtotal_usd: string;
  /** Platform service fee (USD) */
  platform_fee_usd: string;
  /** Total amount to be charged (USD) */
  total_usd: string;
  /** Price per input token (USD as string) */
  unit_price_input: string;
  /** Price per output token (USD as string) */
  unit_price_output: string;
}

/**
 * Immutable ledger entry.
 * CRITICAL: Never UPDATE or DELETE after commit. Use append-only corrections.
 * 
 * Design Principles:
 * 1. Immutable - once written, never modified
 * 2. Append-only - corrections add new entries
 * 3. Complete audit trail - includes all billing metadata
 * 4. Tamper-evident - includes request_id and quote_id for verification
 */
export interface LedgerEntry {
  /** Unique ledger entry identifier */
  id: string;
  /** Request ID for correlation with request trace */
  request_id: string;
  /** Quote ID from x402 payment challenge */
  quote_id: string;
  /** Payer wallet address */
  payer_address: string;
  /** Model that was actually used for the request */
  model_used: string;
  /** Token usage details */
  usage: UsageRecord;
  /** Cost breakdown including platform fees */
  cost: CostBreakdown;
  /** ISO timestamp of ledger entry creation */
  created_at: string;
}

/**
 * Usage record with metadata for billing queries.
 * Extends base UsageRecord with query-friendly fields.
 */
export interface UsageRecordWithMetadata extends UsageRecord {
  /** ISO timestamp of usage record creation */
  created_at: string;
  /** Request hash for verification */
  request_hash?: string;
  /** Routing mode used (manual or auto) */
  routing_mode?: 'manual' | 'auto';
}

/**
 * Token metering input for manual calculation.
 * Used when upstream provider doesn't provide usage data.
 */
export interface TokenMeterInput {
  /** Request text/prompt to count tokens from */
  prompt_text: string;
  /** Response text to count tokens from */
  completion_text: string;
  /** Tokenizer to use (provider-specific or default) */
  tokenizer?: 'gpt4' | 'cl100k' | 'default';
}

/**
 * Cost calculation input parameters.
 */
export interface CostCalculationInput {
  /** Usage data with token counts */
  usage: UsageRecord;
  /** Unit price for input tokens (USD per token as string) */
  input_price_usd: string;
  /** Unit price for output tokens (USD per token as string) */
  output_price_usd: string;
  /** Platform fee percentage (e.g., "0.05" for 5%) */
  platform_fee_rate?: string;
}

/**
 * Validation result for usage data.
 */
export interface UsageValidationResult {
  /** Whether the usage data is valid */
  valid: boolean;
  /** List of validation errors if invalid */
  errors: string[];
  /** Optional warning messages */
  warnings?: string[];
}
