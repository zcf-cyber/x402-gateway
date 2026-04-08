import type { ChatCompletionRequest, RoutingMode } from '../types.js';
import type { UpstreamResponse } from '../provider/types.js';
import type { RouteDecision } from './types.js';

export interface IRouterService {
  /**
   * Orchestrate the full routing flow:
   * 1. If manual mode: use the specified model directly
   * 2. If auto mode: call PolicyEngine.scoreModels -> selectBest -> build fallback chain
   * 3. Execute via FallbackService
   * 4. Generate route_proof_hash (hash of decision + actual execution)
   * 5. Return both the decision metadata and the upstream response
   */
  route(
    request: ChatCompletionRequest,
    mode: RoutingMode,
  ): Promise<{ decision: RouteDecision; response: UpstreamResponse }>;
}

export function createRouterService(_deps: {
  // Dependencies will be injected here:
  // policyEngine: IPolicyEngine
  // fallbackService: IFallbackService
  // providerRegistry: IProviderRegistry
}): IRouterService {
  return {
    async route(
      _request: ChatCompletionRequest,
      _mode: RoutingMode,
    ): Promise<{ decision: RouteDecision; response: UpstreamResponse }> {
      // TODO: Implement
      // Manual mode:
      //   1. Get adapter from registry for request.model
      //   2. Execute directly
      //   3. Build RouteDecision with empty fallback_chain
      //
      // Auto mode:
      //   1. Get available models from registry
      //   2. Score with PolicyEngine
      //   3. Build fallback chain from top candidates
      //   4. Execute via FallbackService
      //   5. Generate route_proof_hash
      //
      // Both modes:
      //   6. Return { decision, response }
      throw new Error('Not implemented');
    },
  };
}
