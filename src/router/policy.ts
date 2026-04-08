import type { RouteCandidate, RoutingContext } from './types.js';

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
}

export function createPolicyEngine(): IPolicyEngine {
  return {
    scoreModels(_context: RoutingContext): RouteCandidate[] {
      // TODO: Implement scoring logic
      // 1. Fetch pricing for each available model
      // 2. Score by cost (lower = better), capability match, availability
      // 3. Return sorted array
      throw new Error('Not implemented');
    },

    selectBest(candidates: RouteCandidate[]): RouteCandidate {
      if (candidates.length === 0) {
        throw new Error('No candidates available');
      }
      return candidates[0]!;
    },
  };
}
