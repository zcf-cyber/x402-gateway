import type { LedgerEntry } from "./types.js";

/**
 * Dependencies for LedgerService
 */
export interface LedgerServiceDeps {
  /** Function to generate unique ledger entry IDs */
  generateId: () => string;
  /** Function to get current ISO timestamp */
  getTimestamp: () => string;
  /** Optional logger for ledger operations */
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Interface for ledger service.
 * 
 * CRITICAL DESIGN PRINCIPLES:
 * 1. Append-only - never UPDATE or DELETE existing entries
 * 2. Immutable - once committed, entries are permanent
 * 3. Tamper-evident - includes request_id and quote_id for verification
 * 4. Compensation via new entries - errors are corrected by appending new entries
 * 
 * This ensures a complete audit trail for all billing transactions.
 */
export interface ILedgerService {
  /**
   * Commit a ledger entry.
   * 
   * CRITICAL: INSERT only -- never UPDATE or DELETE.
   * Ledger is append-only. Compensation uses new append entries.
   * 
   * @param entry - Ledger entry data (without id and created_at)
   * @returns Promise<LedgerEntry> - The committed entry with generated id and timestamp
   * @throws Error if persistence fails
   * 
   * @example
   * ```typescript
   * const entry = await ledgerService.commit({
   *   request_id: "req-123",
   *   quote_id: "quote-456",
   *   payer_address: "0x...",
   *   model_used: "openai/gpt-4o",
   *   usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
   *   cost: { subtotal_usd: "0.01", platform_fee_usd: "0.0005", total_usd: "0.0105", ... }
   * });
   * // entry.id = "ledger-xxx"
   * // entry.created_at = "2026-04-16T12:00:00Z"
   * ```
   */
  commit(entry: Omit<LedgerEntry, "id" | "created_at">): Promise<LedgerEntry>;

  /**
   * Query ledger by request_id.
   * Used for audit and verification of billing for specific requests.
   * 
   * @param requestId - The request ID to look up
   * @returns Promise<LedgerEntry | null> - The ledger entry or null if not found
   */
  getByRequestId(requestId: string): Promise<LedgerEntry | null>;

  /**
   * Query ledger by quote_id.
   * Used to correlate ledger entries with x402 payment challenges.
   * 
   * @param quoteId - The quote ID from x402 payment challenge
   * @returns Promise<LedgerEntry | null> - The ledger entry or null if not found
   */
  getByQuoteId(quoteId: string): Promise<LedgerEntry | null>;

  /**
   * Get all ledger entries (for reporting and auditing).
   * 
   * @returns Promise<LedgerEntry[]> - Array of all ledger entries
   */
  getAll(): Promise<LedgerEntry[]>;

  /**
   * Create a compensation entry for an error correction.
   * 
   * When an error is discovered in a previous entry, do NOT modify it.
   * Instead, append a new compensation entry that offsets the error.
   * 
   * @param originalEntryId - ID of the original entry being corrected
   * @param correction - Correction details
   * @returns Promise<LedgerEntry> - The compensation entry
   */
  compensate(
    originalEntryId: string,
    correction: {
      reason: string;
      adjusted_cost: Omit<LedgerEntry["cost"], "unit_price_input" | "unit_price_output">;
    }
  ): Promise<LedgerEntry>;
}

/**
 * Generate a unique ledger entry ID.
 * Uses timestamp + random suffix for uniqueness.
 */
function generateLedgerId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `ledger-${timestamp}-${random}`;
}

/**
 * Get current ISO timestamp.
 */
function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Create a LedgerService instance.
 * 
 * Implementation follows append-only ledger principles:
 * - All entries are immutable once committed
 * - No UPDATE or DELETE operations
 * - Errors are corrected via compensation entries
 * 
 * @param deps - Optional service dependencies
 * @returns ILedgerService implementation
 */
export function createLedgerService(deps?: Partial<LedgerServiceDeps>): ILedgerService {
  const {
    generateId = generateLedgerId,
    getTimestamp = getCurrentTimestamp,
    log,
  } = deps || {};

  /**
   * In-memory storage for MVP stage.
   * Production environment must migrate to PostgreSQL for persistence.
   */
  const ledgerStore = new Map<string, LedgerEntry>();
  const requestIndex = new Map<string, string>(); // request_id -> entry_id
  const quoteIndex = new Map<string, string>();   // quote_id -> entry_id

  async function commit(
    entry: Omit<LedgerEntry, "id" | "created_at">
  ): Promise<LedgerEntry> {
    // Validate required fields
    if (!entry.request_id) {
      throw new Error("request_id is required");
    }
    if (!entry.quote_id) {
      throw new Error("quote_id is required");
    }
    if (!entry.payer_address) {
      throw new Error("payer_address is required");
    }
    if (!entry.model_used) {
      throw new Error("model_used is required");
    }
    if (!entry.usage) {
      throw new Error("usage is required");
    }
    if (!entry.cost) {
      throw new Error("cost is required");
    }

    // Check for duplicate request_id (idempotency)
    if (requestIndex.has(entry.request_id)) {
      throw new Error(
        `Ledger entry already exists for request_id: ${entry.request_id}`
      );
    }

    // Generate unique ID and timestamp
    const id = generateId();
    const created_at = getTimestamp();

    // Build complete entry
    const ledgerEntry: LedgerEntry = {
      id,
      request_id: entry.request_id,
      quote_id: entry.quote_id,
      payer_address: entry.payer_address,
      model_used: entry.model_used,
      usage: entry.usage,
      cost: entry.cost,
      created_at,
    };

    // Persist to storage (simulated)
    ledgerStore.set(id, ledgerEntry);
    requestIndex.set(entry.request_id, id);
    quoteIndex.set(entry.quote_id, id);

    // Log if logger provided
    if (log) {
      log("Ledger entry committed", {
        id,
        request_id: entry.request_id,
        quote_id: entry.quote_id,
        total_usd: entry.cost.total_usd,
      });
    }

    return ledgerEntry;
  }

  async function getByRequestId(requestId: string): Promise<LedgerEntry | null> {
    const entryId = requestIndex.get(requestId);
    if (!entryId) {
      return null;
    }
    return ledgerStore.get(entryId) || null;
  }

  async function getByQuoteId(quoteId: string): Promise<LedgerEntry | null> {
    const entryId = quoteIndex.get(quoteId);
    if (!entryId) {
      return null;
    }
    return ledgerStore.get(entryId) || null;
  }

  async function getAll(): Promise<LedgerEntry[]> {
    return Array.from(ledgerStore.values()).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }

  async function compensate(
    originalEntryId: string,
    correction: {
      reason: string;
      adjusted_cost: Omit<LedgerEntry["cost"], "unit_price_input" | "unit_price_output">;
    }
  ): Promise<LedgerEntry> {
    // Get original entry
    const originalEntry = ledgerStore.get(originalEntryId);
    if (!originalEntry) {
      throw new Error(`Original entry not found: ${originalEntryId}`);
    }

    // Create compensation entry (append-only)
    const compensationEntry: Omit<LedgerEntry, "id" | "created_at"> = {
      request_id: `${originalEntry.request_id}-compensation`,
      quote_id: `${originalEntry.quote_id}-compensation`,
      payer_address: originalEntry.payer_address,
      model_used: originalEntry.model_used,
      usage: {
        ...originalEntry.usage,
        request_id: `${originalEntry.request_id}-compensation` as LedgerEntry["usage"]["request_id"],
      },
      cost: {
        ...correction.adjusted_cost,
        unit_price_input: originalEntry.cost.unit_price_input,
        unit_price_output: originalEntry.cost.unit_price_output,
      },
    };

    // Log compensation
    if (log) {
      log("Ledger compensation entry created", {
        original_entry_id: originalEntryId,
        reason: correction.reason,
        original_total: originalEntry.cost.total_usd,
        adjusted_total: correction.adjusted_cost.total_usd,
      });
    }

    return commit(compensationEntry);
  }

  return {
    commit,
    getByRequestId,
    getByQuoteId,
    getAll,
    compensate,
  };
}

/**
 * Ledger entry validation result.
 */
export interface LedgerValidationResult {
  /** Whether the entry is valid */
  valid: boolean;
  /** List of validation errors */
  errors: string[];
}

/**
 * Validate a ledger entry.
 * 
 * @param entry - Ledger entry to validate
 * @returns Validation result
 */
export function validateLedgerEntry(
  entry: Partial<LedgerEntry>
): LedgerValidationResult {
  const errors: string[] = [];

  if (!entry.id) {
    errors.push("id is required");
  }
  if (!entry.request_id) {
    errors.push("request_id is required");
  }
  if (!entry.quote_id) {
    errors.push("quote_id is required");
  }
  if (!entry.payer_address) {
    errors.push("payer_address is required");
  }
  if (!entry.model_used) {
    errors.push("model_used is required");
  }
  if (!entry.usage) {
    errors.push("usage is required");
  } else {
    if (entry.usage.prompt_tokens < 0) {
      errors.push("usage.prompt_tokens cannot be negative");
    }
    if (entry.usage.completion_tokens < 0) {
      errors.push("usage.completion_tokens cannot be negative");
    }
  }
  if (!entry.cost) {
    errors.push("cost is required");
  } else {
    if (parseFloat(entry.cost.total_usd) < 0) {
      errors.push("cost.total_usd cannot be negative");
    }
  }
  if (!entry.created_at) {
    errors.push("created_at is required");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}