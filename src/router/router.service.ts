import { createHash } from "crypto";
import type { ChatCompletionRequest, RoutingMode } from "../types.js";
import type { UpstreamResponse } from "../provider/types.js";
import type { RouteDecision } from "./types.js";
import type { IProviderRegistry } from "../provider/registry.js";

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

export function createRouterService(deps: {
  providerRegistry: IProviderRegistry;
}): IRouterService {
  const { providerRegistry } = deps;

  return {
    async route(
      request: ChatCompletionRequest,
      mode: RoutingMode,
    ): Promise<{ decision: RouteDecision; response: UpstreamResponse }> {
      if (mode === "manual") {
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
      }

      // Auto mode: P1 phase not yet implemented
      // P3 will implement: PolicyEngine scoring + FallbackService execution
      throw new Error("Auto routing mode not yet implemented");
    },
  };
}