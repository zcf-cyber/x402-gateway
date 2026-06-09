import type { RequestId } from '../types.js';
import type { UpstreamResponse } from '../provider/types.js';
import type { UsageRecord } from './types.js';

/**
 * Dependencies for MeterService
 */
export interface MeterServiceDeps {
  /** Database service for persisting usage records */
  recordUsage: (
    requestId: string,
    modelId: string,
    promptTokens: number,
    completionTokens: number,
    totalTokens: number,
    cachedTokens?: number,
  ) => Promise<void>;
}

/**
 * Interface for token metering service.
 * Responsible for extracting token usage from upstream responses
 * and persisting usage records for billing.
 */
export interface IMeterService {
  /**
   * Extract token counts from the upstream response and build a UsageRecord.
   * Persists the record to the database.
   * 
   * @param requestId - Unique request identifier
   * @param modelId - The model used for the request (e.g., "openai/gpt-4o")
   * @param upstreamResponse - Response from upstream provider containing usage data
   * @returns Promise<UsageRecord> - The recorded usage data
   * @throws Error if persistence fails
   */
  recordUsage(
    requestId: RequestId,
    modelId: string,
    upstreamResponse: UpstreamResponse,
  ): Promise<UsageRecord>;

  /**
   * Get usage record by request ID.
   * Used for audit and billing verification.
   * 
   * @param requestId - The request ID to look up
   * @returns Promise<UsageRecord | null> - The usage record or null if not found
   */
  getUsage(requestId: RequestId): Promise<UsageRecord | null>;
}

/**
 * Create a MeterService instance.
 * 
 * Design Principles:
 * 1. Extract usage from upstream response (prompt_tokens, completion_tokens, total_tokens)
 * 2. Persist usage record for billing calculation
 * 3. Return structured UsageRecord for further processing
 * 4. Support retrieval for audit and verification
 * 
 * @param deps - Service dependencies (database layer)
 * @returns IMeterService implementation
 */
export function createMeterService(deps: MeterServiceDeps): IMeterService {
  const { recordUsage: persistUsage } = deps;

  // In-memory storage for testing (will be replaced with database in production)
  const usageStore = new Map<string, UsageRecord>();

  return {
    async recordUsage(
      requestId: RequestId,
      modelId: string,
      upstreamResponse: UpstreamResponse,
    ): Promise<UsageRecord> {
      // Extract usage from upstream response
      const usage = upstreamResponse.usage;

      if (!usage) {
        throw new Error('Missing usage data in upstream response');
      }

      // Validate token counts
      if (usage.prompt_tokens < 0 || usage.completion_tokens < 0 || usage.total_tokens < 0) {
        throw new Error('Invalid token counts: negative values not allowed');
      }

      // Build UsageRecord — clamp cached_tokens to upstream prompt_tokens
      const rawCachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
      const cachedTokens = Math.max(0, Math.min(rawCachedTokens, usage.prompt_tokens));
      const usageRecord: UsageRecord = {
        request_id: requestId,
        model_id: modelId,
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
        cached_tokens: cachedTokens > 0 ? cachedTokens : undefined,
      };

      // Persist to database
      await persistUsage(
        requestId,
        modelId,
        usageRecord.prompt_tokens,
        usageRecord.completion_tokens,
        usageRecord.total_tokens,
        cachedTokens,
      );

      // Store in memory for getUsage retrieval
      usageStore.set(requestId, usageRecord);

      return usageRecord;
    },

    async getUsage(requestId: RequestId): Promise<UsageRecord | null> {
      // Check in-memory store first
      const record = usageStore.get(requestId);
      if (record) {
        return record;
      }

      // TODO: Fetch from database if not in memory
      return null;
    },
  };
}

/**
 * Calculate total tokens from prompt and completion tokens.
 * Used for validation and when total_tokens is not provided.
 * 
 * @param promptTokens - Number of input/prompt tokens
 * @param completionTokens - Number of output/completion tokens
 * @returns Total token count
 */
export function calculateTotalTokens(
  promptTokens: number,
  completionTokens: number,
): number {
  return promptTokens + completionTokens;
}

/**
 * Validate token usage data.
 * Ensures token counts are non-negative and consistent.
 * 
 * @param usage - Token usage data to validate
 * @returns true if valid, false otherwise
 */
export function validateTokenUsage(usage: {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}): boolean {
  // Check for negative values
  if (usage.prompt_tokens < 0 || usage.completion_tokens < 0 || usage.total_tokens < 0) {
    return false;
  }

  // Validate that total is at least the sum of prompt + completion
  // (some providers may include additional tokens in the total)
  const minTotal = usage.prompt_tokens + usage.completion_tokens;
  if (usage.total_tokens < minTotal) {
    return false;
  }

  return true;
}
