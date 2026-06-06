import Fastify from "fastify";
import { registerRoutes } from "../src/gateway/routes.js";
import { createProviderRegistry } from "../src/provider/registry.js";
import { OpenAIAdapter } from "../src/provider/openai.adapter.js";
import { createChainRegistry } from "../src/x402/chain-registry.service.js";
import { createTokenRegistry } from "../src/x402/token-registry.service.js";
import {
  createReplayProtectionService,
  type IReplayProtectionService,
} from "../src/x402/replay.service.js";
import {
  createRouterService,
  type IRouterService,
} from "../src/router/router.service.js";
import { createMeterService } from "../src/billing/meter.service.js";
import { createCostService } from "../src/billing/cost.service.js";
import { createLedgerService } from "../src/billing/ledger.service.js";
import { createPaymentService } from "../src/billing/payment.service.js";
import { createTraceService } from "../src/audit/trace.service.js";
import { createReceiptService } from "../src/audit/receipt.service.js";
import { createSchemeRegistry } from "../src/x402/schemes/registry.js";
import { createExactScheme } from "../src/x402/schemes/exact/index.js";
import type { ServiceContainer } from "../src/app.js";
import type { IPaymentOrchestrator, ProcessPaymentResult, PaymentRequiredResult } from "../src/gateway/orchestrator.js";
import type { ChatCompletionRequest, RequestId } from "../src/types.js";
import type { PaymentProof } from "../src/x402/types.js";
import type { RouteDecision } from "../src/router/types.js";
import type { UpstreamResponse } from "../src/provider/types.js";
import {
  PaymentReplayedError,
  InsufficientPaymentError,
  PaymentVerificationFailedError,
} from "../src/errors.js";

// -----------------------------------------------------------------------
// Mock Replay Service
// -----------------------------------------------------------------------

export function createMockReplayService(): IReplayProtectionService {
  const seenHashes = new Set<string>();
  const idempotencyStore = new Map<string, unknown>();

  return {
    checkAndMark: async (hash: string): Promise<boolean> => {
      if (seenHashes.has(hash)) throw new PaymentReplayedError();
      seenHashes.add(hash);
      return true;
    },
    checkIdempotency: async (key: string) => idempotencyStore.get(key) || null,
    saveIdempotency: async (key: string, response: unknown) => {
      idempotencyStore.set(key, response);
    },
  };
}

// -----------------------------------------------------------------------
// Mock Verify Service
// -----------------------------------------------------------------------

export function createMockVerifyService(options?: {
  shouldFail?: boolean;
  failWithInsufficientPayment?: boolean;
}): IPaymentVerifyService {
  return {
    verifyPayment: async (_proof, challenge): Promise<VerificationResult> => {
      if (options?.failWithInsufficientPayment) {
        throw new InsufficientPaymentError(challenge.amount, "0.0001");
      }
      if (options?.shouldFail) {
        throw new PaymentVerificationFailedError("Payment verification failed");
      }
      return { verified: true, payer_address: "0x1234567890123456789012345678901234567890", amount: challenge.amount };
    },
    verifyPaymentV2: async () => {
      if (options?.failWithInsufficientPayment) {
        throw new InsufficientPaymentError("0.001", "0.0001");
      }
      if (options?.shouldFail) {
        throw new PaymentVerificationFailedError("Payment verification failed");
      }
      return { payer: "0x1234567890123456789012345678901234567890" as `0x${string}` };
    },
  };
}

// -----------------------------------------------------------------------
// Mock Router Service
// -----------------------------------------------------------------------

export function createMockRouterService(options?: {
  shouldFail?: boolean;
  fallbackAttempt?: number;
  latencyMs?: number;
}): IRouterService {
  return {
    route: async (request: ChatCompletionRequest) => {
      if (options?.shouldFail) throw new Error("Routing failed");
      const modelId = request.model;
      return {
        decision: {
          selected_model: modelId,
          fallback_chain: options?.fallbackAttempt ? [`model-failed-${options.fallbackAttempt}`] : [],
          score_summary: "manual selection",
          route_proof_hash: "rph_test_hash",
        } as RouteDecision,
        response: {
          model_used: modelId,
          choices: [{ index: 0, message: { role: "assistant", content: "Test response" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          latency_ms: options?.latencyMs ?? 100,
        } as UpstreamResponse,
      };
    },
  };
}

// -----------------------------------------------------------------------
// Mock Settle Service
// -----------------------------------------------------------------------

export function createMockSettleService() {
  return {
    settlePayment: async () => ({
      success: true,
      payer: "0x1234567890123456789012345678901234567890",
      transaction: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      network: "eip155:8453",
      amount: "1000000",
    }),
  };
}

// -----------------------------------------------------------------------
// Mock Payment Orchestrator
// -----------------------------------------------------------------------

export function createMockOrchestrator(options?: {
  verifyShouldFail?: boolean;
  verifyFailWithInsufficientPayment?: boolean;
  routerShouldFail?: boolean;
  rejectInvalidSignature?: boolean;
  replayDetected?: boolean;
  /** Optional real services for trace/ledger population (for flow tests). */
  traceSvc?: unknown;
  ledgerSvc?: unknown;
  replaySvc?: IReplayProtectionService;
}): IPaymentOrchestrator {
  const idempotentResults = new Map<string, ProcessPaymentResult>();

  return {
    build402Response(_model: string, preferredAsset: string, preferredChain: string): PaymentRequiredResult {
      return {
        statusCode: 402,
        paymentRequiredHeader: Buffer.from(
          JSON.stringify({ x402Version: 2, accepts: [] }),
        ).toString("base64url"),
        body: {
          error: { code: "payment_required", message: "Payment proof required" },
          payment_requirements: {
            quote_id: "test-q-402",
            request_hash: "rh_test402",
            chain: preferredChain,
            asset: preferredAsset,
            amount: "0.001",
            expires_at: new Date(Date.now() + 300000).toISOString(),
            merchant_address: "0x0000000000000000000000000000000000000001",
            pay_to: "0x0000000000000000000000000000000000000001",
            scheme: "exact",
            network: "eip155:8453",
            max_timeout_seconds: 300,
          },
        },
      };
    },

    async processPayment(
      _body: ChatCompletionRequest,
      _paymentSignature: string,
      idempotencyKey: string | undefined,
      requestId: RequestId,
    ): Promise<ProcessPaymentResult> {
      // Idempotency: return cached result
      if (idempotencyKey && idempotentResults.has(idempotencyKey)) {
        const cached = idempotentResults.get(idempotencyKey)!;
        return cached;
      }

      // Failure flags
      if (options?.rejectInvalidSignature) {
        return {
          statusCode: 402,
          body: { error: { code: "payment_verification_failed", message: "Invalid PAYMENT-SIGNATURE header format" } },
        };
      }
      if (options?.replayDetected) {
        return {
          statusCode: 409,
          body: { error: { code: "payment_replayed", message: "Payment proof has already been used" } },
        };
      }
      if (options?.verifyShouldFail) {
        return {
          statusCode: 402,
          body: { error: { code: "payment_verification_failed", message: "Mock verification failed" } },
        };
      }
      if (options?.verifyFailWithInsufficientPayment) {
        return {
          statusCode: 402,
          body: { error: { code: "insufficient_payment", message: "Insufficient payment: required 0.001, received 0.0001" } },
        };
      }
      if (options?.routerShouldFail) {
        throw new Error("Routing failed");
      }

      // Success path — create real traces if services provided
      const t = options?.traceSvc as { startTrace: (id: string, hash: string) => Promise<void>; completeTrace: (id: string, data: Record<string, unknown>) => Promise<void> } | undefined;
      const l = options?.ledgerSvc as { commit: (entry: Record<string, unknown>) => Promise<void> } | undefined;

      if (t) {
        await t.startTrace(requestId, "rh_test_hash");
        await t.completeTrace(requestId, {
          selectedModel: "openai/gpt-4o",
          fallbackChain: [],
          scoreSummary: "manual",
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
          subtotalUsd: "0.00070",
          platformFeeUsd: "0.0000035",
          totalUsd: "0.0007035",
          quoteId: "test-quote-123",
          chain: "base",
          asset: "USDC",
          payerAddress: "0x1234567890123456789012345678901234567890",
          latencyMs: 100,
        });
      }
      if (l) {
        await l.commit({
          request_id: requestId,
          quote_id: "test-quote-123",
          payer_address: "0x1234567890123456789012345678901234567890",
          model_used: "openai/gpt-4o",
          usage: { request_id: requestId, model_id: "openai/gpt-4o", prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          cost: { subtotal_usd: "0.00070", platform_fee_usd: "0.0000035", total_usd: "0.0007035", unit_price_input: "0.00001", unit_price_output: "0.00003" },
        });
      }

      const result: ProcessPaymentResult = {
        statusCode: 200,
        paymentResponseHeader: Buffer.from(
          JSON.stringify({ success: true, transaction: "0x" + "a".repeat(64), network: "eip155:8453" }),
        ).toString("base64url"),
        body: {
          id: requestId,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "openai/gpt-4o",
          choices: [{ index: 0, message: { role: "assistant", content: "Test response" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          usage_receipt: {
            request_id: requestId,
            quote_id: "test-quote-123",
            payer_address: "0x1234567890123456789012345678901234567890",
            model_used: "openai/gpt-4o",
            unit_price_input_usd: "0.00001",
            unit_price_output_usd: "0.00003",
            total_cost_usd: "0.0007035",
            route_proof_hash: "rph_test_hash",
          },
          settlement: {
            success: true,
            transaction: "0x" + "a".repeat(64),
            error_reason: undefined,
          },
        },
      };

      if (idempotencyKey) {
        idempotentResults.set(idempotencyKey, result);
      }

      return result;
    },
  };
}

// -----------------------------------------------------------------------
// Test App Builder — Mocked
// -----------------------------------------------------------------------

export function buildMockedTestApp(options?: {
  verifyShouldFail?: boolean;
  verifyFailWithInsufficientPayment?: boolean;
  routerShouldFail?: boolean;
  routerFallbackAttempt?: number;
  routerLatencyMs?: number;
  rejectInvalidSignature?: boolean;
  replayDetected?: boolean;
}): { app: ReturnType<typeof Fastify>; services: ServiceContainer } {
  const providerRegistry = createProviderRegistry();
  providerRegistry.register("openai/gpt-4o", new OpenAIAdapter("test-key"), {
    input_usd_per_token: "0.00001",
    output_usd_per_token: "0.00003",
    effective_at: new Date().toISOString(),
  });

  const costService = createCostService();
  const ledgerService = createLedgerService();
  const traceService = createTraceService();
  const replayService = createMockReplayService();

  const schemeRegistry = createSchemeRegistry();
  schemeRegistry.register(createExactScheme());

  const services: ServiceContainer = {
    providerRegistry,
    schemeRegistry,
    settleService: createMockSettleService() as ServiceContainer["settleService"],
    orchestrator: createMockOrchestrator({
      ...options,
      traceSvc: traceService,
      ledgerSvc: ledgerService,
    }),
    replayService,
    routerService: createMockRouterService(options),
    meterService: createMeterService({ recordUsage: async () => {} }),
    costService,
    paymentService: createPaymentService({ costService }),
    platformFeeBps: 50,
    ledgerService,
    traceService,
    receiptService: createReceiptService({ traceService, ledgerService }),
    paymentChain: "base",
    merchantAddress: "0x0000000000000000000000000000000000000001",
    offerTtlSeconds: 300,
    paymentChainConfig: {
      chain: { id: 8453, name: "Base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [] } } } as import("viem").Chain,
      rpcUrl: "https://mainnet.base.org",
      tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`,
    },
  };

  const app = Fastify({ logger: false });
  registerRoutes(app, services);

  return { app, services };
}

// -----------------------------------------------------------------------
// Test App Builder — With real services
// -----------------------------------------------------------------------

export function buildTestApp(overrides: Partial<ServiceContainer> = {}) {
  const app = Fastify({ logger: false });

  const providerRegistry = createProviderRegistry();
  providerRegistry.register("openai/gpt-4o", new OpenAIAdapter("test-key"), {
    input_usd_per_token: "0.00001",
    output_usd_per_token: "0.00003",
    effective_at: new Date().toISOString(),
  });

  const costService = createCostService();
  const ledgerService = createLedgerService();
  const traceService = createTraceService();
  const replayService = createReplayProtectionService(null as never);

  const chainRegistry = createChainRegistry();
  chainRegistry.register("base", {
    chain: { id: 8453, name: "Base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [] } } } as import("viem").Chain,
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    rpcUrl: "https://sepolia.base.org",
  });

  const tokenRegistry = createTokenRegistry();
  tokenRegistry.register("base", "USDC", {
    symbol: "USDC", decimals: 6,
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    type: "erc20",
    eip712Name: "USD Coin",
    eip712Version: "2",
  });

  const schemeRegistry = createSchemeRegistry();
  schemeRegistry.register(createExactScheme());

  const services: ServiceContainer = {
    providerRegistry,
    schemeRegistry,
    settleService: createMockSettleService() as ServiceContainer["settleService"],
    orchestrator: createMockOrchestrator() as IPaymentOrchestrator,
    replayService,
    routerService: createRouterService({ providerRegistry }),
    meterService: createMeterService({ recordUsage: async () => {} }),
    costService,
    paymentService: createPaymentService({ costService }),
    platformFeeBps: 50,
    ledgerService,
    traceService,
    receiptService: createReceiptService({ traceService, ledgerService }),
    paymentChain: "base",
    merchantAddress: "0x0000000000000000000000000000000000000001",
    offerTtlSeconds: 300,
    paymentChainConfig: {
      chain: { id: 8453, name: "Base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [] } } } as import("viem").Chain,
      rpcUrl: "https://sepolia.base.org",
      tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`,
    },
    ...overrides,
  };

  registerRoutes(app, services);
  return app;
}

// -----------------------------------------------------------------------
// Payment Signature Header Helper
// -----------------------------------------------------------------------

export function createPaymentSignatureHeader(overrides?: {
  amount?: string;
  payTo?: string;
  requestHash?: string;
}): string {
  const payload = {
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "eip155:8453",
      asset: "USDC",
      amount: overrides?.amount ?? "0.001",
      payTo: overrides?.payTo ?? "0x0000000000000000000000000000000000000001",
      maxTimeoutSeconds: 300,
      extra: {
        quote_id: "test-quote-123",
        request_hash: overrides?.requestHash ?? "rh_test_hash_abc",
      },
    },
    payload: {
      signature: "0x" + "ab".repeat(65) + "1b",
      authorization: {
        from: "0x1234567890123456789012345678901234567890",
        to: overrides?.payTo ?? "0x0000000000000000000000000000000000000001",
        value: "1000000",
        validAfter: "0",
        validBefore: "9999999999",
        nonce: "0x0000000000000000000000000000000000000000000000000000000000000001",
      },
    },
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

/** @deprecated */
export function createMockPaymentProof(overrides?: Partial<PaymentProof>): PaymentProof {
  return { tx_hash: "0x" + "a".repeat(64), chain: "base", payer_address: "0x1234567890123456789012345678901234567890", ...overrides };
}

/** @deprecated */
export function encodePaymentProof(proof: PaymentProof): string {
  return Buffer.from(JSON.stringify(proof)).toString("base64url");
}
