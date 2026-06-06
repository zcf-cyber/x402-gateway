import type { Address, Chain } from "viem";
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
    exOrPx?: string,
    ms?: number,
    nx?: string,
  ): Promise<string | null> {
    if (nx === "NX" && this.store.has(key)) {
      return null;
    }
    // Redis SET: "EX" = seconds, "PX" = milliseconds
    const ttlMs = exOrPx === "EX"
      ? (ms ?? 0) * 1000
      : exOrPx === "PX"
        ? (ms ?? 0)
        : 0;
    const expireAt = ttlMs > 0 ? Date.now() + ttlMs : undefined;
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
  createPaymentOrchestrator,
  type IPaymentOrchestrator,
} from "./gateway/orchestrator.js";
import {
  createProviderRegistry,
  type IProviderRegistry,
  OpenAIAdapter,
} from "./provider/index.js";
import {
  createSchemeRegistry,
  type ISchemeRegistry,
} from "./x402/schemes/registry.js";
import { createExactScheme } from "./x402/schemes/exact/index.js";
import {
  createExactSettleService,
} from "./x402/schemes/exact/settle.service.js";
import {
  getSupportedChains,
  buildAlchemyRpcUrls,
} from "./x402/chain-config.js";
import { buildTokenRegistryFromChains } from "./x402/token-registry.service.js";
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
  createPaymentService,
  type IPaymentService,
} from "./billing/payment.service.js";
import {
  createTraceService,
  type ITraceService,
} from "./audit/trace.service.js";
import {
  createReceiptService,
  type IReceiptService,
} from "./audit/receipt.service.js";

/** Per-chain config needed by settlement service. */
export interface ChainSettleConfig {
  chain: Chain;
  rpcUrl: string;
  tokenAddress: Address;
}

export interface ServiceContainer {
  providerRegistry: IProviderRegistry;
  schemeRegistry: ISchemeRegistry;
  readonly orchestrator: IPaymentOrchestrator;
  replayService: IReplayProtectionService;
  routerService: IRouterService;
  meterService: IMeterService;
  costService: ICostService;
  ledgerService: ILedgerService;
  traceService: ITraceService;
  receiptService: IReceiptService;
  paymentService: IPaymentService;
  platformFeeBps: number;
  paymentChain: string;
  merchantAddress: string;
  offerTtlSeconds: number;
  paymentChainConfig: ChainSettleConfig;
}

function buildChainRegistry(config: Config): IChainRegistry {
  const registry = createChainRegistry();
  const supportedChains = getSupportedChains(config.paymentNetwork);

  const alchemyKey = config.alchemyApiKey;
  const alchemyUrls = alchemyKey
    ? buildAlchemyRpcUrls(alchemyKey, supportedChains)
    : {};

  for (const [name, chainConfig] of Object.entries(supportedChains)) {
    const rpcUrl = alchemyUrls[name] || config.evmRpcUrl;
    if (!rpcUrl) continue;
    registry.register(name, {
      chain: chainConfig.chain,
      usdcAddress: chainConfig.usdcAddress,
      rpcUrl,
    });
  }

  if (registry.list().length === 0) {
    throw new Error(
      "No payment chains configured. Set ALCHEMY_API_KEY or EVM_RPC_URL.",
    );
  }

  return registry;
}

function buildPaymentChainConfig(
  chainName: string,
  chainRegistry: IChainRegistry,
): ChainSettleConfig {
  const registered = chainRegistry.get(chainName);
  if (!registered) {
    const fallbackName = chainRegistry.list()[0];
    if (!fallbackName) {
      throw new Error("No payment chains registered for settlement");
    }
    const fb = chainRegistry.get(fallbackName)!;
    return { chain: fb.chain, rpcUrl: fb.rpcUrl, tokenAddress: fb.usdcAddress };
  }
  return {
    chain: registered.chain,
    rpcUrl: registered.rpcUrl,
    tokenAddress: registered.usdcAddress,
  };
}

export async function buildApp(config: Config) {
  const app = Fastify({
    logger: { level: config.logLevel },
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

  // ============================================================
  // Provider Registry & Model Catalog
  // ============================================================
  const providerRegistry = createProviderRegistry();

  if (config.openaiApiKey) {
    providerRegistry.register("gpt-4o", new OpenAIAdapter(
      config.openaiApiKey,
      config.openaiBaseUrl || "https://api.openai.com/v1",
    ), {
      input_usd_per_token: "0.0000025",
      output_usd_per_token: "0.00001",
      effective_at: new Date().toISOString(),
    });
  }

  if (config.minimaxApiKey) {
    const minimaxBaseUrl = config.minimaxBaseUrl || "https://api.minimaxi.com/v1";
    providerRegistry.register("MiniMax-M2.5", new OpenAIAdapter(config.minimaxApiKey, minimaxBaseUrl), {
      input_usd_per_token: "0.0000005",
      output_usd_per_token: "0.000002",
      effective_at: new Date().toISOString(),
    });
    providerRegistry.register("MiniMax-M2.7", new OpenAIAdapter(config.minimaxApiKey, minimaxBaseUrl), {
      input_usd_per_token: "0.000001",
      output_usd_per_token: "0.000004",
      effective_at: new Date().toISOString(),
    });
  }

  if (config.moonshotApiKey) {
    providerRegistry.register("kimi-k2.6", new OpenAIAdapter(
      config.moonshotApiKey,
      config.moonshotBaseUrl || "https://api.moonshot.cn/v1",
    ), {
      input_usd_per_token: "0.0000005",
      output_usd_per_token: "0.000002",
      effective_at: new Date().toISOString(),
    });
  }

  if (config.zhipuApiKey) {
    providerRegistry.register("glm-5.1", new OpenAIAdapter(
      config.zhipuApiKey,
      config.zhipuBaseUrl || "https://open.bigmodel.cn/api/paas/v4",
    ), {
      input_usd_per_token: "0.0000005",
      output_usd_per_token: "0.000002",
      effective_at: new Date().toISOString(),
    });
  }

  if (config.deepseekApiKey) {
    const deepseekBaseUrl = config.deepseekBaseUrl || "https://api.deepseek.com/v1";
    providerRegistry.register("deepseek-v4-pro", new OpenAIAdapter(config.deepseekApiKey, deepseekBaseUrl), {
      input_usd_per_token: "0.00000014",
      output_usd_per_token: "0.0000004",
      effective_at: new Date().toISOString(),
    });
    providerRegistry.register("deepseek-v4-flash", new OpenAIAdapter(config.deepseekApiKey, deepseekBaseUrl), {
      input_usd_per_token: "0.00000014",
      output_usd_per_token: "0.00000028",
      effective_at: new Date().toISOString(),
    });
  }

  // ============================================================
  // Core Services
  // ============================================================
  const usageStore = new Map<string, {
    request_id: string; model_id: string;
    prompt_tokens: number; completion_tokens: number; total_tokens: number;
    created_at: string;
  }>();

  const costService = createCostService();
  const ledgerService = createLedgerService();
  const traceService = createTraceService();
  const replaySvc = createReplayProtectionService(new InMemoryRedis());
  const routerService = createRouterService({ providerRegistry });
  const paymentService = createPaymentService({ costService });
  const meterService = createMeterService({
    recordUsage: async (requestId, modelId, promptTokens, completionTokens, totalTokens) => {
      usageStore.set(requestId, {
        request_id: requestId, model_id: modelId,
        prompt_tokens: promptTokens, completion_tokens: completionTokens,
        total_tokens: totalTokens, created_at: new Date().toISOString(),
      });
    },
  });

  const chainRegistry = buildChainRegistry(config);
  const tokenRegistry = buildTokenRegistryFromChains(
    getSupportedChains(config.paymentNetwork),
  );

  // Register Solana assets
  tokenRegistry.register("solana", "USDC", {
    symbol: "USDC",
    decimals: 6,
    address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as `0x${string}`,
    type: "erc20",
    eip712Name: "USD Coin",
    eip712Version: "2",
  });

  // ============================================================
  // Scheme Registry — extensible payment scheme dispatch
  // ============================================================
  const schemeRegistry = createSchemeRegistry();
  const settleService = createExactSettleService({
    facilitatorPrivateKey: config.challengeSecret,
  });
  schemeRegistry.register(createExactScheme(settleService));
  // Future schemes: schemeRegistry.register(createUptoScheme());

  const paymentChainName = config.paymentChain ?? "base";
  const paymentChainConfig = buildPaymentChainConfig(paymentChainName, chainRegistry);

  // ============================================================
  // Service Container
  // ============================================================
  const _orchestrator = createPaymentOrchestrator({
    schemeRegistry,
    chainRegistry,
    tokenRegistry,
    replayService: replaySvc,
    providerRegistry,
    routerService,
    meterService,
    costService,
    ledgerService,
    paymentService,
    traceService,
    platformFeeBps: config.platformFeeBps,
    paymentChain: paymentChainName,
    merchantAddress: config.merchantAddress,
    offerTtlSeconds: config.challengeTtlSeconds,
    paymentChainConfig,
  });

  const services: ServiceContainer = {
    providerRegistry,
    schemeRegistry,
    orchestrator: _orchestrator,
    replayService: replaySvc,
    routerService,
    meterService,
    costService,
    paymentService,
    platformFeeBps: config.platformFeeBps,
    ledgerService,
    traceService,
    receiptService: createReceiptService({ traceService, ledgerService }),
    paymentChain: paymentChainName,
    merchantAddress: config.merchantAddress,
    offerTtlSeconds: config.challengeTtlSeconds,
    paymentChainConfig,
  };

  registerRoutes(app, services);

  return app;
}
