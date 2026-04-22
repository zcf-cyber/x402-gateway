import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";

/**
 * In-memory Redis-compatible store for MVP stage.
 * Production environment must migrate to Redis for persistence.
 */
class InMemoryRedis {
  private store = new Map<string, { value: string; expireAt?: number }>();

  async set(
    key: string,
    value: string,
    _exOrPx?: string,
    ms?: number,
    nx?: string,
  ): Promise<string | null> {
    if (nx === "NX" && this.store.has(key)) {
      return null;
    }
    const expireAt = ms ? Date.now() + ms : undefined;
    this.store.set(key, { value, expireAt });
    return "OK";
  }

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expireAt && Date.now() > item.expireAt) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }
}
import type { Config } from "./config.js";
import { AppError, errorToResponse } from "./errors.js";
import { traceIdHook } from "./gateway/middleware.js";
import { registerRoutes } from "./gateway/routes.js";
import {
  createProviderRegistry,
  type IProviderRegistry,
  OpenAIAdapter,
} from "./provider/index.js";
import {
  createChallengeService,
  type IChallengeService,
} from "./x402/challenge.service.js";
import {
  createPaymentVerifyService,
  type IPaymentVerifyService,
} from "./x402/verify.service.js";
import {
  createReplayProtectionService,
  type IReplayProtectionService,
} from "./x402/replay.service.js";
import {
  createRouterService,
  type IRouterService,
} from "./router/router.service.js";
import {
  createMeterService,
  type IMeterService,
} from "./billing/meter.service.js";
import {
  createCostService,
  type ICostService,
} from "./billing/cost.service.js";
import {
  createLedgerService,
  type ILedgerService,
} from "./billing/ledger.service.js";
import {
  createTraceService,
  type ITraceService,
} from "./audit/trace.service.js";
import {
  createReceiptService,
  type IReceiptService,
} from "./audit/receipt.service.js";

export interface ServiceContainer {
  providerRegistry: IProviderRegistry;
  challengeService: IChallengeService;
  verifyService: IPaymentVerifyService;
  replayService: IReplayProtectionService;
  routerService: IRouterService;
  meterService: IMeterService;
  costService: ICostService;
  ledgerService: ILedgerService;
  traceService: ITraceService;
  receiptService: IReceiptService;
}

export async function buildApp(config: Config) {
  const app = Fastify({
    logger: {
      level: config.logLevel,
    },
    genReqId: () => "",
  });

  await app.register(cors);
  await app.register(helmet);
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
  await app.register(sensible);

  app.addHook("onRequest", traceIdHook);

  app.setErrorHandler((error: Error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(errorToResponse(error));
    }

    if (error.name === "ZodError") {
      return reply.status(400).send({
        error: { code: "validation_error", message: error.message },
      });
    }

    app.log.error(error);
    return reply.status(500).send({
      error: { code: "internal_error", message: "Internal server error" },
    });
  });

  const providerRegistry = createProviderRegistry();

  // Register default models for testing/development
  providerRegistry.register("openai/gpt-4o", new OpenAIAdapter("test-key"), {
    input_usd_per_token: "0.00001",
    output_usd_per_token: "0.00003",
    effective_at: new Date().toISOString(),
  });

  // Register cheaper model for auto routing tests
  providerRegistry.register(
    "openai/gpt-3.5-turbo",
    new OpenAIAdapter("test-key"),
    {
      input_usd_per_token: "0.000005",
      output_usd_per_token: "0.000015",
      effective_at: new Date().toISOString(),
    },
  );

  const ledgerService = createLedgerService();
  const traceService = createTraceService();

  const services: ServiceContainer = {
    providerRegistry,
    challengeService: createChallengeService({
      challengeSecret: config.challengeSecret,
      challengeTtlSeconds: config.challengeTtlSeconds,
      merchantAddress: config.merchantAddress,
      paymentChain: config.paymentChain,
      paymentAsset: config.paymentAsset,
    }),
    verifyService: createPaymentVerifyService(config.evmRpcUrl),
    replayService: createReplayProtectionService(new InMemoryRedis()),
    routerService: createRouterService({ providerRegistry }),
    meterService: createMeterService({
      recordUsage: async () => {}, // TODO: Integrate with database layer
    }),
    costService: createCostService(),
    ledgerService,
    traceService,
    receiptService: createReceiptService({ traceService, ledgerService }),
  };

  registerRoutes(app, services);

  return app;
}
