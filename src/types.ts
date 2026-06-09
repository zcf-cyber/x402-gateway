// ---------------------------------------------------------------------------
// Shared domain types for the x402 gateway
// These mirror the API spec (docs/api-spec-v0-x402-gateway.md)
// ---------------------------------------------------------------------------

/** Branded string helpers */
export type RequestId = string & { readonly __brand: 'RequestId' };
export type QuoteId = string & { readonly __brand: 'QuoteId' };

// RoutingMode ('manual' | 'auto') removed — auto model selection conflicts
// with x402 payment contract (Issue #71). Only manual routing is supported.
// TODO(Issue #80): multi-provider fallback for same model.

// ---------------------------------------------------------------------------
// Chat Completion (OpenAI-compatible)
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** OpenAI-compatible: cached_tokens within prompt_tokens_details */
  prompt_tokens_details?: {
    cached_tokens?: number;
    audio_tokens?: number;
  };
}

export interface UsageReceipt {
  request_id: string;
  quote_id: string;
  payer_address: string;
  model_used: string;
  unit_price_input_usd: string;
  unit_price_output_usd: string;
  unit_price_cached_usd?: string;
  total_cost_usd: string;
  route_proof_hash: string;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: TokenUsage;
  usage_receipt: UsageReceipt;
}

// ---------------------------------------------------------------------------
// Model Catalog
// ---------------------------------------------------------------------------

export interface ModelPricing {
  input_usd_per_token: string;
  output_usd_per_token: string;
  /** Cached/prompt-cache-hit token price (USD per token). Optional for backward compat. */
  cached_usd_per_token?: string;
  effective_at: string;
}

export interface ModelInfo {
  id: string;
  provider: string;
  context_window: number;
  capabilities: string[];
  pricing: ModelPricing;
}

export interface ModelListResponse {
  data: ModelInfo[];
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditRouteDecision {
  selected_model: string;
  fallback_chain: string[];
  score_summary: string;
}

export interface AuditCost {
  subtotal_usd: string;
  platform_fee_usd: string;
  total_usd: string;
}

export interface AuditPayment {
  quote_id: string;
  chain: string;
  asset: string;
  payer_address: string;
  verification_status: string;
}

export interface AuditRecord {
  request_id: string;
  request_hash: string;
  route_decision: AuditRouteDecision;
  usage: TokenUsage;
  cost: AuditCost;
  payment: AuditPayment;
}
