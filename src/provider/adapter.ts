import type { ChatCompletionRequest } from '../types.js';
import type { ProviderAdapter, UpstreamResponse } from './types.js';

export type { ProviderAdapter, UpstreamResponse };

/**
 * Abstract base providing the contract for upstream adapters.
 * Concrete adapters (OpenAI, Anthropic, etc.) implement execute() and healthCheck().
 */
export abstract class BaseProviderAdapter implements ProviderAdapter {
  constructor(public readonly providerId: string) {}

  abstract execute(request: ChatCompletionRequest, modelId: string): Promise<UpstreamResponse>;
  abstract healthCheck(): Promise<boolean>;
}
