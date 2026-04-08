import type { LedgerEntry } from './types.js';

export interface ILedgerService {
  /**
   * Commit a ledger entry. INSERT only -- never UPDATE or DELETE.
   * Ledger is append-only. Compensation uses new append entries.
   */
  commit(entry: Omit<LedgerEntry, 'id' | 'created_at'>): Promise<LedgerEntry>;

  /** Query ledger by request_id */
  getByRequestId(requestId: string): Promise<LedgerEntry | null>;

  /** Query ledger by quote_id */
  getByQuoteId(quoteId: string): Promise<LedgerEntry | null>;
}

export function createLedgerService(): ILedgerService {
  return {
    async commit(
      _entry: Omit<LedgerEntry, 'id' | 'created_at'>,
    ): Promise<LedgerEntry> {
      // TODO: Implement
      // 1. Generate unique id
      // 2. Set created_at to current timestamp
      // 3. INSERT into ledger table (PostgreSQL)
      // 4. Return the complete LedgerEntry
      // CRITICAL: Never UPDATE or DELETE existing entries
      throw new Error('Not implemented');
    },

    async getByRequestId(_requestId: string): Promise<LedgerEntry | null> {
      // TODO: SELECT from ledger WHERE request_id = ?
      throw new Error('Not implemented');
    },

    async getByQuoteId(_quoteId: string): Promise<LedgerEntry | null> {
      // TODO: SELECT from ledger WHERE quote_id = ?
      throw new Error('Not implemented');
    },
  };
}
