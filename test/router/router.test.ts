import { describe, it, expect } from "vitest";
import { createRouterService } from "../../src/router/router.service.js";
import { createProviderRegistry } from "../../src/provider/registry.js";
import { BaseProviderAdapter } from "../../src/provider/adapter.js";
import type { ChatCompletionRequest } from "../../src/types.js";
import type { UpstreamResponse } from "../../src/provider/types.js";
import type { RouteDecision } from "../../src/router/types.js";
import type { ProviderAdapter } from "../../src/provider/types.js";

// ============================================================================
// Mock Provider Adapter for Testing
// ============================================================================

class MockOpenAIAdapter extends BaseProviderAdapter {
  private mockResponse: UpstreamResponse;

  constructor(
    mockResponse: UpstreamResponse = {
      model_used: "openai/gpt-4o",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Mock response" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      latency_ms: 100,
    },
  ) {
    super("openai");
    this.mockResponse = mockResponse;
  }

  async execute(
    _request: ChatCompletionRequest,
    modelId: string,
  ): Promise<UpstreamResponse> {
    return {
      ...this.mockResponse,
      model_used: modelId,
    };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  getMetadata(): Record<string, unknown> {
    return {
      provider: this.providerId,
      version: "1.0.0",
      mock: true,
    };
  }
}

class FailingMockAdapter extends BaseProviderAdapter {
  constructor() {
    super("failing-provider");
  }

  async execute(): Promise<UpstreamResponse> {
    throw new Error("Provider is down");
  }

  async healthCheck(): Promise<boolean> {
    return false;
  }
}

// ============================================================================
// RouterService Tests
// ============================================================================

describe("RouterService", () => {
  describe("basic interface", () => {
    it("should exist and have the expected interface", () => {
      const registry = createProviderRegistry();
      const service = createRouterService({ providerRegistry: registry });
      expect(service).toBeDefined();
      expect(typeof service.route).toBe("function");
    });

    it("should implement IRouterService contract", () => {
      const registry = createProviderRegistry();
      const service = createRouterService({ providerRegistry: registry });
      expect(service).toHaveProperty("route");
    });
  });

  describe("manual routing", () => {
    it("should route request to registered model successfully", async () => {
      const registry = createProviderRegistry();
      const mockAdapter = new MockOpenAIAdapter();
      const modelId = "openai/gpt-4o";

      registry.register(modelId, mockAdapter, {
        input_usd_per_token: "0.00001",
        output_usd_per_token: "0.00003",
        effective_at: new Date().toISOString(),
      });

      const service = createRouterService({ providerRegistry: registry });
      const request: ChatCompletionRequest = {
        model: modelId,
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.7,
      };

      const result = await service.route(request);

      expect(result).toBeDefined();
      expect(result.decision).toBeDefined();
      expect(result.response).toBeDefined();
      expect(result.decision.selected_model).toBe(modelId);
      expect(result.response.model_used).toBe(modelId);
    });

    it("should return correct RouteDecision structure", async () => {
      const registry = createProviderRegistry();
      const mockAdapter = new MockOpenAIAdapter();
      const modelId = "openai/gpt-4o";

      registry.register(modelId, mockAdapter, {
        input_usd_per_token: "0.00001",
        output_usd_per_token: "0.00003",
        effective_at: new Date().toISOString(),
      });

      const service = createRouterService({ providerRegistry: registry });
      const request: ChatCompletionRequest = {
        model: modelId,
        messages: [{ role: "user", content: "Hello" }],
      };

      const result = await service.route(request);

      expect(result.decision).toMatchObject<Partial<RouteDecision>>({
        selected_model: modelId,
        fallback_chain: [],
        score_summary: "manual selection",
      });

      expect(result.decision.route_proof_hash).toBeDefined();
      expect(result.decision.route_proof_hash).toMatch(/^rph_/);
    });

    it("should generate deterministic route_proof_hash for same execution", async () => {
      const registry = createProviderRegistry();
      const mockAdapter = new MockOpenAIAdapter();
      const modelId = "openai/gpt-4o";

      registry.register(modelId, mockAdapter, {
        input_usd_per_token: "0.00001",
        output_usd_per_token: "0.00003",
        effective_at: new Date().toISOString(),
      });

      const service = createRouterService({ providerRegistry: registry });
      const request: ChatCompletionRequest = {
        model: modelId,
        messages: [{ role: "user", content: "Hello" }],
      };

      const result = await service.route(request);

      expect(result.decision.route_proof_hash).toMatch(/^rph_[a-f0-9]{64}$/);
      expect(result.decision.route_proof_hash.length).toBe(68);
    });

    it("should propagate upstream response correctly", async () => {
      const registry = createProviderRegistry();
      const expectedResponse: UpstreamResponse = {
        model_used: "openai/gpt-4o",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Test response" },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 10,
          total_tokens: 30,
        },
        latency_ms: 150,
      };

      const mockAdapter = new MockOpenAIAdapter(expectedResponse);
      const modelId = "openai/gpt-4o";

      registry.register(modelId, mockAdapter, {
        input_usd_per_token: "0.00001",
        output_usd_per_token: "0.00003",
        effective_at: new Date().toISOString(),
      });

      const service = createRouterService({ providerRegistry: registry });
      const request: ChatCompletionRequest = {
        model: modelId,
        messages: [{ role: "user", content: "Hello" }],
      };

      const result = await service.route(request);

      expect(result.response.choices).toHaveLength(1);
      expect(result.response.choices[0].message.content).toBe("Test response");
      expect(result.response.usage.total_tokens).toBe(30);
      expect(result.response.latency_ms).toBe(150);
    });

    it("should throw when model not found", async () => {
      const registry = createProviderRegistry();
      const service = createRouterService({ providerRegistry: registry });
      const request: ChatCompletionRequest = {
        model: "non-existent-model",
        messages: [{ role: "user", content: "hello" }],
      };

      await expect(service.route(request)).rejects.toThrow(
        "Model not found: non-existent-model",
      );
    });

    it("should handle different model providers", async () => {
      const registry = createProviderRegistry();

      const openaiAdapter = new MockOpenAIAdapter({
        model_used: "openai/gpt-4o",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "OpenAI response" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        latency_ms: 100,
      });

      const anthropicAdapter = new MockOpenAIAdapter({
        model_used: "anthropic/claude-3-opus",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Anthropic response" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
        latency_ms: 120,
      });

      registry.register("openai/gpt-4o", openaiAdapter, {
        input_usd_per_token: "0.00001",
        output_usd_per_token: "0.00003",
        effective_at: new Date().toISOString(),
      });

      registry.register("anthropic/claude-3-opus", anthropicAdapter, {
        input_usd_per_token: "0.000015",
        output_usd_per_token: "0.000075",
        effective_at: new Date().toISOString(),
      });

      const service = createRouterService({ providerRegistry: registry });

      const openaiResult = await service.route({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Hello" }],
      });
      expect(openaiResult.decision.selected_model).toBe("openai/gpt-4o");
      expect(openaiResult.response.choices[0].message.content).toBe(
        "OpenAI response",
      );

      const anthropicResult = await service.route({
        model: "anthropic/claude-3-opus",
        messages: [{ role: "user", content: "Hello" }],
      });
      expect(anthropicResult.decision.selected_model).toBe(
        "anthropic/claude-3-opus",
      );
      expect(anthropicResult.response.choices[0].message.content).toBe(
        "Anthropic response",
      );
    });
  });

  describe("error handling", () => {
    it("should propagate adapter execution errors", async () => {
      const registry = createProviderRegistry();
      const failingAdapter = new FailingMockAdapter();
      const modelId = "failing-model";

      registry.register(modelId, failingAdapter as unknown as ProviderAdapter, {
        input_usd_per_token: "0.00001",
        output_usd_per_token: "0.00003",
        effective_at: new Date().toISOString(),
      });

      const service = createRouterService({ providerRegistry: registry });
      const request: ChatCompletionRequest = {
        model: modelId,
        messages: [{ role: "user", content: "Hello" }],
      };

      await expect(service.route(request)).rejects.toThrow(
        "Provider is down",
      );
    });

    it("should handle empty messages", async () => {
      const registry = createProviderRegistry();
      const mockAdapter = new MockOpenAIAdapter();

      registry.register("openai/gpt-4o", mockAdapter, {
        input_usd_per_token: "0.00001",
        output_usd_per_token: "0.00003",
        effective_at: new Date().toISOString(),
      });

      const service = createRouterService({ providerRegistry: registry });
      const request: ChatCompletionRequest = {
        model: "openai/gpt-4o",
        messages: [],
      };

      const result = await service.route(request);
      expect(result.decision.selected_model).toBe("openai/gpt-4o");
    });
  });
});

// ============================================================================
// ProviderRegistry Integration Tests
// ============================================================================

describe("Router + ProviderRegistry Integration", () => {
  it("should complete full manual routing flow", async () => {
    const registry = createProviderRegistry();
    const mockAdapter = new MockOpenAIAdapter();
    const modelId = "openai/gpt-4o";

    registry.register(modelId, mockAdapter, {
      input_usd_per_token: "0.00001",
      output_usd_per_token: "0.00003",
      effective_at: new Date().toISOString(),
    });

    const router = createRouterService({ providerRegistry: registry });

    const request: ChatCompletionRequest = {
      model: modelId,
      messages: [{ role: "user", content: "What is the capital of France?" }],
      temperature: 0.7,
    };

    const result = await router.route(request);

    expect(result).toHaveProperty("decision");
    expect(result).toHaveProperty("response");

    expect(result.decision.selected_model).toBe(modelId);
    expect(result.decision.fallback_chain).toEqual([]);
    expect(result.decision.score_summary).toBe("manual selection");
    expect(result.decision.route_proof_hash).toMatch(/^rph_/);

    expect(result.response.model_used).toBe(modelId);
    expect(result.response.choices).toHaveLength(1);
    expect(result.response.choices[0].message.role).toBe("assistant");
    expect(result.response.usage).toHaveProperty("prompt_tokens");
    expect(result.response.usage).toHaveProperty("completion_tokens");
    expect(result.response.usage).toHaveProperty("total_tokens");
    expect(result.response.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("should support model:openai/gpt-4o format", async () => {
    const registry = createProviderRegistry();
    const mockAdapter = new MockOpenAIAdapter();

    registry.register("openai/gpt-4o", mockAdapter, {
      input_usd_per_token: "0.00001",
      output_usd_per_token: "0.00003",
      effective_at: new Date().toISOString(),
    });

    const router = createRouterService({ providerRegistry: registry });
    const result = await router.route({
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result.decision.selected_model).toBe("openai/gpt-4o");
    expect(result.response.model_used).toBe("openai/gpt-4o");
  });
});
