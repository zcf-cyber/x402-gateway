import { describe, it, expect, beforeEach } from "vitest";
import { createTraceService } from "../../src/audit/trace.service.js";
import { createLedgerService } from "../../src/billing/ledger.service.js";
import { createReceiptService } from "../../src/audit/receipt.service.js";
import type { RequestId } from "../../src/types.js";

describe("ReceiptService", () => {
  const traceService = createTraceService();
  const ledgerService = createLedgerService();
  const receiptService = createReceiptService({ traceService, ledgerService });

  beforeEach(async () => {
    await traceService.clearAll();
  });

  describe("getByRequestId", () => {
    it("should return null for non-existent request", async () => {
      const result = await receiptService.getByRequestId("non-existent" as RequestId);
      expect(result).toBeNull();
    });

    it("should return null when trace exists but is incomplete", async () => {
      const requestId = "req-incomplete" as RequestId;
      await traceService.startTrace(requestId, "hash123", "manual");

      const result = await receiptService.getByRequestId(requestId);
      expect(result).toBeNull();
    });

    it("should return audit record when trace is completed", async () => {
      const requestId = "req-complete" as RequestId;
      await traceService.startTrace(requestId, "hash123", "manual");
      await traceService.completeTrace(requestId, {
        selectedModel: "openai/gpt-4o",
        fallbackChain: [],
        scoreSummary: "Selected: openai/gpt-4o",
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        subtotalUsd: "0.01",
        platformFeeUsd: "0.0005",
        totalUsd: "0.0105",
        quoteId: "quote-123",
        chain: "ethereum",
        asset: "USDC",
        payerAddress: "0x1234567890abcdef",
        latencyMs: 100,
      });

      const result = await receiptService.getByRequestId(requestId);

      expect(result).not.toBeNull();
      expect(result?.request_id).toBe(requestId);
      expect(result?.route_decision.selected_model).toBe("openai/gpt-4o");
      expect(result?.usage.total_tokens).toBe(150);
      expect(result?.cost.total_usd).toBe("0.0105");
    });

    it("should return audit record with fallback chain", async () => {
      const requestId = "req-fallback" as RequestId;
      await traceService.startTrace(requestId, "hash456", "auto");
      await traceService.completeTrace(requestId, {
        selectedModel: "openai/gpt-4o-mini",
        fallbackChain: ["openai/gpt-4o", "anthropic/claude-3"],
        scoreSummary: "Selected: openai/gpt-4o-mini | Fallbacks tried: openai/gpt-4o, anthropic/claude-3",
        promptTokens: 80,
        completionTokens: 40,
        totalTokens: 120,
        subtotalUsd: "0.008",
        platformFeeUsd: "0.0004",
        totalUsd: "0.0084",
        quoteId: "quote-456",
        chain: "ethereum",
        asset: "USDC",
        payerAddress: "0xabcdef1234567890",
        latencyMs: 250,
      });

      const result = await receiptService.getByRequestId(requestId);

      expect(result).not.toBeNull();
      expect(result?.route_decision.fallback_chain).toEqual(["openai/gpt-4o", "anthropic/claude-3"]);
      expect(result?.routing_mode).toBe("auto");
    });
  });

  describe("hasReceipt", () => {
    it("should return false for non-existent request", async () => {
      const result = await receiptService.hasReceipt("non-existent" as RequestId);
      expect(result).toBe(false);
    });

    it("should return false when trace exists but ledger entry missing", async () => {
      const requestId = "req-no-ledger" as RequestId;
      await traceService.startTrace(requestId, "hash789", "manual");
      await traceService.completeTrace(requestId, {
        selectedModel: "openai/gpt-4o",
        fallbackChain: [],
        scoreSummary: "Selected: openai/gpt-4o",
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        subtotalUsd: "0.01",
        platformFeeUsd: "0.0005",
        totalUsd: "0.0105",
        quoteId: "quote-789",
        chain: "ethereum",
        asset: "USDC",
        payerAddress: "0x1234567890abcdef",
        latencyMs: 100,
      });

      const result = await receiptService.hasReceipt(requestId);
      expect(result).toBe(false);
    });

    it("should return false when trace is pending", async () => {
      const requestId = "req-pending" as RequestId;
      await traceService.startTrace(requestId, "hash000", "manual");

      const result = await receiptService.hasReceipt(requestId);
      expect(result).toBe(false);
    });

    it("should return true when both trace and ledger entry exist", async () => {
      const requestId = "req-full" as RequestId;
      await traceService.startTrace(requestId, "hash111", "manual");
      await traceService.completeTrace(requestId, {
        selectedModel: "openai/gpt-4o",
        fallbackChain: [],
        scoreSummary: "Selected: openai/gpt-4o",
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        subtotalUsd: "0.01",
        platformFeeUsd: "0.0005",
        totalUsd: "0.0105",
        quoteId: "quote-full",
        chain: "ethereum",
        asset: "USDC",
        payerAddress: "0x1234567890abcdef",
        latencyMs: 100,
      });

      // Create ledger entry
      await ledgerService.commit({
        request_id: requestId,
        quote_id: "quote-full",
        payer_address: "0x1234567890abcdef",
        model_used: "openai/gpt-4o",
        usage: {
          request_id: requestId,
          model_id: "openai/gpt-4o",
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
        cost: {
          subtotal_usd: "0.01",
          platform_fee_usd: "0.0005",
          total_usd: "0.0105",
          unit_price_input: "0.00001",
          unit_price_output: "0.00002",
        },
      });

      const result = await receiptService.hasReceipt(requestId);
      expect(result).toBe(true);
    });
  });

  describe("listReceipts", () => {
    it("should return empty array when no receipts exist", async () => {
      const result = await receiptService.listReceipts(10);
      expect(result).toEqual([]);
    });

    it("should return request IDs with complete receipts", async () => {
      // Create first complete receipt
      const requestId1 = "req-list-1" as RequestId;
      await traceService.startTrace(requestId1, "hash-list-1", "manual");
      await traceService.completeTrace(requestId1, {
        selectedModel: "openai/gpt-4o",
        fallbackChain: [],
        scoreSummary: "Selected: openai/gpt-4o",
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        subtotalUsd: "0.01",
        platformFeeUsd: "0.0005",
        totalUsd: "0.0105",
        quoteId: "quote-list-1",
        chain: "ethereum",
        asset: "USDC",
        payerAddress: "0x1234567890abcdef",
        latencyMs: 100,
      });

      await ledgerService.commit({
        request_id: requestId1,
        quote_id: "quote-list-1",
        payer_address: "0x1234567890abcdef",
        model_used: "openai/gpt-4o",
        usage: {
          request_id: requestId1,
          model_id: "openai/gpt-4o",
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
        cost: {
          subtotal_usd: "0.01",
          platform_fee_usd: "0.0005",
          total_usd: "0.0105",
          unit_price_input: "0.00001",
          unit_price_output: "0.00002",
        },
      });

      // Create second complete receipt
      const requestId2 = "req-list-2" as RequestId;
      await traceService.startTrace(requestId2, "hash-list-2", "auto");
      await traceService.completeTrace(requestId2, {
        selectedModel: "openai/gpt-4o-mini",
        fallbackChain: ["openai/gpt-4o"],
        scoreSummary: "Selected: openai/gpt-4o-mini | Fallbacks tried: openai/gpt-4o",
        promptTokens: 80,
        completionTokens: 40,
        totalTokens: 120,
        subtotalUsd: "0.008",
        platformFeeUsd: "0.0004",
        totalUsd: "0.0084",
        quoteId: "quote-list-2",
        chain: "ethereum",
        asset: "USDC",
        payerAddress: "0xabcdef1234567890",
        latencyMs: 150,
      });

      await ledgerService.commit({
        request_id: requestId2,
        quote_id: "quote-list-2",
        payer_address: "0xabcdef1234567890",
        model_used: "openai/gpt-4o-mini",
        usage: {
          request_id: requestId2,
          model_id: "openai/gpt-4o-mini",
          prompt_tokens: 80,
          completion_tokens: 40,
          total_tokens: 120,
        },
        cost: {
          subtotal_usd: "0.008",
          platform_fee_usd: "0.0004",
          total_usd: "0.0084",
          unit_price_input: "0.00001",
          unit_price_output: "0.00002",
        },
      });

      const result = await receiptService.listReceipts(10);
      expect(result).toContain("req-list-1");
      expect(result).toContain("req-list-2");
    });

    it("should respect limit parameter", async () => {
      // Create three complete receipts
      for (let i = 0; i < 3; i++) {
        const requestId = `req-limit-${i}` as RequestId;
        await traceService.startTrace(requestId, `hash-limit-${i}`, "manual");
        await traceService.completeTrace(requestId, {
          selectedModel: "openai/gpt-4o",
          fallbackChain: [],
          scoreSummary: "Selected: openai/gpt-4o",
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          subtotalUsd: "0.01",
          platformFeeUsd: "0.0005",
          totalUsd: "0.0105",
          quoteId: `quote-limit-${i}`,
          chain: "ethereum",
          asset: "USDC",
          payerAddress: "0x1234567890abcdef",
          latencyMs: 100,
        });

        await ledgerService.commit({
          request_id: requestId,
          quote_id: `quote-limit-${i}`,
          payer_address: "0x1234567890abcdef",
          model_used: "openai/gpt-4o",
          usage: {
            request_id: requestId,
            model_id: "openai/gpt-4o",
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
          },
          cost: {
            subtotal_usd: "0.01",
            platform_fee_usd: "0.0005",
            total_usd: "0.0105",
            unit_price_input: "0.00001",
            unit_price_output: "0.00002",
          },
        });
      }

      const result = await receiptService.listReceipts(2);
      expect(result).toHaveLength(2);
    });
  });
});

describe("TraceService", () => {
  describe("startTrace and completeTrace", () => {
    it("should create trace with pending status", async () => {
      const service = createTraceService();
      const requestId = "req-pending-test" as RequestId;

      await service.startTrace(requestId, "hash123", "manual");
      const trace = await service.getTrace(requestId);

      expect(trace).not.toBeNull();
      expect(trace?.status).toBe("pending");
      expect(trace?.request_hash).toBe("hash123");
      expect(trace?.routing_mode).toBe("manual");
    });

    it("should complete trace with full audit data", async () => {
      const service = createTraceService();
      const requestId = "req-complete-test" as RequestId;

      await service.startTrace(requestId, "hash456", "auto");
      await service.completeTrace(requestId, {
        selectedModel: "openai/gpt-4o",
        fallbackChain: ["anthropic/claude-3"],
        scoreSummary: "Selected: openai/gpt-4o | Fallbacks tried: anthropic/claude-3",
        promptTokens: 200,
        completionTokens: 100,
        totalTokens: 300,
        subtotalUsd: "0.02",
        platformFeeUsd: "0.001",
        totalUsd: "0.021",
        quoteId: "quote-complete",
        chain: "ethereum",
        asset: "USDC",
        payerAddress: "0xabcdef1234567890",
        latencyMs: 200,
      });

      const auditRecord = await service.getAuditRecord(requestId);

      expect(auditRecord).not.toBeNull();
      expect(auditRecord?.route_decision.selected_model).toBe("openai/gpt-4o");
      expect(auditRecord?.route_decision.fallback_chain).toEqual(["anthropic/claude-3"]);
      expect(auditRecord?.usage.total_tokens).toBe(300);
      expect(auditRecord?.cost.total_usd).toBe("0.021");
      expect(auditRecord?.payment.chain).toBe("ethereum");
    });
  });

  describe("failTrace", () => {
    it("should mark trace as failed with reason", async () => {
      const service = createTraceService();
      const requestId = "req-fail-test" as RequestId;

      await service.startTrace(requestId, "hash789", "manual");
      await service.failTrace(requestId, "Upstream timeout");

      const trace = await service.getTrace(requestId);

      expect(trace).not.toBeNull();
      expect(trace?.status).toBe("failed");
    });
  });

  describe("listTraces", () => {
    it("should return traces in reverse chronological order", async () => {
      const service = createTraceService();

      await service.startTrace("req-newest" as RequestId, "hash1", "manual");
      await service.startTrace("req-middle" as RequestId, "hash2", "manual");
      await service.startTrace("req-oldest" as RequestId, "hash3", "manual");

      const traces = await service.listTraces();

      expect(traces[0].request_id).toBe("req-newest");
      expect(traces[2].request_id).toBe("req-oldest");
    });
  });
});