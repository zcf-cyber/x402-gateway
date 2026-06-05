import { createHash } from "crypto";
import type { ChatCompletionRequest } from "../types.js";
import type { UpstreamResponse } from "../provider/types.js";
import type { RouteDecision } from "./types.js";
import type { IProviderRegistry } from "../provider/registry.js";

export interface IRouterService {
  /**
   * Route the request to the specified model.
   *
   * Only manual routing is supported. Auto model selection (PolicyEngine)
   * has been removed — it conflicts with the x402 payment contract (Issue #71).
   *
   * TODO(Issue #80): Integrate FallbackService for provider-level high-availability
   * failover. When the primary provider for a model fails, automatically retry
   * with alternate providers serving the same model (not different models).
   * This keeps the x402 payment contract intact (same model = same price).
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
      // TODO(Issue #80): After primary provider execution, on failure,
      // wrap with FallbackService.executeWithFallback() using the same
      // model's alternate provider list.
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
