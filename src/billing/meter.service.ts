import type { RequestId } from '../types.js';
import type { UpstreamResponse } from '../provider/types.js';
import type { UsageRecord } from './types.js';

export interface IMeterService {
  /**
   * Extract token counts from the upstream response and build a UsageRecord.
   * Persists the record to the database.
   */
  recordUsage(requestId: RequestId, modelId: string, upstreamResponse: UpstreamResponse): Promise<UsageRecord>;
}

export function createMeterService(): IMeterService {
  return {
    async recordUsage(
      _requestId: RequestId,
      _modelId: string,
      _upstreamResponse: UpstreamResponse,
    ): Promise<UsageRecord> {
      // TODO: Implement
      // 1. Extract prompt_tokens, completion_tokens, total_tokens from upstreamResponse.usage
      // 2. Build UsageRecord
      // 3. Persist to database
      // 4. Return UsageRecord
      throw new Error('Not implemented');
    },
  };
}
