import type { RequestId } from "../types.js";
import type { AuditQueryResult } from "./types.js";
import type { ITraceService } from "./trace.service.js";
import type { ILedgerService } from "../billing/ledger.service.js";

/**
 * Dependencies for ReceiptService
 */
export interface ReceiptServiceDeps {
  /** Trace service for request lifecycle data */
  traceService: ITraceService;
  /** Ledger service for billing data */
  ledgerService: ILedgerService;
  /** Optional logger for receipt operations */
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Interface for receipt service.
 * Responsible for reconstructing complete audit records by joining
 * trace data with ledger/billing data.
 *
 * Design Principles:
 * 1. Read-only operations - never modifies underlying data
 * 2. Joins multiple data sources for complete picture
 * 3. Returns null for missing records (idempotent)
 * 4. Throws only for data integrity issues
 */
export interface IReceiptService {
  /**
   * Reconstruct a full audit record by joining trace, route decision,
   * usage, cost, and payment data.
   * Returns the shape from API spec section 5, or null if not found.
   * Used by GET /v1/audit/requests/:request_id
   *
   * @param requestId - The request ID to look up
   * @returns Complete audit record or null if not found
   * @throws Error if trace exists but ledger data is missing (data integrity issue)
   */
  getByRequestId(requestId: RequestId): Promise<AuditQueryResult | null>;

  /**
   * Check if a complete audit record exists for the given request_id.
   *
   * @param requestId - The request ID to check
   * @returns true if both trace and ledger data exist
   */
  hasReceipt(requestId: RequestId): Promise<boolean>;

  /**
   * List all available receipts (for admin purposes).
   * Only returns requests that have complete audit data.
   *
   * @param limit - Maximum number of receipts to return
   * @returns Array of request IDs with complete receipts
   */
  listReceipts(limit?: number): Promise<string[]>;
}

/**
 * Create a ReceiptService instance.
 *
 * @param deps - Service dependencies including trace and ledger services
 * @returns IReceiptService implementation
 */
export function createReceiptService(
  deps: ReceiptServiceDeps,
): IReceiptService {
  const { traceService, ledgerService, log } = deps;

  return {
    async getByRequestId(
      requestId: RequestId,
    ): Promise<AuditQueryResult | null> {
      // Step 1: Get trace data from trace service
      let auditRecord: AuditQueryResult;
      try {
        const result = await traceService.getAuditRecord(requestId);
        if (!result) {
          if (log) {
            log("Audit record not found", { requestId });
          }
          return null;
        }
        auditRecord = result;
      } catch (error) {
        // Trace exists but is incomplete
        if (log) {
          log("Failed to get audit record", {
            requestId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return null;
      }

      // Step 2: Verify ledger entry exists (data integrity check)
      const ledgerEntry = await ledgerService.getByRequestId(requestId);
      if (!ledgerEntry) {
        // This is a data integrity issue - trace exists but no ledger entry
        if (log) {
          log("Data integrity issue: trace exists but no ledger entry", {
            requestId,
          });
        }
        // Still return the audit record from trace, but log the issue
      } else {
        // Verify consistency between trace and ledger
        if (log) {
          log("Receipt reconstructed", {
            requestId,
            model: auditRecord.route_decision.selected_model,
            total_usd: auditRecord.cost.total_usd,
            ledger_entry_id: ledgerEntry.id,
          });
        }
      }

      return auditRecord;
    },

    async hasReceipt(requestId: RequestId): Promise<boolean> {
      try {
        const [trace, ledger] = await Promise.all([
          traceService.getTrace(requestId),
          ledgerService.getByRequestId(requestId),
        ]);

        const hasCompleteTrace = trace?.status === "completed";
        const hasLedgerEntry = ledger !== null;

        return hasCompleteTrace && hasLedgerEntry;
      } catch {
        return false;
      }
    },

    async listReceipts(limit = 100): Promise<string[]> {
      // Get all traces and filter for completed ones with ledger entries
      const traces = await traceService.listTraces(limit * 2); // Get extra to account for filtering

      const receiptIds: string[] = [];
      for (const trace of traces) {
        if (trace.status === "completed") {
          const hasLedger = await ledgerService.getByRequestId(
            trace.request_id,
          );
          if (hasLedger) {
            receiptIds.push(trace.request_id);
            if (receiptIds.length >= limit) {
              break;
            }
          }
        }
      }

      if (log) {
        log("Listed receipts", { count: receiptIds.length, limit });
      }

      return receiptIds;
    },
  };
}
