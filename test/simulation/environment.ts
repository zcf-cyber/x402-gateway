/**
 * Simulation Environment - Full-stack simulation for load testing
 *
 * This module provides a complete simulation environment for testing
 * the x402 gateway under realistic load conditions.
 */

import Fastify from "fastify";
import { registerRoutes } from "../../src/gateway/routes.js";
import { createProviderRegistry } from "../../src/provider/registry.js";
import { createMeterService } from "../../src/billing/meter.service.js";
import { createCostService } from "../../src/billing/cost.service.js";
import { createPaymentService } from "../../src/billing/payment.service.js";
import { createLedgerService } from "../../src/billing/ledger.service.js";
import { createTraceService } from "../../src/audit/trace.service.js";
import { createReceiptService } from "../../src/audit/receipt.service.js";
import type { ServiceContainer } from "../../src/app.js";
import type { ChatCompletionRequest } from "../../src/types.js";
import type { PaymentProof, VerificationResult } from "../../src/x402/types.js";
import type {
  UpstreamResponse,
  ProviderAdapter,
} from "../../src/provider/types.js";
import type { RouteDecision } from "../../src/router/types.js";
import {
  PaymentReplayedError,
  InsufficientPaymentError,
  PaymentVerificationFailedError,
} from "../../src/errors.js";

/**
 * Simulated LLM provider that mimics real API behavior with configurable latency
 */
export interface SimulatedProvider {
  name: string;
  models: string[];
  latencyMs: { min: number; max: number };
  failureRate: number; // 0-1 probability of failure
  rateLimitRPS: number;
}

/**
 * Default simulation configuration
 */
export const DEFAULT_SIMULATION_CONFIG = {
  providers: [
    {
      name: "openai",
      models: ["gpt-4o", "gpt-4o-mini"],
      latencyMs: { min: 100, max: 500 },
      failureRate: 0.01,
      rateLimitRPS: 100,
    },
    {
      name: "anthropic",
      models: ["claude-3-opus", "claude-3-sonnet"],
      latencyMs: { min: 150, max: 600 },
      failureRate: 0.02,
      rateLimitRPS: 80,
    },
  ] as SimulatedProvider[],
  verificationLatencyMs: { min: 50, max: 150 },
  blockchainConfirmations: 6,
  replayProtectionEnabled: true,
};

/**
 * Create a simulated model adapter with realistic behavior
 */
export function createSimulatedAdapter(
  provider: SimulatedProvider,
  options?: { currentRPS?: number },
): ProviderAdapter {
  return {
    providerId: provider.name,

    execute: async (
      request: ChatCompletionRequest,
      modelId: string,
    ): Promise<UpstreamResponse> => {
      // Check rate limit
      if (options?.currentRPS && options.currentRPS > provider.rateLimitRPS) {
        throw new Error(`Rate limit exceeded for ${provider.name}`);
      }

      // Simulate random failures
      if (Math.random() < provider.failureRate) {
        throw new Error(`Simulated ${provider.name} API failure`);
      }

      // Simulate latency
      const latencyMs =
        Math.floor(
          Math.random() * (provider.latencyMs.max - provider.latencyMs.min + 1),
        ) + provider.latencyMs.min;
      await new Promise((resolve) => setTimeout(resolve, latencyMs));

      // Generate realistic token counts based on request
      const promptTokens = Math.floor(
        request.messages.reduce((acc, m) => acc + m.content.length / 4, 0),
      );
      const completionTokens = Math.floor(Math.random() * 200) + 50;

      return {
        model_used: `${provider.name}/${modelId || provider.models[0]}`,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: `[Simulated ${provider.name} response]`,
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
        latency_ms: latencyMs,
      };
    },

    healthCheck: async (): Promise<boolean> => {
      return Math.random() > provider.failureRate;
    },
  };
}

/**
 * Create simulated payment verification service (v2 compatible)
 */
export function createSimulatedVerifyService(options?: {
  latencyMs?: { min: number; max: number };
  failureRate?: number;
  insufficientPaymentRate?: number;
}) {
  const latencyMs = options?.latencyMs ?? { min: 50, max: 150 };
  const failureRate = options?.failureRate ?? 0;
  const insufficientPaymentRate = options?.insufficientPaymentRate ?? 0;

  return {
    verifyPayment: async (
      proof: PaymentProof,
      challenge: { amount: string },
    ): Promise<VerificationResult> => {
      // Simulate verification latency
      const delay =
        Math.floor(Math.random() * (latencyMs.max - latencyMs.min + 1)) +
        latencyMs.min;
      await new Promise((resolve) => setTimeout(resolve, delay));

      // Simulate random verification failures
      if (Math.random() < failureRate) {
        throw new PaymentVerificationFailedError(
          "Simulated verification failure",
        );
      }

      // Simulate insufficient payment
      if (Math.random() < insufficientPaymentRate) {
        throw new InsufficientPaymentError(challenge.amount, "0.0001");
      }

      return {
        verified: true,
        payer_address: proof.payer_address,
        amount: challenge.amount,
      };
    },

    // v2 verification method
    verifyPaymentV2: async (_payload: unknown) => {
      const delay =
        Math.floor(Math.random() * (latencyMs.max - latencyMs.min + 1)) +
        latencyMs.min;
      await new Promise((resolve) => setTimeout(resolve, delay));

      if (Math.random() < failureRate) {
        throw new PaymentVerificationFailedError(
          "Simulated verification failure",
        );
      }

      if (Math.random() < insufficientPaymentRate) {
        throw new InsufficientPaymentError("0.001", "0.0001");
      }

      return {
        payer: "0x1234567890123456789012345678901234567890" as `0x${string}`,
      };
    },
  };
}

/**
 * Create simulated replay protection with realistic storage behavior
 */
export function createSimulatedReplayService() {
  const seenHashes = new Set<string>();
  const idempotencyStore = new Map<string, unknown>();

  return {
    checkAndMark: async (
      hash: string,
      ttlSeconds: number,
    ): Promise<boolean> => {
      // Simulate storage latency
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));

      if (seenHashes.has(hash)) {
        throw new PaymentReplayedError();
      }
      seenHashes.add(hash);

      // Simulate TTL cleanup (simplified)
      setTimeout(() => {
        seenHashes.delete(hash);
      }, ttlSeconds * 1000);

      return true;
    },

    checkIdempotency: async (key: string) => {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
      return idempotencyStore.get(key) || null;
    },

    saveIdempotency: async (
      key: string,
      response: unknown,
      ttlSeconds: number,
    ) => {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
      idempotencyStore.set(key, response);

      setTimeout(() => {
        idempotencyStore.delete(key);
      }, ttlSeconds * 1000);
    },
  };
}

/**
 * Create simulated router with realistic routing behavior
 */
export function createSimulatedRouterService(
  providers: SimulatedProvider[],
) {
  const adapters = new Map(
    providers.map((p) => [p.name, createSimulatedAdapter(p)]),
  );

  return {
    route: async (
      request: ChatCompletionRequest,
    ): Promise<{ decision: RouteDecision; response: UpstreamResponse }> => {
      const [providerName, modelName] = request.model.split("/");
      const adapter = adapters.get(providerName);

      if (!adapter) {
        throw new Error(`Provider ${providerName} not found`);
      }

      const response = await adapter.execute(
        request,
        modelName || request.model,
      );

      const decision: RouteDecision = {
        selected_model: request.model,
        fallback_chain: [],
        score_summary: "manual selection",
        route_proof_hash: `rph_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      };

      return { decision, response };
    },
  };
}

/** Simulated settle service for load testing. */
function createSimulatedSettleService() {
  return {
    settlePayment: async () => ({
      success: true,
      payer: "0x1234567890123456789012345678901234567890",
      transaction: "0x" + "a".repeat(64),
      network: "eip155:8453",
      amount: "1000000",
    }),
  };
}

/**
 * Build a fully simulated test environment for load testing
 */
export function buildSimulationEnvironment(
  config = DEFAULT_SIMULATION_CONFIG,
): {
  app: ReturnType<typeof Fastify>;
  services: ServiceContainer;
  metrics: {
    getRequestCount: () => number;
    getErrorCount: () => number;
    getAverageLatency: () => number;
    reset: () => void;
  };
} {
  const providerRegistry = createProviderRegistry();
  const costService = createCostService();
  const ledgerService = createLedgerService();
  const traceService = createTraceService();

  // Register simulated providers in the registry for pricing lookups
  for (const provider of config.providers) {
    const adapter = createSimulatedAdapter(provider);
    for (const model of provider.models) {
      const modelId = `${provider.name}/${model}`;
      providerRegistry.register(modelId, adapter, {
        input_usd_per_token: "0.00001",
        output_usd_per_token: "0.00003",
        effective_at: new Date().toISOString(),
      });
    }
  }

  // Track metrics
  let requestCount = 0;
  let errorCount = 0;
  let totalLatency = 0;

  const services: ServiceContainer = {
    providerRegistry,
    verifyService: createSimulatedVerifyService({
      latencyMs: config.verificationLatencyMs,
    }) as ServiceContainer["verifyService"],
    settleService:
      createSimulatedSettleService() as ServiceContainer["settleService"],
    replayService: createSimulatedReplayService(),
    routerService: createSimulatedRouterService(config.providers),
    meterService: createMeterService({ recordUsage: async () => {} }),
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

  // Wrap router to track metrics
  const originalRoute = services.routerService.route.bind(
    services.routerService,
  );
  services.routerService.route = async (request) => {
    const startTime = Date.now();
    requestCount++;
    try {
      const result = await originalRoute(request);
      totalLatency += Date.now() - startTime;
      return result;
    } catch (error) {
      errorCount++;
      throw error;
    }
  };

  const app = Fastify({ logger: false });
  registerRoutes(app, services);

  return {
    app,
    services,
    metrics: {
      getRequestCount: () => requestCount,
      getErrorCount: () => errorCount,
      getAverageLatency: () =>
        requestCount > 0 ? totalLatency / requestCount : 0,
      reset: () => {
        requestCount = 0;
        errorCount = 0;
        totalLatency = 0;
      },
    },
  };
}
