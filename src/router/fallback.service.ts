import { UpstreamUnavailableError, UpstreamTimeoutError } from "../errors.js";
import type { UpstreamResponse } from "../provider/types.js";

/**
 * TODO(Issue #80): 高可用 Provider Fallback — Multi-Provider Retry for the Same Model
 *
 * 当前: executeWithFallback 接收 modelIds[]，用于不同模型间的 fallback。
 * 下一阶段需改为: 同一模型的多个 provider 间 fallback（如 openai → azure → aws）。
 * 用户付费金额不变（因为 model 不变 → pricing 不变），符合 x402 契约。
 *
 * 改动要点:
 * 1. 接收 ProviderEndpoint[] 而非 modelIds[]
 * 2. 同一 modelId + 多个 provider adapter 按优先级重试
 * 3. 成功的 provider 动态 rebase 到最高优先级 (Issue #80)
 * 4. 审计记录: fallback_chain 记录实际尝试的 provider 列表
 */

/**
 * Dependencies for FallbackService
 */
export interface FallbackServiceDeps {
  /** Optional logger for fallback operations */
  log?: (message: string, meta?: Record<string, unknown>) => void;
  /** Default timeout per model attempt in ms */
  defaultTimeoutMs?: number;
  /** Delay between fallback attempts in ms */
  fallbackDelayMs?: number;
}

/**
 * Execution result with detailed metadata for audit trail
 */
export interface FallbackExecutionResult {
  /** The model that successfully executed */
  modelId: string;
  /** The upstream response */
  response: UpstreamResponse;
  /** Execution statistics for observability */
  stats: {
    /** Total attempts made */
    attempts: number;
    /** Number of failed attempts before success */
    failedAttempts: number;
    /** Total execution time in ms */
    totalDurationMs: number;
    /** Individual attempt durations */
    attemptDurationsMs: number[];
  };
  /** Errors from failed attempts (for debugging) */
  errors: Array<{
    modelId: string;
    error: string;
    errorCode: string | undefined;
  }>;
}

export interface IFallbackService {
  /**
   * Try models in order, return the first successful result.
   * If all fail, throw UpstreamUnavailableError.
   *
   * CRITICAL: Must NOT double-charge. Only the successfully executed
   * model should be billed. Failed attempts are not charged.
   *
   * Features:
   * - Per-model timeout control
   * - Exponential backoff between attempts
   * - Detailed execution statistics
   * - Comprehensive error logging
   */
  executeWithFallback(
    chain: string[],
    executeFn: (modelId: string) => Promise<UpstreamResponse>,
    options?: {
      /** Timeout per model attempt in ms (overrides default) */
      timeoutMs?: number;
      /** Whether to add delay between attempts */
      useBackoff?: boolean;
    },
  ): Promise<FallbackExecutionResult>;
}

/**
 * Create a promise that rejects after specified timeout
 */
function createTimeoutPromise<T>(ms: number, modelId: string): Promise<T> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new UpstreamTimeoutError(modelId));
    }, ms);
  });
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 */
function calculateBackoff(attemptIndex: number, baseDelayMs: number): number {
  // Exponential: 0, 1x, 2x, 4x, 8x... (max 30s)
  const multiplier = attemptIndex === 0 ? 0 : Math.pow(2, attemptIndex - 1);
  return Math.min(baseDelayMs * multiplier, 30000);
}

/**
 * Create a FallbackService instance.
 *
 * Implements intelligent fallback chain execution with:
 * - Timeout control per model attempt
 * - Exponential backoff between failures
 * - Detailed execution statistics
 * - Audit-friendly error tracking
 *
 * @param deps - Optional service dependencies
 * @returns IFallbackService implementation
 */
export function createFallbackService(
  deps?: FallbackServiceDeps,
): IFallbackService {
  const {
    log,
    defaultTimeoutMs = 30000, // 30s default timeout
    fallbackDelayMs = 1000, // 1s base delay
  } = deps || {};

  return {
    async executeWithFallback(
      chain: string[],
      executeFn: (modelId: string) => Promise<UpstreamResponse>,
      options?: {
        timeoutMs?: number;
        useBackoff?: boolean;
      },
    ): Promise<FallbackExecutionResult> {
      const timeoutMs = options?.timeoutMs ?? defaultTimeoutMs;
      const useBackoff = options?.useBackoff ?? true;

      const errors: FallbackExecutionResult["errors"] = [];
      const attemptDurationsMs: number[] = [];
      const startTime = Date.now();

      if (chain.length === 0) {
        throw new UpstreamUnavailableError("All models in fallback chain failed: (empty chain)");
      }

      if (log) {
        log("Starting fallback chain execution", {
          chainLength: chain.length,
          chain: chain.join(", "),
          timeoutMs,
          useBackoff,
        });
      }

      for (let i = 0; i < chain.length; i++) {
        const modelId = chain[i]!; // Non-null assertion: we know i < chain.length
        const attemptStart = Date.now();

        try {
          // Apply backoff delay before retry (except first attempt)
          if (useBackoff && i > 0) {
            const delay = calculateBackoff(i, fallbackDelayMs);
            if (log) {
              log("Applying fallback backoff delay", {
                attempt: i + 1,
                modelId,
                delayMs: delay,
              });
            }
            await sleep(delay);
          }

          // Execute with timeout
          const response = await Promise.race([
            executeFn(modelId),
            createTimeoutPromise<UpstreamResponse>(timeoutMs, modelId),
          ]);

          const attemptDuration = Date.now() - attemptStart;
          attemptDurationsMs.push(attemptDuration);
          const totalDuration = Date.now() - startTime;

          if (log) {
            log("Fallback chain succeeded", {
              modelId,
              attempt: i + 1,
              totalAttempts: i + 1,
              attemptDurationMs: attemptDuration,
              totalDurationMs: totalDuration,
              failedAttempts: i,
            });
          }

          return {
            modelId,
            response,
            stats: {
              attempts: i + 1,
              failedAttempts: i,
              totalDurationMs: totalDuration,
              attemptDurationsMs,
            },
            errors,
          };
        } catch (err) {
          const attemptDuration = Date.now() - attemptStart;
          attemptDurationsMs.push(attemptDuration);

          const error = err instanceof Error ? err : new Error(String(err));
          const errorCode = (err as { code?: string }).code;

          errors.push({
            modelId,
            error: error.message,
            errorCode,
          });

          if (log) {
            log("Fallback attempt failed", {
              attempt: i + 1,
              modelId,
              error: error.message,
              errorCode,
              attemptDurationMs: attemptDuration,
            });
          }
        }
      }

      // All models failed
      const totalDuration = Date.now() - startTime;

      if (log) {
        log("Fallback chain exhausted", {
          chainLength: chain.length,
          totalDurationMs: totalDuration,
          allErrors: errors.map((e) => ({
            modelId: e.modelId,
            error: e.error,
          })),
        });
      }

      throw new UpstreamUnavailableError(
        `All models in fallback chain failed: ${chain.join(", ")}. ` +
          `Errors: ${errors.map((e) => `${e.modelId}: ${e.error}`).join("; ")}`,
      );
    },
  };
}
