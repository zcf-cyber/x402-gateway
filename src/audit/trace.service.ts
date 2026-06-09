import type { RequestId } from '../types.js';
import type { RequestTrace, AuditQueryResult } from './types.js';

/**
 * Dependencies for TraceService
 */
export interface TraceServiceDeps {
  /** Optional logger for trace operations */
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Extended trace record with complete audit data
 */
interface CompleteTrace extends RequestTrace {
  routeDecision?: {
    selected_model: string;
    fallback_chain: string[];
    score_summary: string;
  };
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cached_tokens?: number;
  };
  cost?: {
    subtotal_usd: string;
    platform_fee_usd: string;
    total_usd: string;
  };
  payment?: {
    quote_id: string;
    chain: string;
    asset: string;
    payer_address: string;
    verification_status: string;
  };
  failureReason?: string;
}

/**
 * Interface for request tracing service.
 * Responsible for recording the full lifecycle of a request
 * from arrival through completion for audit purposes.
 */
export interface ITraceService {
  /**
   * Create the initial trace record when a request arrives.
   * Status starts as 'pending'.
   *
   * @param requestId - Unique request identifier
   * @param requestHash - Hash of the request for integrity verification
   */
  startTrace(requestId: RequestId, requestHash: string): Promise<void>;

  /**
   * Finalize the trace with route decision, usage, cost, and payment data.
   * Sets status to 'completed' and records latency.
   *
   * @param requestId - The request ID to complete
   * @param data - Complete trace data including route decision, usage, cost, payment
   */
  completeTrace(requestId: RequestId, data: {
    selectedModel: string;
    fallbackChain: string[];
    scoreSummary: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens?: number;
    subtotalUsd: string;
    platformFeeUsd: string;
    totalUsd: string;
    quoteId: string;
    chain: string;
    asset: string;
    payerAddress: string;
    latencyMs: number;
  }): Promise<void>;

  /**
   * Mark a trace as failed.
   *
   * @param requestId - The request ID to mark as failed
   * @param reason - Failure reason description
   */
  failTrace(requestId: RequestId, reason: string): Promise<void>;

  /**
   * Get a trace by request_id.
   *
   * @param requestId - The request ID to look up
   * @returns The trace record or null if not found
   */
  getTrace(requestId: RequestId): Promise<RequestTrace | null>;

  /**
   * Get full audit record including route decision, usage, cost, and payment.
   * Only returns completed traces with full data.
   *
   * @param requestId - The request ID to look up
   * @returns Complete audit record or null if not found/incomplete
   * @throws Error if trace exists but is not completed
   */
  getAuditRecord(requestId: RequestId): Promise<AuditQueryResult | null>;

  /**
   * List all traces in reverse chronological order.
   * Used for admin/debug purposes.
   *
   * @param limit - Maximum number of traces to return (default: all)
   * @returns Array of trace records
   */
  listTraces(limit?: number): Promise<RequestTrace[]>;

  /**
   * Clear all traces.
   * Used for testing purposes only.
   */
  clearAll(): Promise<void>;
}

/**
 * Create a TraceService instance.
 *
 * Design Principles:
 * 1. Record request lifecycle from start to completion
 * 2. Maintain pending status until completion or failure
 * 3. Store complete audit data for query interface
 * 4. Support retrieval for audit and verification
 *
 * Note: This implementation uses in-memory storage.
 * For production, replace the storage with persistent database.
 *
 * @param deps - Service dependencies
 * @returns ITraceService implementation
 */
export function createTraceService(deps?: TraceServiceDeps): ITraceService {
  const { log } = deps || {};

  /**
   * In-memory storage for MVP stage.
   * Production environment must migrate to PostgreSQL for persistence.
   */
  const traces = new Map<string, CompleteTrace>();

  return {
    async startTrace(
      requestId: RequestId,
      requestHash: string,
    ): Promise<void> {
      const now = new Date().toISOString();

      traces.set(requestId, {
        request_id: requestId,
        request_hash: requestHash,
        status: 'pending',
        created_at: now,
      });

      if (log) {
        log('Trace started', {
          requestId,
          requestHash,
          timestamp: now,
        });
      }
    },

    async completeTrace(
      requestId: RequestId,
      data: Parameters<ITraceService['completeTrace']>[1],
    ): Promise<void> {
      const trace = traces.get(requestId);

      if (!trace) {
        throw new Error(`Trace not found for request_id: ${requestId}`);
      }

      const now = new Date().toISOString();

      traces.set(requestId, {
        ...trace,
        status: 'completed',
        completed_at: now,
        latency_ms: data.latencyMs,
        routeDecision: {
          selected_model: data.selectedModel,
          fallback_chain: data.fallbackChain,
          score_summary: data.scoreSummary,
        },
        usage: {
          prompt_tokens: data.promptTokens,
          completion_tokens: data.completionTokens,
          total_tokens: data.totalTokens,
          cached_tokens: data.cachedTokens,
        },
        cost: {
          subtotal_usd: data.subtotalUsd,
          platform_fee_usd: data.platformFeeUsd,
          total_usd: data.totalUsd,
        },
        payment: {
          quote_id: data.quoteId,
          chain: data.chain,
          asset: data.asset,
          payer_address: data.payerAddress,
          verification_status: 'verified',
        },
      });

      if (log) {
        log('Trace completed', {
          requestId,
          status: 'completed',
          selectedModel: data.selectedModel,
          totalUsd: data.totalUsd,
          latencyMs: data.latencyMs,
          timestamp: now,
        });
      }
    },

    async failTrace(requestId: RequestId, reason: string): Promise<void> {
      const trace = traces.get(requestId);

      if (!trace) {
        throw new Error(`Trace not found for request_id: ${requestId}`);
      }

      const now = new Date().toISOString();

      traces.set(requestId, {
        ...trace,
        status: 'failed',
        completed_at: now,
        failureReason: reason,
      });

      if (log) {
        log('Trace failed', {
          requestId,
          status: 'failed',
          reason,
          timestamp: now,
        });
      }
    },

    async getTrace(requestId: RequestId): Promise<RequestTrace | null> {
      const trace = traces.get(requestId);
      return trace || null;
    },

    async getAuditRecord(requestId: RequestId): Promise<AuditQueryResult | null> {
      const trace = traces.get(requestId);

      if (!trace) {
        return null;
      }

      if (trace.status !== 'completed') {
        throw new Error(`Trace not completed for request_id: ${requestId}`);
      }

      if (!trace.routeDecision || !trace.usage || !trace.cost || !trace.payment) {
        throw new Error(`Incomplete trace data for request_id: ${requestId}`);
      }

      return {
        request_id: trace.request_id,
        request_hash: trace.request_hash,
        route_decision: trace.routeDecision,
        usage: trace.usage,
        cost: trace.cost,
        payment: trace.payment,
      };
    },

    async listTraces(limit?: number): Promise<RequestTrace[]> {
      const allTraces = Array.from(traces.values());

      // Sort by created_at descending (newest first)
      allTraces.sort((a, b) => {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

      return limit ? allTraces.slice(0, limit) : allTraces;
    },

    async clearAll(): Promise<void> {
      traces.clear();

      if (log) {
        log('All traces cleared', { timestamp: new Date().toISOString() });
      }
    },
  };
}

/**
 * Build score summary string from route decision data.
 * Used for human-readable audit records.
 *
 * @param selectedModel - The selected model ID
 * @param fallbackChain - Array of fallback models tried
 * @returns Formatted score summary string
 */
export function buildScoreSummary(
  selectedModel: string,
  fallbackChain: string[],
): string {
  if (fallbackChain.length === 0) {
    return `Selected: ${selectedModel}`;
  }
  return `Selected: ${selectedModel} | Fallbacks tried: ${fallbackChain.join(', ')}`;
}

/**
 * Validate that a trace has all required fields for audit.
 *
 * @param trace - The trace to validate
 * @returns true if valid for audit, false otherwise
 */
export function isValidForAudit(trace: CompleteTrace): boolean {
  if (trace.status !== 'completed') {
    return false;
  }

  if (!trace.routeDecision || !trace.usage || !trace.cost || !trace.payment) {
    return false;
  }

  return true;
}
