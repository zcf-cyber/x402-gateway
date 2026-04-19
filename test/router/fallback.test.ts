import { describe, it, expect, vi } from "vitest";
import { createFallbackService } from "../../src/router/fallback.service.js";
import { UpstreamUnavailableError } from "../../src/errors.js";
import type { UpstreamResponse } from "../../src/provider/types.js";

// ============================================================================
// Mock Upstream Response Factory
// ============================================================================

function createMockResponse(modelId: string): UpstreamResponse {
  return {
    model_used: modelId,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: `Response from ${modelId}` },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    latency_ms: 100,
  };
}

// ============================================================================
// FallbackService Core Tests
// ============================================================================

describe("FallbackService - Core Functionality", () => {
  describe("executeWithFallback", () => {
    it("should return first successful result without trying others", async () => {
      const service = createFallbackService();
      const attemptedModels: string[] = [];

      const executeFn = async (modelId: string): Promise<UpstreamResponse> => {
        attemptedModels.push(modelId);
        return createMockResponse(modelId);
      };

      const result = await service.executeWithFallback(
        ["model-1", "model-2", "model-3"],
        executeFn,
      );

      expect(result.modelId).toBe("model-1");
      expect(result.response.model_used).toBe("model-1");
      expect(attemptedModels).toEqual(["model-1"]);
      expect(result.stats.attempts).toBe(1);
      expect(result.stats.failedAttempts).toBe(0);
    });

    it("should fallback to second model when first fails", async () => {
      const service = createFallbackService();

      const executeFn = async (modelId: string): Promise<UpstreamResponse> => {
        if (modelId === "model-1") {
          throw new Error("Model 1 is down");
        }
        return createMockResponse(modelId);
      };

      const result = await service.executeWithFallback(
        ["model-1", "model-2"],
        executeFn,
      );

      expect(result.modelId).toBe("model-2");
      expect(result.stats.attempts).toBe(2);
      expect(result.stats.failedAttempts).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        modelId: "model-1",
        error: "Model 1 is down",
      });
    });

    it("should try entire chain until success", async () => {
      const service = createFallbackService();
      let attemptCount = 0;

      const executeFn = async (modelId: string): Promise<UpstreamResponse> => {
        attemptCount++;
        if (modelId === "model-3") {
          return createMockResponse(modelId);
        }
        throw new Error(`${modelId} failed`);
      };

      const result = await service.executeWithFallback(
        ["model-1", "model-2", "model-3"],
        executeFn,
      );

      expect(result.modelId).toBe("model-3");
      expect(attemptCount).toBe(3);
      expect(result.stats.attempts).toBe(3);
      expect(result.stats.failedAttempts).toBe(2);
    });

    it("should throw UpstreamUnavailableError when all models fail", async () => {
      const service = createFallbackService({
        fallbackDelayMs: 0, // Disable backoff for faster tests
      });

      const executeFn = async (_modelId: string): Promise<UpstreamResponse> => {
        throw new Error("Provider down");
      };

      await expect(
        service.executeWithFallback(
          ["model-a", "model-b", "model-c"],
          executeFn,
        ),
      ).rejects.toThrow(UpstreamUnavailableError);

      await expect(
        service.executeWithFallback(
          ["model-a", "model-b", "model-c"],
          executeFn,
        ),
      ).rejects.toThrow(
        "All models in fallback chain failed: model-a, model-b, model-c",
      );
    });

    it("should include all error details in final error", async () => {
      const service = createFallbackService();

      const executeFn = async (modelId: string): Promise<UpstreamResponse> => {
        throw new Error(`Error from ${modelId}`);
      };

      try {
        await service.executeWithFallback(["model-1", "model-2"], executeFn);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(UpstreamUnavailableError);
        const message = (error as Error).message;
        expect(message).toContain("model-1: Error from model-1");
        expect(message).toContain("model-2: Error from model-2");
      }
    });
  });
});

// ============================================================================
// Timeout Control Tests
// ============================================================================

describe("FallbackService - Timeout Control", () => {
  it("should respect custom timeout per attempt", async () => {
    const service = createFallbackService({ defaultTimeoutMs: 50 });

    const executeFn = async (_modelId: string): Promise<UpstreamResponse> => {
      await new Promise((resolve) => setTimeout(resolve, 100)); // 100ms > 50ms timeout
      return createMockResponse("model-1");
    };

    // Timeout error is wrapped in UpstreamUnavailableError when it's the only model
    await expect(
      service.executeWithFallback(["model-1"], executeFn),
    ).rejects.toThrow(UpstreamUnavailableError);

    // Error message should contain timeout information
    try {
      await service.executeWithFallback(["model-1"], executeFn);
    } catch (error) {
      expect((error as Error).message).toContain("timed out");
    }
  });

  it("should allow override timeout per call", async () => {
    const service = createFallbackService({ defaultTimeoutMs: 50 });

    const executeFn = async (_modelId: string): Promise<UpstreamResponse> => {
      await new Promise((resolve) => setTimeout(resolve, 30)); // 30ms < 200ms timeout
      return createMockResponse("model-1");
    };

    const result = await service.executeWithFallback(["model-1"], executeFn, {
      timeoutMs: 200,
    });

    expect(result.modelId).toBe("model-1");
  });

  it("should handle timeout with fallback to next model", async () => {
    const service = createFallbackService({ defaultTimeoutMs: 50 });

    const executeFn = async (modelId: string): Promise<UpstreamResponse> => {
      if (modelId === "slow-model") {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return createMockResponse(modelId);
    };

    const result = await service.executeWithFallback(
      ["slow-model", "fast-model"],
      executeFn,
    );

    expect(result.modelId).toBe("fast-model");
    expect(result.stats.failedAttempts).toBe(1);
    expect(result.errors[0].modelId).toBe("slow-model");
  });
});

// ============================================================================
// Backoff and Delay Tests
// ============================================================================

describe("FallbackService - Backoff Behavior", () => {
  it("should apply backoff delay between attempts", async () => {
    const service = createFallbackService({ fallbackDelayMs: 50 });
    const timestamps: number[] = [];

    const executeFn = async (modelId: string): Promise<UpstreamResponse> => {
      timestamps.push(Date.now());
      if (modelId === "model-1") {
        throw new Error("fail");
      }
      return createMockResponse(modelId);
    };

    const startTime = Date.now();
    await service.executeWithFallback(["model-1", "model-2"], executeFn);
    const totalDuration = Date.now() - startTime;

    expect(timestamps).toHaveLength(2);
    // Should have delay between attempts (at least 45ms, allowing 5ms tolerance for system load)
    expect(totalDuration).toBeGreaterThanOrEqual(45);
  });

  it("should not add delay on first attempt", async () => {
    const service = createFallbackService({ fallbackDelayMs: 100 });
    const startTime = Date.now();

    const executeFn = async (modelId: string): Promise<UpstreamResponse> => {
      return createMockResponse(modelId);
    };

    await service.executeWithFallback(["model-1"], executeFn);
    const duration = Date.now() - startTime;

    // First attempt should be fast (< 50ms)
    expect(duration).toBeLessThan(50);
  });

  it("should support disabling backoff", async () => {
    const service = createFallbackService({ fallbackDelayMs: 500 });
    const startTime = Date.now();

    const executeFn = async (modelId: string): Promise<UpstreamResponse> => {
      if (modelId === "model-1") throw new Error("fail");
      return createMockResponse(modelId);
    };

    await service.executeWithFallback(["model-1", "model-2"], executeFn, {
      useBackoff: false,
    });

    const duration = Date.now() - startTime;
    // Without backoff, should complete quickly
    expect(duration).toBeLessThan(100);
  });
});

// ============================================================================
// Execution Statistics Tests
// ============================================================================

describe("FallbackService - Execution Statistics", () => {
  it("should track individual attempt durations", async () => {
    const service = createFallbackService();

    const executeFn = async (modelId: string): Promise<UpstreamResponse> => {
      if (modelId === "model-1") {
        await new Promise((resolve) => setTimeout(resolve, 20));
        throw new Error("fail");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      return createMockResponse(modelId);
    };

    const result = await service.executeWithFallback(
      ["model-1", "model-2"],
      executeFn,
    );

    expect(result.stats.attemptDurationsMs).toHaveLength(2);
    expect(result.stats.attemptDurationsMs[0]).toBeGreaterThanOrEqual(20);
    expect(result.stats.attemptDurationsMs[1]).toBeGreaterThanOrEqual(10);
  });

  it("should track total duration", async () => {
    const service = createFallbackService();

    const executeFn = async (modelId: string): Promise<UpstreamResponse> => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (modelId === "model-1") throw new Error("fail");
      return createMockResponse(modelId);
    };

    const result = await service.executeWithFallback(
      ["model-1", "model-2"],
      executeFn,
    );

    expect(result.stats.totalDurationMs).toBeGreaterThanOrEqual(10);
    expect(result.stats.totalDurationMs).toBeGreaterThanOrEqual(
      result.stats.attemptDurationsMs[0]!,
    );
  });

  it("should calculate correct attempt count", async () => {
    const service = createFallbackService();

    const result = await service.executeWithFallback(
      ["model-1", "model-2", "model-3"],
      async (modelId) => {
        if (modelId === "model-2") return createMockResponse(modelId);
        throw new Error("fail");
      },
    );

    expect(result.stats.attempts).toBe(2);
    expect(result.stats.failedAttempts).toBe(1);
  });
});

// ============================================================================
// Error Tracking Tests
// ============================================================================

describe("FallbackService - Error Tracking", () => {
  it("should capture error messages from failed attempts", async () => {
    const service = createFallbackService();

    const result = await service.executeWithFallback(
      ["model-1", "model-2"],
      async (modelId) => {
        if (modelId === "model-1") throw new Error("Specific error message");
        return createMockResponse(modelId);
      },
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toBe("Specific error message");
  });

  it("should capture error codes when available", async () => {
    const service = createFallbackService();

    const result = await service.executeWithFallback(
      ["model-1", "model-2"],
      async (modelId) => {
        if (modelId === "model-1") {
          const error = new Error("Rate limited") as Error & { code: string };
          error.code = "RATE_LIMIT";
          throw error;
        }
        return createMockResponse(modelId);
      },
    );

    expect(result.errors[0].errorCode).toBe("RATE_LIMIT");
  });

  it("should handle non-Error throws gracefully", async () => {
    const service = createFallbackService();

    const result = await service.executeWithFallback(
      ["model-1", "model-2"],
      async (modelId) => {
        if (modelId === "model-1") throw "String error";
        return createMockResponse(modelId);
      },
    );

    expect(result.errors[0].error).toBe("String error");
  });
});

// ============================================================================
// Logging Tests
// ============================================================================

describe("FallbackService - Logging", () => {
  it("should call log function on execution start", async () => {
    const log = vi.fn();
    const service = createFallbackService({ log });

    await service.executeWithFallback(["model-1"], async () =>
      createMockResponse("model-1"),
    );

    expect(log).toHaveBeenCalledWith(
      "Starting fallback chain execution",
      expect.objectContaining({
        chainLength: 1,
        chain: "model-1",
      }),
    );
  });

  it("should call log function on success", async () => {
    const log = vi.fn();
    const service = createFallbackService({ log });

    await service.executeWithFallback(["model-1"], async () =>
      createMockResponse("model-1"),
    );

    const successCall = log.mock.calls.find(
      (call) => call[0] === "Fallback chain succeeded",
    );
    expect(successCall).toBeDefined();
    expect(successCall![1]).toMatchObject({
      modelId: "model-1",
      attempt: 1,
      failedAttempts: 0,
    });
  });

  it("should call log function on failure", async () => {
    const log = vi.fn();
    const service = createFallbackService({ log });

    await expect(
      service.executeWithFallback(["model-1"], async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow();

    const failureCall = log.mock.calls.find(
      (call) => call[0] === "Fallback attempt failed",
    );
    expect(failureCall).toBeDefined();
    expect(failureCall![1]).toMatchObject({
      modelId: "model-1",
      error: "fail",
    });
  });

  it("should call log function when chain exhausted", async () => {
    const log = vi.fn();
    const service = createFallbackService({ log });

    await expect(
      service.executeWithFallback(["model-1", "model-2"], async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow();

    const exhaustedCall = log.mock.calls.find(
      (call) => call[0] === "Fallback chain exhausted",
    );
    expect(exhaustedCall).toBeDefined();
    expect(exhaustedCall![1]).toMatchObject({
      chainLength: 2,
    });
  });

  it("should log backoff delays", async () => {
    const log = vi.fn();
    const service = createFallbackService({ log, fallbackDelayMs: 50 });

    await service.executeWithFallback(
      ["model-1", "model-2"],
      async (modelId) => {
        if (modelId === "model-1") throw new Error("fail");
        return createMockResponse(modelId);
      },
    );

    const backoffCall = log.mock.calls.find(
      (call) => call[0] === "Applying fallback backoff delay",
    );
    expect(backoffCall).toBeDefined();
    expect(backoffCall![1]).toMatchObject({
      attempt: 2,
      modelId: "model-2",
    });
  });
});

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe("FallbackService - Edge Cases", () => {
  it("should handle empty chain gracefully", async () => {
    const service = createFallbackService();

    await expect(
      service.executeWithFallback([], async () => createMockResponse("model")),
    ).rejects.toThrow("All models in fallback chain failed: (empty chain)");
  });

  it("should handle single model success", async () => {
    const service = createFallbackService();

    const result = await service.executeWithFallback(
      ["single-model"],
      async () => createMockResponse("single-model"),
    );

    expect(result.modelId).toBe("single-model");
    expect(result.stats.attempts).toBe(1);
    expect(result.stats.failedAttempts).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("should handle single model failure", async () => {
    const service = createFallbackService();

    await expect(
      service.executeWithFallback(["failing-model"], async () => {
        throw new Error("always fails");
      }),
    ).rejects.toThrow("All models in fallback chain failed: failing-model");
  });

  it("should work without optional dependencies", async () => {
    const service = createFallbackService(); // No deps

    const result = await service.executeWithFallback(["model-1"], async () =>
      createMockResponse("model-1"),
    );

    expect(result.modelId).toBe("model-1");
  });
});

// ============================================================================
// Integration Scenarios
// ============================================================================

describe("FallbackService - Integration Scenarios", () => {
  it("should handle mixed success/failure in chain", async () => {
    const service = createFallbackService();
    const executionOrder: string[] = [];

    const executeFn = async (modelId: string): Promise<UpstreamResponse> => {
      executionOrder.push(modelId);
      if (modelId === "model-2") {
        return createMockResponse(modelId);
      }
      throw new Error(`${modelId} unavailable`);
    };

    const result = await service.executeWithFallback(
      ["model-1", "model-2", "model-3"],
      executeFn,
    );

    expect(executionOrder).toEqual(["model-1", "model-2"]);
    expect(result.modelId).toBe("model-2");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].modelId).toBe("model-1");
  });

  it("should support no-charge guarantee for failed attempts", async () => {
    const service = createFallbackService();
    const successfulCharges: string[] = [];
    const attemptedCharges: string[] = [];

    const executeFn = async (modelId: string): Promise<UpstreamResponse> => {
      // Track attempted billing
      attemptedCharges.push(modelId);

      if (modelId === "model-1") {
        // Simulate billing rollback on failure
        throw new Error("fail");
      }

      // Only charge on success
      successfulCharges.push(modelId);
      return createMockResponse(modelId);
    };

    const result = await service.executeWithFallback(
      ["model-1", "model-2"],
      executeFn,
    );

    // Both models were attempted
    expect(attemptedCharges).toEqual(["model-1", "model-2"]);
    // Only successful model was actually charged
    expect(successfulCharges).toEqual(["model-2"]);
    expect(result.modelId).toBe("model-2");
  });

  it("should maintain consistent result structure regardless of fallback depth", async () => {
    const service = createFallbackService();

    // Test immediate success
    const result1 = await service.executeWithFallback(["model-1"], async () =>
      createMockResponse("model-1"),
    );
    expect(result1).toHaveProperty("modelId");
    expect(result1).toHaveProperty("response");
    expect(result1).toHaveProperty("stats");
    expect(result1).toHaveProperty("errors");

    // Test with fallback
    const result2 = await service.executeWithFallback(
      ["model-1", "model-2"],
      async (id) => {
        if (id === "model-1") throw new Error("fail");
        return createMockResponse(id);
      },
    );
    expect(result2).toHaveProperty("modelId");
    expect(result2).toHaveProperty("response");
    expect(result2).toHaveProperty("stats");
    expect(result2).toHaveProperty("errors");
  });
});
