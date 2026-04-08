import type { ChatCompletionRequest } from '../types.js';
import { BaseProviderAdapter } from './adapter.js';
import type { UpstreamResponse } from './types.js';

/**
 * OpenAI-compatible upstream adapter.
 * Covers OpenAI, Anthropic (via compatible endpoints), and any other
 * providers that expose an OpenAI-compatible chat completions API.
 */
export class OpenAIAdapter extends BaseProviderAdapter {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl = 'https://api.openai.com/v1') {
    super('openai');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  /**
   * Send a chat completion request to the OpenAI-compatible endpoint.
   * Maps the response into the normalized UpstreamResponse shape.
   * Maps network/timeout errors to UpstreamTimeoutError / UpstreamUnavailableError.
   */
  async execute(_request: ChatCompletionRequest, _modelId: string): Promise<UpstreamResponse> {
    // TODO: Implement HTTP call to upstream provider
    // 1. Build request payload (model, messages, temperature)
    // 2. POST to ${this.baseUrl}/chat/completions with Bearer ${this.apiKey}
    // 3. Parse response, extract choices and usage
    // 4. Return normalized UpstreamResponse
    void this.apiKey;
    void this.baseUrl;
    throw new Error('Not implemented');
  }

  /**
   * Health check: verify the upstream endpoint is reachable.
   */
  async healthCheck(): Promise<boolean> {
    // TODO: Implement lightweight request (e.g. GET /v1/models)
    throw new Error('Not implemented');
  }
}
