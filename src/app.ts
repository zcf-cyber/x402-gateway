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
import { getSupportedChains, buildAlchemyRpcUrls } from "./x402/chain-config.js";
import {
  createChainRegistry,
  type IChainRegistry,
} from "./x402/chain-registry.service.js";
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

function buildChainRegistry(config: Config): IChainRegistry {
  const registry = createChainRegistry();
  const supportedChains = getSupportedChains(config.paymentNetwork);

  // Per-chain RPC URLs: explicit env overrides > Alchemy template > skip
  const alchemyKey = config.alchemyApiKey;
  const alchemyUrls = alchemyKey
    ? buildAlchemyRpcUrls(alchemyKey, supportedChains)
    : {};

  for (const [name, chainConfig] of Object.entries(supportedChains)) {
    const rpcUrl = alchemyUrls[name] || config.evmRpcUrl;
    if (!rpcUrl) continue; // skip chains with no reachable RPC
    registry.register(name, {
      chain: chainConfig.chain,
      usdcAddress: chainConfig.usdcAddress,
      rpcUrl,
    });
  }

  return registry;
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

  // ============================================================
  // Model Registration: MVP Open Model Catalog
  //
  // All models use OpenAI-compatible protocol via OpenAIAdapter.
  // Each model is conditionally registered when its API key is
  // configured (via environment variables). Unconfigured models
  // are silently skipped and will not appear in GET /v1/models.
  //
  // Pricing is per-token USD, sourced from official provider
  // pricing pages (last updated: 2026-04).
  // ============================================================

  // --- OpenAI GPT-4o ---
  if (config.openaiApiKey) {
    const openaiBaseUrl = config.openaiBaseUrl || "https://api.openai.com/v1";
    providerRegistry.register(
      "openai/gpt-4o",
      new OpenAIAdapter(config.openaiApiKey, openaiBaseUrl),
      {
        input_usd_per_token: "0.0000025",
        output_usd_per_token: "0.00001",
        effective_at: new Date().toISOString(),
      },
    );
  }

  // --- MiniMax M2.5 (value tier) ---
  if (config.minimaxApiKey) {
    const minimaxBaseUrl = config.minimaxBaseUrl || "https://api.minimaxi.com/v1";
    providerRegistry.register(
      "minimax/MiniMax-M2.5",
      new OpenAIAdapter(config.minimaxApiKey, minimaxBaseUrl),
      {
        input_usd_per_token: "0.0000005",
        output_usd_per_token: "0.000002",
        effective_at: new Date().toISOString(),
      },
    );
  }

  // --- MiniMax M2.7 (premium tier) ---
  if (config.minimaxApiKey) {
    const minimaxBaseUrl = config.minimaxBaseUrl || "https://api.minimaxi.com/v1";
    providerRegistry.register(
      "minimax/MiniMax-M2.7",
      new OpenAIAdapter(config.minimaxApiKey, minimaxBaseUrl),
      {
        input_usd_per_token: "0.000001",
        output_usd_per_token: "0.000004",
        effective_at: new Date().toISOString(),
      },
    );
  }

  // --- Kimi K2.6 (Moonshot AI) ---
  // models.dev provider: moonshot, model: kimi-k2.6
  if (config.moonshotApiKey) {
    const moonshotBaseUrl = config.moonshotBaseUrl || "https://api.moonshot.cn/v1";
    providerRegistry.register(
      "moonshot/kimi-k2.6",
      new OpenAIAdapter(config.moonshotApiKey, moonshotBaseUrl),
      {
        input_usd_per_token: "0.0000005",
        output_usd_per_token: "0.000002",
        effective_at: new Date().toISOString(),
      },
    );
  }

  // --- GLM 5.1 (智谱 AI) ---
  // models.dev provider: zhipu, model: glm-5.1
  if (config.zhipuApiKey) {
    const zhipuBaseUrl = config.zhipuBaseUrl || "https://open.bigmodel.cn/api/paas/v4";
    providerRegistry.register(
      "zhipu/glm-5.1",
      new OpenAIAdapter(config.zhipuApiKey, zhipuBaseUrl),
      {
        input_usd_per_token: "0.0000005",
        output_usd_per_token: "0.000002",
        effective_at: new Date().toISOString(),
      },
    );
  }

  // --- DeepSeek V4 Pro (budget tier, flagship) ---
  // models.dev provider: deepseek, model: deepseek-v4-pro
  if (config.deepseekApiKey) {
    const deepseekBaseUrl = config.deepseekBaseUrl || "https://api.deepseek.com/v1";
    providerRegistry.register(
      "deepseek/deepseek-v4-pro",
      new OpenAIAdapter(config.deepseekApiKey, deepseekBaseUrl),
      {
        input_usd_per_token: "0.00000014",
        output_usd_per_token: "0.0000004",
        effective_at: new Date().toISOString(),
      },
    );
  }

  // --- DeepSeek V4 Flash (budget tier, fastest/cheapest) ---
  // models.dev provider: deepseek, model: deepseek-v4-flash
  if (config.deepseekApiKey) {
    const deepseekBaseUrl = config.deepseekBaseUrl || "https://api.deepseek.com/v1";
    providerRegistry.register(
      "deepseek/deepseek-v4-flash",
      new OpenAIAdapter(config.deepseekApiKey, deepseekBaseUrl),
      {
        input_usd_per_token: "0.00000014",
        output_usd_per_token: "0.00000028",
        effective_at: new Date().toISOString(),
      },
    );
  }

  const ledgerService = createLedgerService();
  const traceService = createTraceService();

  /**
   * In-memory usage store for MVP stage.
   * Production environment must migrate to PostgreSQL for persistence.
   */
  const usageStore = new Map<string, {
    request_id: string;
    model_id: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    created_at: string;
  }>();

  const services: ServiceContainer = {
    providerRegistry,
    challengeService: createChallengeService({
      challengeSecret: config.challengeSecret,
      challengeTtlSeconds: config.challengeTtlSeconds,
      merchantAddress: config.merchantAddress,
      paymentChain: config.paymentChain,
      paymentAsset: config.paymentAsset,
    }),
    verifyService: createPaymentVerifyService(
      buildChainRegistry(config),
    ),
    replayService: createReplayProtectionService(new InMemoryRedis()),
    routerService: createRouterService({ providerRegistry }),
    meterService: createMeterService({
      recordUsage: async (
        requestId: string,
        modelId: string,
        promptTokens: number,
        completionTokens: number,
        totalTokens: number,
      ) => {
        // Temporary implementation: store in memory Map
        // Production environment must migrate to PostgreSQL
        usageStore.set(requestId, {
          request_id: requestId,
          model_id: modelId,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          created_at: new Date().toISOString(),
        });
      },
    }),
    costService: createCostService(),
    ledgerService,
    traceService,
    receiptService: createReceiptService({ traceService, ledgerService }),
  };

  registerRoutes(app, services);

  return app;
}
