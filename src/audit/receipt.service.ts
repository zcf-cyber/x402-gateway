import type { RequestId } from '../types.js';
import type { AuditQueryResult } from './types.js';

export interface IReceiptService {
  /**
   * Reconstruct a full audit record by joining trace, route decision,
   * usage, cost, and payment data.
   * Returns the shape from API spec section 5, or null if not found.
   * Used by GET /v1/audit/requests/:request_id
   */
  getByRequestId(requestId: RequestId): Promise<AuditQueryResult | null>;
}

export function createReceiptService(): IReceiptService {
  return {
    async getByRequestId(_requestId: RequestId): Promise<AuditQueryResult | null> {
      // TODO: Implement
      // 1. Query trace record by request_id
      // 2. Join with route_decision, usage_record, cost_breakdown, payment data
      // 3. Assemble into AuditQueryResult shape
      // 4. Return null if request_id not found
      throw new Error('Not implemented');
    },
  };
}
