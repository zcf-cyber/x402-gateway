import type { ChatCompletionRequest } from "../types.js";
import { BaseProviderAdapter } from "./adapter.js";
import type { UpstreamResponse } from "./types.js";
import {
  UpstreamTimeoutError,
  UpstreamUnavailableError,
  InternalError,
} from "../errors.js";

/**
 * OpenAI API response structure
 */
interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
      audio_tokens?: number;
    };
  };
}

/**
 * OpenAI-compatible upstream adapter.
 * Covers OpenAI, Anthropic (via compatible endpoints), and any other
 * providers that expose an OpenAI-compatible chat completions API.
 */
export class OpenAIAdapter extends BaseProviderAdapter {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    apiKey: string,
    baseUrl = "https://api.openai.com/v1",
    timeoutMs = 60000,
  ) {
    super("openai");
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.timeoutMs = timeoutMs;
  }

  /**
   * Send a chat completion request to the OpenAI-compatible endpoint.
   * Maps the response into the normalized UpstreamResponse shape.
   * Maps network/timeout errors to UpstreamTimeoutError / UpstreamUnavailableError.
   */
  async execute(
    request: ChatCompletionRequest,
    modelId: string,
  ): Promise<UpstreamResponse> {
    const startTime = Date.now();

    // Build request payload
    const payload = {
      model: modelId,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      stream: false,
    };

    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle HTTP errors
      if (!response.ok) {
        const errorText = await response.text();

        // Map specific error codes
        if (response.status === 408 || response.status === 504) {
          throw new UpstreamTimeoutError(this.providerId);
        }

        if (
          response.status === 503 ||
          response.status === 502 ||
          response.status === 500
        ) {
          throw new UpstreamUnavailableError(this.providerId);
        }

        // Other errors
        throw new InternalError(
          `OpenAI API error: ${response.status} - ${errorText}`,
        );
      }

      // Parse response
      const data = (await response.json()) as OpenAIResponse;
      const latencyMs = Date.now() - startTime;

      // Validate response structure
      if (!data.choices || data.choices.length === 0) {
        throw new InternalError("Invalid response from OpenAI: no choices");
      }

      if (!data.usage) {
        throw new InternalError("Invalid response from OpenAI: missing usage");
      }

      // Return normalized response
      return {
        model_used: data.model,
        choices: data.choices.map((choice) => ({
          index: choice.index,
          message: {
            role: choice.message.role,
            content: choice.message.content,
          },
          finish_reason: choice.finish_reason,
        })),
        usage: {
          prompt_tokens: data.usage.prompt_tokens,
          completion_tokens: data.usage.completion_tokens,
          total_tokens: data.usage.total_tokens,
          prompt_tokens_details: data.usage.prompt_tokens_details,
        },
        latency_ms: latencyMs,
      };
    } catch (error) {
      // Re-throw known errors
      if (
        error instanceof UpstreamTimeoutError ||
        error instanceof UpstreamUnavailableError ||
        error instanceof InternalError
      ) {
        throw error;
      }

      // Handle timeout/abort errors
      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw new UpstreamTimeoutError(this.providerId);
        }

        // Network errors
        if (
          error.message.includes("ECONNREFUSED") ||
          error.message.includes("ENOTFOUND") ||
          error.message.includes("ETIMEDOUT")
        ) {
          throw new UpstreamUnavailableError(this.providerId);
        }
      }

      // Unknown errors
      throw new InternalError(
        `Unexpected error calling OpenAI: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Health check: verify the upstream endpoint is reachable.
   * Makes a lightweight request to /v1/models endpoint.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout for health check

      const response = await fetch(`${this.baseUrl}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      return response.ok;
    } catch {
      return false;
    }
  }
}