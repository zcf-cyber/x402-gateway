import Fastify from "fastify";
import { registerRoutes } from "../src/gateway/routes.js";
import { createProviderRegistry } from "../src/provider/registry.js";
import { createChallengeService } from "../src/x402/challenge.service.js";
import { createPaymentVerifyService } from "../src/x402/verify.service.js";
import { createReplayProtectionService } from "../src/x402/replay.service.js";
import { createRouterService } from "../src/router/router.service.js";
import { createMeterService } from "../src/billing/meter.service.js";
import { createCostService } from "../src/billing/cost.service.js";
import { createLedgerService } from "../src/billing/ledger.service.js";
import { createTraceService } from "../src/audit/trace.service.js";
import { createReceiptService } from "../src/audit/receipt.service.js";
import type { ServiceContainer } from "../src/app.js";

/**
 * Build a test Fastify instance with stub services.
 * Services can be overridden via the `overrides` parameter.
 */
export function buildTestApp(overrides: Partial<ServiceContainer> = {}) {
  const app = Fastify({ logger: false });

  const providerRegistry = createProviderRegistry();

  const services: ServiceContainer = {
    providerRegistry,
    challengeService: createChallengeService({
      challengeSecret: "test-secret-at-least-32-chars-long-for-testing",
      challengeTtlSeconds: 300,
      merchantAddress: "0x0000000000000000000000000000000000000001",
      paymentChain: "base",
      paymentAsset: "USDC",
    }),
    verifyService: createPaymentVerifyService("https://sepolia.base.org"),
    replayService: createReplayProtectionService(null as never),
    routerService: createRouterService({ providerRegistry }),
    meterService: createMeterService({
      recordUsage: async () => {}, // Mock implementation for testing
    }),
    costService: createCostService(),
    ledgerService: createLedgerService(),
    traceService: createTraceService(),
    receiptService: createReceiptService(),
    ...overrides,
  };

  registerRoutes(app, services);
  return app;
}
