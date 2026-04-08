/** Route decision metadata included in audit trail */
export interface RouteDecision {
  selected_model: string;
  fallback_chain: string[];
  score_summary: string;
  route_proof_hash: string;
}

/** Candidate model with scoring */
export interface RouteCandidate {
  model_id: string;
  score: number;
  reason: string;
}

/** Context for routing decisions */
export interface RoutingContext {
  requested_model: string;
  routing_mode: 'manual' | 'auto';
  available_models: string[];
}
