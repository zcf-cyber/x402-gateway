import { UpstreamUnavailableError } from '../errors.js';
import type { UpstreamResponse } from '../provider/types.js';

export interface IFallbackService {
  /**
   * Try models in order, return the first successful result.
   * If all fail, throw UpstreamUnavailableError.
   *
   * CRITICAL: Must NOT double-charge. Only the successfully executed
   * model should be billed. Failed attempts are not charged.
   */
  executeWithFallback(
    chain: string[],
    executeFn: (modelId: string) => Promise<UpstreamResponse>,
  ): Promise<{ modelId: string; response: UpstreamResponse }>;
}

export function createFallbackService(): IFallbackService {
  return {
    async executeWithFallback(
      chain: string[],
      executeFn: (modelId: string) => Promise<UpstreamResponse>,
    ): Promise<{ modelId: string; response: UpstreamResponse }> {
      const errors: Error[] = [];

      for (const modelId of chain) {
        try {
          const response = await executeFn(modelId);
          return { modelId, response };
        } catch (err) {
          errors.push(err instanceof Error ? err : new Error(String(err)));
        }
      }

      throw new UpstreamUnavailableError(
        `All models in fallback chain failed: ${chain.join(', ')}`,
      );
    },
  };
}
