import type { RequestId, RoutingMode } from '../types.js';
import type { RequestTrace } from './types.js';

export interface ITraceService {
  /**
   * Create the initial trace record when a request arrives.
   * Status starts as 'pending'.
   */
  startTrace(requestId: RequestId, requestHash: string, routingMode: RoutingMode): Promise<void>;

  /**
   * Finalize the trace with route decision, usage, cost, and payment data.
   * Sets status to 'completed' and records latency.
   */
  completeTrace(requestId: RequestId, data: {
    selectedModel: string;
    fallbackChain: string[];
    scoreSummary: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    subtotalUsd: string;
    platformFeeUsd: string;
    totalUsd: string;
    quoteId: string;
    chain: string;
    asset: string;
    payerAddress: string;
  }): Promise<void>;

  /** Mark a trace as failed */
  failTrace(requestId: RequestId, reason: string): Promise<void>;

  /** Get a trace by request_id */
  getTrace(requestId: RequestId): Promise<RequestTrace | null>;
}

export function createTraceService(): ITraceService {
  return {
    async startTrace(
      _requestId: RequestId,
      _requestHash: string,
      _routingMode: RoutingMode,
    ): Promise<void> {
      // TODO: INSERT initial trace record into database
      throw new Error('Not implemented');
    },

    async completeTrace(
      _requestId: RequestId,
      _data: Parameters<ITraceService['completeTrace']>[1],
    ): Promise<void> {
      // TODO: UPDATE trace record with completion data
      throw new Error('Not implemented');
    },

    async failTrace(_requestId: RequestId, _reason: string): Promise<void> {
      // TODO: UPDATE trace record with failure status
      throw new Error('Not implemented');
    },

    async getTrace(_requestId: RequestId): Promise<RequestTrace | null> {
      // TODO: SELECT trace from database
      throw new Error('Not implemented');
    },
  };
}
