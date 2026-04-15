import { describe, it, expect } from "vitest";
import { createRouterService } from "../../src/router/router.service.js";
import { createFallbackService } from "../../src/router/fallback.service.js";
import { createPolicyEngine } from "../../src/router/policy.js";
import { createProviderRegistry } from "../../src/provider/registry.js";

describe("RouterService", () => {
  it("should exist and have the expected interface", () => {
    const registry = createProviderRegistry();
    const service = createRouterService({ providerRegistry: registry });
    expect(service).toBeDefined();
    expect(typeof service.route).toBe("function");
  });

  it("route should throw when model not found", async () => {
    const registry = createProviderRegistry();
    const service = createRouterService({ providerRegistry: registry });
    const request = {
      model: "non-existent-model",
      messages: [{ role: "user" as const, content: "hello" }],
    };
    await expect(service.route(request, "manual")).rejects.toThrow(
      "Model not found",
    );
  });

  it("route should throw for auto mode (not yet implemented)", async () => {
    const registry = createProviderRegistry();
    const service = createRouterService({ providerRegistry: registry });
    const request = {
      model: "gpt-4",
      messages: [{ role: "user" as const, content: "hello" }],
    };
    await expect(service.route(request, "auto")).rejects.toThrow(
      "Auto routing mode not yet implemented",
    );
  });
});

describe("FallbackService", () => {
  const service = createFallbackService();

  it("should throw UpstreamUnavailableError when all models fail", async () => {
    const failFn = async (_modelId: string) => {
      throw new Error("provider down");
    };

    await expect(
      service.executeWithFallback(["model-a", "model-b"], failFn),
    ).rejects.toThrow("All models in fallback chain failed");
  });

  it("should return first successful result", async () => {
    let attempt = 0;
    const executeFn = async (modelId: string) => {
      attempt++;
      if (attempt === 1) throw new Error("first fails");
      return {
        model_used: modelId,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        latency_ms: 100,
      };
    };

    const result = await service.executeWithFallback(
      ["model-a", "model-b"],
      executeFn,
    );
    expect(result.modelId).toBe("model-b");
    expect(result.response.model_used).toBe("model-b");
  });
});

describe("PolicyEngine", () => {
  const engine = createPolicyEngine();

  it("should exist and have the expected interface", () => {
    expect(engine).toBeDefined();
    expect(typeof engine.scoreModels).toBe("function");
    expect(typeof engine.selectBest).toBe("function");
  });

  it("selectBest should throw on empty candidates", () => {
    expect(() => engine.selectBest([])).toThrow("No candidates available");
  });
});