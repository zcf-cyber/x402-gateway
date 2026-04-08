import type { RoutingMode, TokenUsage } from '../types.js';

/** Full request trace for audit persistence */
export interface RequestTrace {
  request_id: string;
  request_hash: string;
  routing_mode: RoutingMode;
  status: 'pending' | 'completed' | 'failed';
  created_at: string;
  completed_at?: string;
  latency_ms?: number;
}

/** Audit query result matching API spec section 5 */
export interface AuditQueryResult {
  request_id: string;
  request_hash: string;
  routing_mode: RoutingMode;
  route_decision: {
    selected_model: string;
    fallback_chain: string[];
    score_summary: string;
  };
  usage: TokenUsage;
  cost: {
    subtotal_usd: string;
    platform_fee_usd: string;
    total_usd: string;
  };
  payment: {
    quote_id: string;
    chain: string;
    asset: string;
    payer_address: string;
    verification_status: string;
  };
}
