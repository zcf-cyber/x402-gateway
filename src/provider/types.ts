import type { ChatCompletionRequest } from '../types.js';

/** Normalized response from any upstream LLM provider */
export interface UpstreamResponse {
  model_used: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    /** OpenAI-compatible: prompt_tokens_details from upstream response */
    prompt_tokens_details?: {
      cached_tokens?: number;
      audio_tokens?: number;
    };
  };
  latency_ms: number;
}

/** Error shape returned by upstream providers */
export interface ProviderError {
  provider: string;
  statusCode: number;
  message: string;
}

/** Abstract interface for upstream model adapters */
export interface ProviderAdapter {
  readonly providerId: string;

  /** Send a chat completion request to the upstream provider */
  execute(request: ChatCompletionRequest, modelId: string): Promise<UpstreamResponse>;

  /** Check if the provider is reachable */
  healthCheck(): Promise<boolean>;
}
