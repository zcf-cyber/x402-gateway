import Fastify from "fastify";
import { registerRoutes } from "../src/gateway/routes.js";
import { createProviderRegistry } from "../src/provider/registry.js";
import { OpenAIAdapter } from "../src/provider/openai.adapter.js";
import {
  createPaymentVerifyService,
  type IPaymentVerifyService,
} from "../src/x402/verify/index.js";
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
import type { ServiceContainer } from "../src/app.js";
import type { ChatCompletionRequest } from "../src/types.js";
import type {
  ChallengePayload,
  PaymentProof,
  VerificationResult,
} from "../src/x402/types.js";
import type { RouteDecision } from "../src/router/types.js";
import type { UpstreamResponse } from "../src/provider/types.js";
import {
  PaymentReplayedError,
  InsufficientPaymentError,
  PaymentVerificationFailedError,
} from "../src/errors.js";

/**
 * Create a mock replay protection service for testing.
 */
export function createMockReplayService(): IReplayProtectionService {
  const seenHashes = new Set<string>();
  const idempotencyStore = new Map<string, unknown>();

  return {
    checkAndMark: async (
      hash: string,
      _ttlSeconds: number,
    ): Promise<boolean> => {
      if (seenHashes.has(hash)) {
        throw new PaymentReplayedError();
      }
      seenHashes.add(hash);
      return true;
    },
    checkIdempotency: async (key: string) => {
      return idempotencyStore.get(key) || null;
    },
    saveIdempotency: async (
      key: string,
      response: unknown,
      _ttlSeconds: number,
    ) => {
      idempotencyStore.set(key, response);
    },
  };
}

/**
 * Create a mock payment verification service for testing.
 * Supports both legacy verifyPayment and v2 verifyPaymentV2.
 */
export function createMockVerifyService(options?: {
  shouldFail?: boolean;
  failWithInsufficientPayment?: boolean;
}): IPaymentVerifyService {
  return {
    verifyPayment: async (
      _proof: PaymentProof,
      challenge: ChallengePayload,
    ): Promise<VerificationResult> => {
      if (options?.failWithInsufficientPayment) {
        throw new InsufficientPaymentError(challenge.amount, "0.0001");
      }
      if (options?.shouldFail) {
        throw new PaymentVerificationFailedError("Payment verification failed");
      }
      return {
        verified: true,
        payer_address: "0x1234567890123456789012345678901234567890",
        amount: challenge.amount,
      };
    },
    verifyPaymentV2: async (_payload) => {
      if (options?.failWithInsufficientPayment) {
        throw new InsufficientPaymentError("0.001", "0.0001");
      }
      if (options?.shouldFail) {
        throw new PaymentVerificationFailedError("Payment verification failed");
      }
      return {
        payer: "0x1234567890123456789012345678901234567890" as `0x${string}`,
      };
    },
  };
}

/**
 * Create a mock router service for testing.
 */
export function createMockRouterService(options?: {
  shouldFail?: boolean;
  fallbackAttempt?: number;
  latencyMs?: number;
}): IRouterService {
  return {
    route: async (request: ChatCompletionRequest) => {
      if (options?.shouldFail) {
        throw new Error("Routing failed");
      }

      const modelId = request.model;
      const latencyMs = options?.latencyMs ?? 100;

      const response: UpstreamResponse = {
        model_used: modelId,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Test response" },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
        latency_ms: latencyMs,
      };

      const decision: RouteDecision = {
        selected_model: modelId,
        fallback_chain: options?.fallbackAttempt
          ? [`model-failed-${options.fallbackAttempt}`]
          : [],
        score_summary: "manual selection",
        route_proof_hash: "rph_test_hash",
      };

      return { decision, response };
    },
  };
}

/**
 * Create a mock settle service for testing.
 */
export function createMockSettleService() {
  return {
    settlePayment: async (
      _paymentPayload: unknown,
      _chain: unknown,
      _rpcUrl: string,
      _tokenAddress: unknown,
    ) => {
      return {
        success: true,
        payer: "0x1234567890123456789012345678901234567890",
        transaction:
          "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        network: "eip155:8453",
        amount: "1000000",
      };
    },
  };
}

/**
 * Build a test Fastify instance with real services.
 * Services can be overridden via the `overrides` parameter.
 * NOTE: This uses the real verify service which requires chain config.
 * For most tests, prefer `buildMockedTestApp()`.
 */
export function buildTestApp(overrides: Partial<ServiceContainer> = {}) {
  const app = Fastify({ logger: false });

  const providerRegistry = createProviderRegistry();

  // Register test models with pricing
  providerRegistry.register("openai/gpt-4o", new OpenAIAdapter("test-key"), {
    input_usd_per_token: "0.00001",
    output_usd_per_token: "0.00003",
    effective_at: new Date().toISOString(),
  });

  const costService = createCostService();
  const ledgerService = createLedgerService();
  const traceService = createTraceService();
  const chainRegistry = createChainRegistry();
  chainRegistry.register("base", {
    chain: {
      id: 8453,
      name: "Base",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [] } },
    } as import("viem").Chain,
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    rpcUrl: "https://sepolia.base.org",
  });
  const tokenRegistry = createTokenRegistry();
  tokenRegistry.register("base", "USDC", {
    symbol: "USDC",
    decimals: 6,
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    type: "erc20",
  });

  const services: ServiceContainer = {
    providerRegistry,
    verifyService: createPaymentVerifyService({
      chainRegistry,
      tokenRegistry,
      merchantAddress: "0x0000000000000000000000000000000000000001",
    }),
    settleService: createMockSettleService() as ServiceContainer["settleService"],
    replayService: createReplayProtectionService(null as never),
    routerService: createRouterService({ providerRegistry }),
    meterService: createMeterService({
      recordUsage: async () => {},
    }),
    costService,
    paymentService: createPaymentService({ costService }),
    platformFeeBps: 50,
    ledgerService,
    traceService,
    receiptService: createReceiptService({ traceService, ledgerService }),
    paymentChain: "base",
    merchantAddress: "0x0000000000000000000000000000000000000001",
    challengeTtlSeconds: 300,
    paymentChainConfig: {
      chain: {
        id: 8453,
        name: "Base",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [] } },
      } as import("viem").Chain,
      rpcUrl: "https://sepolia.base.org",
      tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`,
    },
    ...overrides,
  };

  registerRoutes(app, services);
  return app;
}

/**
 * Build a test Fastify instance with fully mocked services for end-to-end testing.
 * This simulates the complete flow without making real external calls.
 */
export function buildMockedTestApp(options?: {
  verifyShouldFail?: boolean;
  verifyFailWithInsufficientPayment?: boolean;
  routerShouldFail?: boolean;
  routerFallbackAttempt?: number;
  routerLatencyMs?: number;
}): { app: ReturnType<typeof buildTestApp>; services: ServiceContainer } {
  const providerRegistry = createProviderRegistry();

  // Register test models with pricing
  providerRegistry.register("openai/gpt-4o", new OpenAIAdapter("test-key"), {
    input_usd_per_token: "0.00001",
    output_usd_per_token: "0.00003",
    effective_at: new Date().toISOString(),
  });

  const costService = createCostService();
  const ledgerService = createLedgerService();
  const traceService = createTraceService();
  const replayService = createMockReplayService();
  const verifyService = createMockVerifyService({
    shouldFail: options?.verifyShouldFail,
    failWithInsufficientPayment: options?.verifyFailWithInsufficientPayment,
  });
  const routerService = createMockRouterService({
    shouldFail: options?.routerShouldFail,
    fallbackAttempt: options?.routerFallbackAttempt,
    latencyMs: options?.routerLatencyMs,
  });

  const meterService = createMeterService({
    recordUsage: async () => {},
  });

  const services: ServiceContainer = {
    providerRegistry,
    verifyService,
    settleService:
      createMockSettleService() as ServiceContainer["settleService"],
    replayService,
    routerService,
    meterService,
    costService,
    paymentService: createPaymentService({ costService }),
    platformFeeBps: 50,
    ledgerService,
    traceService,
    receiptService: createReceiptService({ traceService, ledgerService }),
    paymentChain: "base",
    merchantAddress: "0x0000000000000000000000000000000000000001",
    challengeTtlSeconds: 300,
    paymentChainConfig: {
      chain: {
        id: 8453,
        name: "Base",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [] } },
      } as import("viem").Chain,
      rpcUrl: "https://mainnet.base.org",
      tokenAddress:
        "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`,
    },
  };

  const app = Fastify({ logger: false });
  registerRoutes(app, services);

  return { app, services };
}

/**
 * Create a mock payment proof for testing.
 */
export function createMockPaymentProof(
  overrides?: Partial<PaymentProof>,
): PaymentProof {
  return {
    tx_hash: "0x" + "a".repeat(64),
    chain: "base",
    payer_address: "0x1234567890123456789012345678901234567890",
    ...overrides,
  };
}

/**
 * Encode payment proof to base64url format (as used in X-402-Payment header).
 *
 * @deprecated Use the x402 v2 transport encode functions for new flows.
 */
export function encodePaymentProof(proof: PaymentProof): string {
  return Buffer.from(JSON.stringify(proof)).toString("base64url");
}

/**
 * Create a mock x402 v2 PAYMENT-SIGNATURE header value for testing.
 */
export function createPaymentSignatureHeader(overrides?: {
  amount?: string;
  payTo?: string;
}): string {
  const payload = {
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "eip155:8453",
      asset: "USDC",
      amount: overrides?.amount ?? "0.001",
      payTo:
        overrides?.payTo ??
        "0x0000000000000000000000000000000000000001",
      maxTimeoutSeconds: 300,
      extra: {
        quote_id: "test-quote-123",
        request_hash: "rh_test_hash_abc",
      },
    },
    payload: {
      signature:
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1b",
      authorization: {
        from: "0x1234567890123456789012345678901234567890",
        to: overrides?.payTo ??
          "0x0000000000000000000000000000000000000001",
        value: "1000000",
        validAfter: "0",
        validBefore: "9999999999",
        nonce:
          "0x0000000000000000000000000000000000000000000000000000000000000001",
      },
    },
  };

  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}
