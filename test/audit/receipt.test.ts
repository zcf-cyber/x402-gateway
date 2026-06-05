import { describe, it, expect, beforeEach } from "vitest";
import { createTraceService } from "../../src/audit/trace.service.js";
import { createLedgerService } from "../../src/billing/ledger.service.js";
import { createReceiptService } from "../../src/audit/receipt.service.js";
import type { RequestId } from "../../src/types.js";

// Helper to create consistent test data
const createTestCompleteData = () => ({
  selectedModel: "openai/gpt-4o",
  fallbackChain: [] as string[],
  scoreSummary: "Selected: openai/gpt-4o",
  promptTokens: 100,
  completionTokens: 50,
  totalTokens: 150,
  subtotalUsd: "0.01",
  platformFeeUsd: "0.0005",
  totalUsd: "0.0105",
  quoteId: "quote-test",
  chain: "ethereum",
  asset: "USDC",
  payerAddress: "0x1234567890abcdef",
  latencyMs: 100,
});

const createTestLedgerEntry = (requestId: RequestId, quoteId: string) => ({
  request_id: requestId,
  quote_id: quoteId,
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

describe("ReceiptService", () => {
  let traceService: ReturnType<typeof createTraceService>;
  let ledgerService: ReturnType<typeof createLedgerService>;
  let receiptService: ReturnType<typeof createReceiptService>;


  beforeEach(() => {
    traceService = createTraceService();
    ledgerService = createLedgerService();
    receiptService = createReceiptService({ traceService, ledgerService });
  });

  describe("getByRequestId", () => {
    it("should return null for non-existent request", async () => {
      const result = await receiptService.getByRequestId("non-existent" as RequestId);
      expect(result).toBeNull();
    });


    it("should return null when trace exists but is incomplete", async () => {
      const requestId = "req-incomplete" as RequestId;
      await traceService.startTrace(requestId, "hash123");
      const result = await receiptService.getByRequestId(requestId);
      expect(result).toBeNull();
    });

    it("should return audit record when trace is completed", async () => {
      const requestId = "req-complete" as RequestId;
      await traceService.startTrace(requestId, "hash123");
      await traceService.completeTrace(requestId, createTestCompleteData());
      const result = await receiptService.getByRequestId(requestId);
      expect(result).not.toBeNull();
      expect(result?.request_id).toBe(requestId);
      expect(result?.route_decision.selected_model).toBe("openai/gpt-4o");
      expect(result?.usage.total_tokens).toBe(150);
      expect(result?.cost.total_usd).toBe("0.0105");
    });

    it("should return audit record with fallback chain", async () => {
      const requestId = "req-fallback" as RequestId;
      await traceService.startTrace(requestId, "hash456");
      await traceService.completeTrace(requestId, {
        ...createTestCompleteData(),
        selectedModel: "openai/gpt-4o-mini",
        fallbackChain: ["anthropic/claude-3"],
        scoreSummary: "Selected: openai/gpt-4o-mini | Fallbacks tried: anthropic/claude-3",
        promptTokens: 80,
        completionTokens: 40,
        totalTokens: 120,
      });
      const result = await receiptService.getByRequestId(requestId);
      expect(result).not.toBeNull();
      expect(result?.route_decision.fallback_chain).toEqual(["anthropic/claude-3"]);
    });


    it("should return audit record even when ledger entry is missing", async () => {
      const requestId = "req-no-ledger" as RequestId;
      await traceService.startTrace(requestId, "hash789");
      await traceService.completeTrace(requestId, createTestCompleteData());
      const result = await receiptService.getByRequestId(requestId);
      expect(result).not.toBeNull();
      expect(result?.request_id).toBe(requestId);
    });
  });


  describe("hasReceipt", () => {
    it("should return false for non-existent request", async () => {
      const result = await receiptService.hasReceipt("non-existent" as RequestId);
      expect(result).toBe(false);
    });


    it("should return false when trace exists but ledger entry missing", async () => {
      const requestId = "req-no-ledger" as RequestId;
      await traceService.startTrace(requestId, "hash789");
      await traceService.completeTrace(requestId, createTestCompleteData());
      const result = await receiptService.hasReceipt(requestId);
      expect(result).toBe(false);
    });

    it("should return false when trace is pending", async () => {
      const requestId = "req-pending" as RequestId;
      await traceService.startTrace(requestId, "hash000");
      const result = await receiptService.hasReceipt(requestId);
      expect(result).toBe(false);
    });


    it("should return false when trace is failed", async () => {
      const requestId = "req-failed" as RequestId;
      await traceService.startTrace(requestId, "hash-fail");
      await traceService.failTrace(requestId, "Upstream timeout");
      const result = await receiptService.hasReceipt(requestId);
      expect(result).toBe(false);
    });

    it("should return true when both trace and ledger entry exist", async () => {
      const requestId = "req-full" as RequestId;
      await traceService.startTrace(requestId, "hash111");
      await traceService.completeTrace(requestId, { ...createTestCompleteData(), quoteId: "quote-full" });
      await ledgerService.commit(createTestLedgerEntry(requestId, "quote-full"));
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
      const requestId1 = "req-list-1" as RequestId;
      await traceService.startTrace(requestId1, "hash-list-1");
      await traceService.completeTrace(requestId1, { ...createTestCompleteData(), quoteId: "quote-list-1" });
      await ledgerService.commit(createTestLedgerEntry(requestId1, "quote-list-1"));

      const requestId2 = "req-list-2" as RequestId;
      await traceService.startTrace(requestId2, "hash-list-2");
      await traceService.completeTrace(requestId2, { ...createTestCompleteData(), selectedModel: "openai/gpt-4o-mini", quoteId: "quote-list-2" });
      await ledgerService.commit(createTestLedgerEntry(requestId2, "quote-list-2"));
      const result = await receiptService.listReceipts(10);
      expect(result).toContain("req-list-1");
      expect(result).toContain("req-list-2");
    });

    it("should respect limit parameter", async () => {
      for (let i = 0; i < 3; i++) {
        const requestId = `req-limit-${i}` as RequestId;
        await traceService.startTrace(requestId, `hash-limit-${i}`);
        await traceService.completeTrace(requestId, { ...createTestCompleteData(), quoteId: `quote-limit-${i}` });
        await ledgerService.commit(createTestLedgerEntry(requestId, `quote-limit-${i}`));
      }
      const result = await receiptService.listReceipts(2);
      expect(result).toHaveLength(2);
    });

    it("should not include incomplete traces", async () => {
      const completeId = "req-complete-for-list" as RequestId;
      await traceService.startTrace(completeId, "hash-complete");
      await traceService.completeTrace(completeId, { ...createTestCompleteData(), quoteId: "quote-complete-list" });
      await ledgerService.commit(createTestLedgerEntry(completeId, "quote-complete-list"));
      const pendingId = "req-pending-for-list" as RequestId;
      await traceService.startTrace(pendingId, "hash-pending");
      const result = await receiptService.listReceipts(10);
      expect(result).toContain("req-complete-for-list");
      expect(result).not.toContain("req-pending-for-list");
    });

    it("should not include failed traces", async () => {
      const completeId = "req-complete-failed-test" as RequestId;
      await traceService.startTrace(completeId, "hash-complete-failed");
      await traceService.completeTrace(completeId, { ...createTestCompleteData(), quoteId: "quote-complete-failed" });
      await ledgerService.commit(createTestLedgerEntry(completeId, "quote-complete-failed"));
      const failedId = "req-failed-for-list" as RequestId;
      await traceService.startTrace(failedId, "hash-failed");
      await traceService.failTrace(failedId, "Upstream error");
      const result = await receiptService.listReceipts(10);
      expect(result).toContain("req-complete-failed-test");
      expect(result).not.toContain("req-failed-for-list");
    });
  });
});

describe("TraceService", () => {
  let traceService: ReturnType<typeof createTraceService>;


  beforeEach(() => {
    traceService = createTraceService();
  });


  describe("startTrace and completeTrace", () => {
    it("should create trace with pending status", async () => {
      const requestId = "req-pending-test" as RequestId;
      await traceService.startTrace(requestId, "hash123");
      const trace = await traceService.getTrace(requestId);
      expect(trace).not.toBeNull();
      expect(trace?.status).toBe("pending");
      expect(trace?.request_hash).toBe("hash123");
    });

    it("should complete trace with full audit data", async () => {
      const requestId = "req-complete-test" as RequestId;
      await traceService.startTrace(requestId, "hash456");
      await traceService.completeTrace(requestId, {
        ...createTestCompleteData(),
        selectedModel: "openai/gpt-4o",
        fallbackChain: ["anthropic/claude-3"],
        scoreSummary: "Selected: openai/gpt-4o | Fallbacks tried: anthropic/claude-3",
        promptTokens: 200,
        completionTokens: 100,
        totalTokens: 300,
        subtotalUsd: "0.02",
        platformFeeUsd: "0.001",
        totalUsd: "0.021",
      });
      const auditRecord = await traceService.getAuditRecord(requestId);
      expect(auditRecord).not.toBeNull();
      expect(auditRecord?.route_decision.selected_model).toBe("openai/gpt-4o");
      expect(auditRecord?.route_decision.fallback_chain).toEqual(["anthropic/claude-3"]);
      expect(auditRecord?.usage.total_tokens).toBe(300);
      expect(auditRecord?.cost.total_usd).toBe("0.021");
      expect(auditRecord?.payment.chain).toBe("ethereum");
    });


    it("should throw error when completing non-existent trace", async () => {
      const requestId = "req-not-exist" as RequestId;
      await expect(traceService.completeTrace(requestId, createTestCompleteData())).rejects.toThrow(`Trace not found for request_id: ${requestId}`);
    });
  });

  describe("failTrace", () => {
    it("should mark trace as failed with reason", async () => {
      const requestId = "req-fail-test" as RequestId;
      await traceService.startTrace(requestId, "hash789");
      await traceService.failTrace(requestId, "Upstream timeout");
      const trace = await traceService.getTrace(requestId);
      expect(trace).not.toBeNull();
      expect(trace?.status).toBe("failed");
    });

    it("should throw error when failing non-existent trace", async () => {
      const requestId = "req-fail-not-exist" as RequestId;
      await expect(traceService.failTrace(requestId, "Some error")).rejects.toThrow(`Trace not found for request_id: ${requestId}`);
    });
  });


  describe("getAuditRecord", () => {
    it("should return null for non-existent request", async () => {
      const result = await traceService.getAuditRecord("non-existent" as RequestId);
      expect(result).toBeNull();
    });

    it("should throw error when trace is pending", async () => {
      const requestId = "req-pending-audit" as RequestId;
      await traceService.startTrace(requestId, "hash-pending");
      await expect(traceService.getAuditRecord(requestId)).rejects.toThrow(`Trace not completed for request_id: ${requestId}`);
    });

    it("should throw error when trace is failed", async () => {
      const requestId = "req-failed-audit" as RequestId;
      await traceService.startTrace(requestId, "hash-failed");
      await traceService.failTrace(requestId, "Some error");
      await expect(traceService.getAuditRecord(requestId)).rejects.toThrow(`Trace not completed for request_id: ${requestId}`);
    });
  });

  describe("getTrace", () => {
    it("should return null for non-existent request", async () => {
      const result = await traceService.getTrace("non-existent" as RequestId);
      expect(result).toBeNull();
    });

    it("should return trace for existing request", async () => {
      const requestId = "req-exists" as RequestId;
      await traceService.startTrace(requestId, "hash-exists");
      const result = await traceService.getTrace(requestId);
      expect(result).not.toBeNull();
      expect(result?.request_id).toBe(requestId);
      expect(result?.status).toBe("pending");
    });
  });

  describe("listTraces", () => {
    it("should return empty array when no traces exist", async () => {
      const traces = await traceService.listTraces();
      expect(traces).toEqual([]);
    });

    it("should return traces in reverse chronological order", async () => {
      await traceService.startTrace("req-newest" as RequestId, "hash1");
      await traceService.startTrace("req-middle" as RequestId, "hash2");
      await traceService.startTrace("req-oldest" as RequestId, "hash3");
      const traces = await traceService.listTraces();
      expect(traces[0].request_id).toBe("req-newest");
      expect(traces[2].request_id).toBe("req-oldest");
    });

    it("should respect limit parameter", async () => {
      await traceService.startTrace("req-1" as RequestId, "hash1");
      await traceService.startTrace("req-2" as RequestId, "hash2");
      await traceService.startTrace("req-3" as RequestId, "hash3");
      const traces = await traceService.listTraces(2);
      expect(traces).toHaveLength(2);
    });
  });

  describe("clearAll", () => {
    it("should clear all traces", async () => {
      await traceService.startTrace("req-clear-1" as RequestId, "hash1");
      await traceService.startTrace("req-clear-2" as RequestId, "hash2");
      await traceService.clearAll();
      const traces = await traceService.listTraces();
      expect(traces).toEqual([]);
    });
  });
});