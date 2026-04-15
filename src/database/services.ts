import type { DatabaseConfig } from "../config/database.js";
import type { Kysely } from "kysely";
import type { Redis } from "ioredis";

// Database service interfaces
export interface ITraceService {
  traceRequest(
    requestId: string,
    requestHash: string,
    method: string,
    path: string,
    headers: Record<string, unknown>,
    ttlSeconds: number,
  ): Promise<void>;
  getTrace(requestId: string): Promise<Record<string, unknown> | null>;
}

export interface IUsageService {
  recordUsage(
    requestId: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    costUsd: number,
  ): Promise<void>;
  getUsage(requestId: string): Promise<Record<string, unknown> | null>;
}

export interface IBillingService {
  recordCostBreakdown(
    requestId: string,
    baseCost: number,
    modelPremium: number,
    networkFee: number,
    totalCost: number,
  ): Promise<void>;
  getCostBreakdown(requestId: string): Promise<Record<string, unknown> | null>;
}

export interface IPaymentService {
  recordPaymentAttempt(
    requestId: string,
    paymentHash: string,
    amountUsd: number,
  ): Promise<void>;
  recordPaymentVerification(
    paymentHash: string,
    requestId: string,
    verified: boolean,
  ): Promise<void>;
  getPaymentVerification(
    paymentHash: string,
  ): Promise<Record<string, unknown> | null>;
}

export interface ILedgerService {
  recordLedgerEntry(
    requestId: string,
    paymentHash: string,
    amountUsd: number,
    entryType: string,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
  getLedgerEntries(requestId: string): Promise<Array<Record<string, unknown>>>;
}

// Database service implementation
export function createDatabaseServices(_config: DatabaseConfig) {
  // Return service implementations that throw "Not implemented" for now
  // This allows us to define the interfaces without immediately implementing all logic
  return {
    createTraceService(_db: Kysely<unknown>, _redis: Redis): ITraceService {
      return {
        async traceRequest(_requestId, _requestHash, _method, _path, _headers, _ttlSeconds) {
          throw new Error("Not implemented");
        },
        async getTrace(_requestId) {
          throw new Error("Not implemented");
        },
      };
    },

    createUsageService(_db: Kysely<unknown>): IUsageService {
      return {
        async recordUsage(_requestId, _model, _inputTokens, _outputTokens, _costUsd) {
          throw new Error("Not implemented");
        },
        async getUsage(_requestId) {
          throw new Error("Not implemented");
        },
      };
    },

    createBillingService(_db: Kysely<unknown>): IBillingService {
      return {
        async recordCostBreakdown(_requestId, _baseCost, _modelPremium, _networkFee, _totalCost) {
          throw new Error("Not implemented");
        },
        async getCostBreakdown(_requestId) {
          throw new Error("Not implemented");
        },
      };
    },

    createPaymentService(_db: Kysely<unknown>): IPaymentService {
      return {
        async recordPaymentAttempt(_requestId, _paymentHash, _amountUsd) {
          throw new Error("Not implemented");
        },
        async recordPaymentVerification(_paymentHash, _requestId, _verified) {
          throw new Error("Not implemented");
        },
        async getPaymentVerification(_paymentHash) {
          throw new Error("Not implemented");
        },
      };
    },

    createLedgerService(_db: Kysely<unknown>): ILedgerService {
      return {
        async recordLedgerEntry(_requestId, _paymentHash, _amountUsd, _entryType, _metadata) {
          throw new Error("Not implemented");
        },
        async getLedgerEntries(_requestId) {
          throw new Error("Not implemented");
        },
      };
    },
  };
}