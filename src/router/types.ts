/** Route decision metadata included in audit trail */
export interface RouteDecision {
  selected_model: string;
  fallback_chain: string[];
  score_summary: string;
  route_proof_hash: string;
}
