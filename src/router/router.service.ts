import { createHash } from "crypto";
import type { ChatCompletionRequest } from "../types.js";
import type { UpstreamResponse } from "../provider/types.js";
import type { RouteDecision } from "./types.js";
import type { IProviderRegistry } from "../provider/registry.js";

export interface IRouterService {
  /**
   * Route the request to the specified model using manual mode.
   * Only manual routing is supported — auto mode has been removed (Issue #71).
   *
   * 1. Look up the model adapter from the provider registry
   * 2. Execute the request via the adapter
   * 3. Build a RouteDecision with route_proof_hash
   * 4. Return both the decision metadata and the upstream response
   */
  route(
    request: ChatCompletionRequest,
  ): Promise<{ decision: RouteDecision; response: UpstreamResponse }>;
}

export function createRouterService(deps: {
  providerRegistry: IProviderRegistry;
}): IRouterService {
  const { providerRegistry } = deps;

  return {
    async route(
      request: ChatCompletionRequest,
    ): Promise<{ decision: RouteDecision; response: UpstreamResponse }> {
      // Manual mode: use the specified model directly
      const modelId = request.model;
      const adapter = providerRegistry.getAdapter(modelId);

      // Execute the request
      const response = await adapter.execute(request, modelId);

      // Build RouteDecision for manual mode
      const decision: RouteDecision = {
        selected_model: modelId,
        fallback_chain: [],
        score_summary: "manual selection",
        route_proof_hash: "", // Will be computed below
      };

      // Generate route_proof_hash (hash of decision + response)
      const hashInput = JSON.stringify({
        decision,
        response: {
          model_used: response.model_used,
          usage: response.usage,
        },
      });
      decision.route_proof_hash = `rph_${createHash("sha256").update(hashInput).digest("hex")}`;

      return { decision, response };
    },
  };
}
