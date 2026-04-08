import type { ModelInfo, ModelPricing } from '../types.js';
import type { ProviderAdapter } from './types.js';

export interface IProviderRegistry {
  /** Register a model with its adapter and pricing */
  register(modelId: string, adapter: ProviderAdapter, pricing: ModelPricing): void;

  /** Get the adapter for a specific model */
  getAdapter(modelId: string): ProviderAdapter;

  /** List all available models (used by GET /v1/models) */
  listModels(): ModelInfo[];

  /** Get pricing for a specific model */
  getModelPricing(modelId: string): ModelPricing;
}

interface ModelEntry {
  info: ModelInfo;
  adapter: ProviderAdapter;
}

/**
 * In-memory model catalog registry.
 * Models are registered at startup. DB-backed catalog is a follow-up task.
 */
export function createProviderRegistry(): IProviderRegistry {
  const models = new Map<string, ModelEntry>();

  return {
    register(modelId: string, adapter: ProviderAdapter, pricing: ModelPricing): void {
      models.set(modelId, {
        info: {
          id: modelId,
          provider: adapter.providerId,
          context_window: 128000,
          capabilities: ['chat'],
          pricing,
        },
        adapter,
      });
    },

    getAdapter(modelId: string): ProviderAdapter {
      const entry = models.get(modelId);
      if (!entry) {
        throw new Error(`Model not found: ${modelId}`);
      }
      return entry.adapter;
    },

    listModels(): ModelInfo[] {
      return Array.from(models.values()).map((e) => e.info);
    },

    getModelPricing(modelId: string): ModelPricing {
      const entry = models.get(modelId);
      if (!entry) {
        throw new Error(`Model not found: ${modelId}`);
      }
      return entry.info.pricing;
    },
  };
}
