import { describe, it, expect, vi } from "vitest";
import {
  createLedgerService,
  validateLedgerEntry,
} from "../../src/billing/ledger.service.js";
import type { LedgerEntry, UsageRecord } from "../../src/billing/types.js";
import type { RequestId } from "../../src/types.js";

describe("LedgerService", () => {
  const createTestUsage = (
    promptTokens: number,
    completionTokens: number,
  ): UsageRecord => ({
    request_id: "req-test-123" as RequestId,
    model_id: "openai/gpt-4o",
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  });

  const createTestCost = () => ({
    subtotal_usd: "0.02",
    platform_fee_usd: "0.0001",
    total_usd: "0.0201",
    unit_price_input: "0.00001",
    unit_price_output: "0.00002",
  });

  const createTestEntry = (
    requestId: string,
    quoteId: string,
  ): Omit<LedgerEntry, "id" | "created_at"> => ({
    request_id: requestId,
    quote_id: quoteId,
    payer_address: "0x1234567890abcdef",
    model_used: "openai/gpt-4o",
    usage: createTestUsage(1000, 500),
    cost: createTestCost(),
  });

  describe("commit - basic operations", () => {
    it("should commit a ledger entry with generated id and timestamp", async () => {
      const service = createLedgerService();
      const entry = createTestEntry("req-001", "quote-001");

      const result = await service.commit(entry);

      expect(result.id).toBeDefined();
      expect(result.id).toMatch(/^ledger-/);
      expect(result.created_at).toBeDefined();
      expect(result.request_id).toBe("req-001");
      expect(result.quote_id).toBe("quote-001");
      expect(result.payer_address).toBe("0x1234567890abcdef");
    });

    it("should reject duplicate request_id (idempotency)", async () => {
      const service = createLedgerService();
      const entry = createTestEntry("req-002", "quote-002");

      await service.commit(entry);

      // Try to commit same request_id again
      await expect(service.commit(entry)).rejects.toThrow(
        "Ledger entry already exists for request_id: req-002",
      );
    });

    it("should allow same quote_id with different request_id", async () => {
      const service = createLedgerService();
      const entry1 = createTestEntry("req-003", "quote-003");
      const entry2 = createTestEntry("req-004", "quote-003");

      await service.commit(entry1);
      await service.commit(entry2);

      const all = await service.getAll();
      expect(all).toHaveLength(2);
    });
  });

  describe("commit - validation", () => {
    it("should reject entry without request_id", async () => {
      const service = createLedgerService();
      const entry = {
        ...createTestEntry("req-005", "quote-005"),
        request_id: "",
      };

      await expect(service.commit(entry)).rejects.toThrow(
        "request_id is required",
      );
    });

    it("should reject entry without quote_id", async () => {
      const service = createLedgerService();
      const entry = {
        ...createTestEntry("req-006", "quote-006"),
        quote_id: "",
      };

      await expect(service.commit(entry)).rejects.toThrow(
        "quote_id is required",
      );
    });

    it("should reject entry without payer_address", async () => {
      const service = createLedgerService();
      const entry = {
        ...createTestEntry("req-007", "quote-007"),
        payer_address: "",
      };

      await expect(service.commit(entry)).rejects.toThrow(
        "payer_address is required",
      );
    });

    it("should reject entry without model_used", async () => {
      const service = createLedgerService();
      const entry = {
        ...createTestEntry("req-008", "quote-008"),
        model_used: "",
      };

      await expect(service.commit(entry)).rejects.toThrow(
        "model_used is required",
      );
    });

    it("should reject entry without usage", async () => {
      const service = createLedgerService();
      const entry = {
        ...createTestEntry("req-009", "quote-009"),
        usage: undefined as unknown as UsageRecord,
      };

      await expect(service.commit(entry)).rejects.toThrow("usage is required");
    });

    it("should reject entry without cost", async () => {
      const service = createLedgerService();
      const entry = {
        ...createTestEntry("req-010", "quote-010"),
        cost: undefined as unknown as LedgerEntry["cost"],
      };

      await expect(service.commit(entry)).rejects.toThrow("cost is required");
    });
  });

  describe("getByRequestId", () => {
    it("should return entry by request_id", async () => {
      const service = createLedgerService();
      const entry = createTestEntry("req-011", "quote-011");
      const committed = await service.commit(entry);

      const result = await service.getByRequestId("req-011");

      expect(result).toEqual(committed);
    });

    it("should return null for non-existent request_id", async () => {
      const service = createLedgerService();

      const result = await service.getByRequestId("non-existent");

      expect(result).toBeNull();
    });
  });

  describe("getByQuoteId", () => {
    it("should return entry by quote_id", async () => {
      const service = createLedgerService();
      const entry = createTestEntry("req-012", "quote-012");
      const committed = await service.commit(entry);

      const result = await service.getByQuoteId("quote-012");

      expect(result).toEqual(committed);
    });

    it("should return null for non-existent quote_id", async () => {
      const service = createLedgerService();

      const result = await service.getByQuoteId("non-existent");

      expect(result).toBeNull();
    });
  });

  describe("getAll", () => {
    it("should return all entries sorted by created_at", async () => {
      const service = createLedgerService();
      const entry1 = createTestEntry("req-013", "quote-013");
      const entry2 = createTestEntry("req-014", "quote-014");
      const entry3 = createTestEntry("req-015", "quote-015");

      await service.commit(entry1);
      await service.commit(entry2);
      await service.commit(entry3);

      const all = await service.getAll();

      expect(all).toHaveLength(3);
      // Should be sorted by created_at ascending
      expect(all[0].request_id).toBe("req-013");
      expect(all[1].request_id).toBe("req-014");
      expect(all[2].request_id).toBe("req-015");
    });

    it("should return empty array when no entries", async () => {
      const service = createLedgerService();

      const all = await service.getAll();

      expect(all).toEqual([]);
    });
  });

  describe("compensate - append-only principle", () => {
    it("should create compensation entry without modifying original", async () => {
      const service = createLedgerService();
      const entry = createTestEntry("req-016", "quote-016");
      const committed = await service.commit(entry);

      const compensation = await service.compensate(committed.id, {
        reason: "Overcharge correction",
        adjusted_cost: {
          subtotal_usd: "0.01",
          platform_fee_usd: "0.00005",
          total_usd: "0.01005",
        },
      });

      // Original entry should remain unchanged
      const original = await service.getByRequestId("req-016");
      expect(original?.cost.total_usd).toBe("0.0201");

      // Compensation entry should be new
      expect(compensation.id).not.toBe(committed.id);
      expect(compensation.request_id).toBe("req-016-compensation");
      expect(compensation.cost.total_usd).toBe("0.01005");
    });

    it("should reject compensation for non-existent entry", async () => {
      const service = createLedgerService();

      await expect(
        service.compensate("non-existent-id", {
          reason: "Test",
          adjusted_cost: {
            subtotal_usd: "0.01",
            platform_fee_usd: "0.00005",
            total_usd: "0.01005",
          },
        }),
      ).rejects.toThrow("Original entry not found: non-existent-id");
    });
  });

  describe("logging", () => {
    it("should log commit when logger is provided", async () => {
      const logger = vi.fn();
      const service = createLedgerService({ log: logger });
      const entry = createTestEntry("req-017", "quote-017");

      await service.commit(entry);

      expect(logger).toHaveBeenCalledWith(
        "Ledger entry committed",
        expect.objectContaining({
          request_id: "req-017",
          quote_id: "quote-017",
        }),
      );
    });

    it("should log compensation when logger is provided", async () => {
      const logger = vi.fn();
      const service = createLedgerService({ log: logger });
      const entry = createTestEntry("req-018", "quote-018");
      const committed = await service.commit(entry);

      await service.compensate(committed.id, {
        reason: "Test correction",
        adjusted_cost: {
          subtotal_usd: "0.01",
          platform_fee_usd: "0.00005",
          total_usd: "0.01005",
        },
      });

      expect(logger).toHaveBeenCalledWith(
        "Ledger compensation entry created",
        expect.objectContaining({
          original_entry_id: committed.id,
          reason: "Test correction",
        }),
      );
    });
  });

  describe("validateLedgerEntry", () => {
    it("should validate complete entry", () => {
      const entry: LedgerEntry = {
        id: "ledger-001",
        request_id: "req-019",
        quote_id: "quote-019",
        payer_address: "0x123",
        model_used: "gpt-4o",
        usage: createTestUsage(100, 50),
        cost: createTestCost(),
        created_at: "2026-04-17T00:00:00Z",
      };

      const result = validateLedgerEntry(entry);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect missing fields", () => {
      const entry = {} as LedgerEntry;

      const result = validateLedgerEntry(entry);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("id is required");
      expect(result.errors).toContain("request_id is required");
      expect(result.errors).toContain("quote_id is required");
      expect(result.errors).toContain("payer_address is required");
      expect(result.errors).toContain("model_used is required");
      expect(result.errors).toContain("usage is required");
      expect(result.errors).toContain("cost is required");
      expect(result.errors).toContain("created_at is required");
    });

    it("should detect negative token counts", () => {
      const entry: Partial<LedgerEntry> = {
        id: "ledger-002",
        request_id: "req-020",
        quote_id: "quote-020",
        payer_address: "0x123",
        model_used: "gpt-4o",
        usage: {
          ...createTestUsage(-1, 50),
          request_id: "req-020" as RequestId,
        },
        cost: createTestCost(),
        created_at: "2026-04-17T00:00:00Z",
      };

      const result = validateLedgerEntry(entry);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("usage.prompt_tokens cannot be negative");
    });

    it("should detect negative cost", () => {
      const entry: Partial<LedgerEntry> = {
        id: "ledger-003",
        request_id: "req-021",
        quote_id: "quote-021",
        payer_address: "0x123",
        model_used: "gpt-4o",
        usage: createTestUsage(100, 50),
        cost: { ...createTestCost(), total_usd: "-0.01" },
        created_at: "2026-04-17T00:00:00Z",
      };

      const result = validateLedgerEntry(entry);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("cost.total_usd cannot be negative");
    });
  });

  describe("custom dependencies", () => {
    it("should use custom id generator", async () => {
      const customId = "custom-ledger-id-123";
      const service = createLedgerService({
        generateId: () => customId,
        getTimestamp: () => "2026-04-17T12:00:00Z",
      });
      const entry = createTestEntry("req-022", "quote-022");

      const result = await service.commit(entry);

      expect(result.id).toBe(customId);
      expect(result.created_at).toBe("2026-04-17T12:00:00Z");
    });
  });
});
