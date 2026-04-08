import type { RequestId } from '../types.js';

/** Token usage record for a single request */
export interface UsageRecord {
  request_id: RequestId;
  model_id: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** Deterministic cost breakdown */
export interface CostBreakdown {
  subtotal_usd: string;
  platform_fee_usd: string;
  total_usd: string;
  unit_price_input: string;
  unit_price_output: string;
}

/** Immutable ledger entry -- never UPDATE or DELETE after commit */
export interface LedgerEntry {
  id: string;
  request_id: string;
  quote_id: string;
  payer_address: string;
  model_used: string;
  usage: UsageRecord;
  cost: CostBreakdown;
  created_at: string;
}
