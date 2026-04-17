import type { RouteCandidate, RoutingContext } from "./types.js";
import type { ModelInfo } from "../types.js";

/**
 * Dependencies for PolicyEngine
 */
export interface PolicyEngineDeps {
  /** Get model catalog information */
  getModelCatalog: () => ModelInfo[];
  /** Check model availability (could check health/ping) */
  isModelAvailable?: (modelId: string) => boolean;
  /** Optional logger for policy decisions */
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Scoring weights for different factors
 * Can be adjusted based on business priorities
 */
export interface ScoringWeights {
  /** Weight for cost efficiency (lower cost = higher score) */
  costWeight: number;
  /** Weight for capability match (context window, features) */
  capabilityWeight: number;
  /** Weight for availability */
  availabilityWeight: number;
}

/**
 * Default scoring weights
 */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  costWeight: 0.5,       // 50% - cost is important
  capabilityWeight: 0.3, // 30% - capability matters
  availabilityWeight: 0.2, // 20% - availability baseline
};

export interface IPolicyEngine {
  /**
   * Score available models by cost, capability match, and availability.
   * Returns candidates sorted by score (highest first).
   */
  scoreModels(context: RoutingContext): RouteCandidate[];

  /**
   * Pick the highest-scoring candidate.
   */
  selectBest(candidates: RouteCandidate[]): RouteCandidate;

  /**
   * Build fallback chain from scored candidates.
   * Returns ordered list of model IDs for fallback execution.
   */
  buildFallbackChain(candidates: RouteCandidate[], maxLength?: number): string[];

  /**
   * Full auto-routing decision: score, select best, build fallback chain.
   * Returns complete routing decision for auto mode.
   */
  decideAutoRoute(context: RoutingContext): {
    selected: RouteCandidate;
    fallbackChain: string[];
    allCandidates: RouteCandidate[];
  };
}

/**
 * Calculate cost score (lower price = higher score)
 * Normalizes to 0-1 range based on available models
 */
function calculateCostScore(
  modelPrice: number,
  minPrice: number,
  maxPrice: number,
): number {
  if (maxPrice === minPrice) return 1; // All same price
  // Inverse: cheaper models get higher scores
  return 1 - (modelPrice - minPrice) / (maxPrice - minPrice);
}

/**
 * Calculate capability score based on context window
 * Larger context windows are scored higher
 */
function calculateCapabilityScore(contextWindow: number): number {
  // Normalize context window: 4k=0.3, 8k=0.5, 16k=0.7, 32k+=1.0
  if (contextWindow >= 32000) return 1.0;
  if (contextWindow >= 16000) return 0.7;
  if (contextWindow >= 8000) return 0.5;
  return 0.3;
}

/**
 * Create a PolicyEngine instance.
 *
 * Implements intelligent model selection based on:
 * - Cost efficiency (pricing comparison)
 * - Capability match (context window, features)
 * - Availability status
 *
 * @param deps - Service dependencies
 * @param weights - Optional scoring weights
 * @returns IPolicyEngine implementation
 */
export function createPolicyEngine(
  deps?: Partial<PolicyEngineDeps>,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): IPolicyEngine {
  // Provide defaults for backward compatibility with tests
  const {
    getModelCatalog = () => [],
    isModelAvailable,
    log,
  } = deps || {};

  return {
    scoreModels(context: RoutingContext): RouteCandidate[] {
      const catalog = getModelCatalog();

      // If no catalog configured, throw not implemented (backward compatibility)
      if (catalog.length === 0) {
        throw new Error("Not implemented");
      }

      const availableModels = catalog.filter((model) =>
        context.available_models.includes(model.id),
      );

      if (availableModels.length === 0) {
        if (log) {
          log("No available models found in catalog", {
            requestedModels: context.available_models,
            catalogSize: catalog.length,
          });
        }
        return [];
      }

      // Calculate price range for normalization
      const prices = availableModels.map(
        (m) => parseFloat(m.pricing.input_usd_per_token) +
          parseFloat(m.pricing.output_usd_per_token),
      );
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);

      // Score each model
      const candidates: RouteCandidate[] = availableModels.map((model) => {
        const totalPrice = parseFloat(model.pricing.input_usd_per_token) +
          parseFloat(model.pricing.output_usd_per_token);

        // Calculate individual scores
        const costScore = calculateCostScore(totalPrice, minPrice, maxPrice);
        const capabilityScore = calculateCapabilityScore(model.context_window);
        const availabilityRaw = isModelAvailable?.(model.id);
        const availabilityScore: number = typeof availabilityRaw === "boolean"
          ? (availabilityRaw ? 1.0 : 0.0)
          : (availabilityRaw ?? 1.0);

        // Weighted composite score (0-1 scale)
        const score =
          costScore * weights.costWeight +
          capabilityScore * weights.capabilityWeight +
          availabilityScore * weights.availabilityWeight;

        // Build reason string
        const reasons: string[] = [];
        if (costScore > 0.7) reasons.push("cost-effective");
        if (capabilityScore > 0.7) reasons.push("high-capability");
        if (availabilityScore > 0.9) reasons.push("available");
        const reason = reasons.length > 0
          ? reasons.join(", ")
          : "standard option";

        if (log) {
          log("Model scored", {
            modelId: model.id,
            score: score.toFixed(4),
            costScore: costScore.toFixed(4),
            capabilityScore: capabilityScore.toFixed(4),
            availabilityScore: availabilityScore.toFixed(4),
            totalPrice: totalPrice.toFixed(10),
          });
        }

        return {
          model_id: model.id,
          score,
          reason,
        };
      });

      // Sort by score descending
      const sorted = candidates.sort((a, b) => b.score - a.score);

      if (log) {
        log("Scoring completed", {
          modelCount: sorted.length,
          topModel: sorted[0]?.model_id,
          topScore: sorted[0]?.score.toFixed(4),
        });
      }

      return sorted;
    },

    selectBest(candidates: RouteCandidate[]): RouteCandidate {
      if (candidates.length === 0) {
        throw new Error("No candidates available");
      }
      return candidates[0]!; // Non-null: we checked length
    },

    buildFallbackChain(
      candidates: RouteCandidate[],
      maxLength: number = 3,
    ): string[] {
      // Take top N models as fallback chain
      const chain = candidates
        .slice(0, Math.min(maxLength, candidates.length))
        .map((c) => c.model_id);

      if (log) {
        log("Fallback chain built", {
          chainLength: chain.length,
          chain: chain.join(", "),
        });
      }

      return chain;
    },

    decideAutoRoute(context: RoutingContext) {
      if (log) {
        log("Starting auto-route decision", {
          requestedModel: context.requested_model,
          availableCount: context.available_models.length,
        });
      }

      // 1. Score all available models
      const candidates = this.scoreModels(context);

      if (candidates.length === 0) {
        throw new Error(
          `No available models for auto routing. ` +
            `Requested models: ${context.available_models.join(", ")}`,
        );
      }

      // 2. Select best
      const selected = this.selectBest(candidates);

      // 3. Build fallback chain (exclude selected, add next best)
      const remaining = candidates.filter((c) => c.model_id !== selected.model_id);
      const fallbackChain = this.buildFallbackChain(remaining, 2);

      if (log) {
        log("Auto-route decision completed", {
          selectedModel: selected.model_id,
          selectedScore: selected.score.toFixed(4),
          selectedReason: selected.reason,
          fallbackChainLength: fallbackChain.length,
        });
      }

      return {
        selected,
        fallbackChain,
        allCandidates: candidates,
      };
    },
  };
}
