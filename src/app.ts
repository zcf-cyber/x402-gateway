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
  createPaymentVerifyService,
  type IPaymentVerifyService,
} from "./x402/verify/index.js";
import {
  createExactSettleService,
  type IExactSettleService,
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
  verifyService: IPaymentVerifyService;
  settleService: IExactSettleService;
  replayService: IReplayProtectionService;
  routerService: IRouterService;
  meterService: IMeterService;
  costService: ICostService;
  ledgerService: ILedgerService;
  traceService: ITraceService;
  receiptService: IReceiptService;
  /** Modular payment estimation & validation layer (decoupled from x402 challenge). */
  paymentService: IPaymentService;
  /** Platform fee in basis points (e.g., 50 = 0.5%). From PLATFORM_FEE_BPS config. */
  platformFeeBps: number;
  /** Default payment chain from PAYMENT_CHAIN env var. Falls back to "base" if unset. */
  paymentChain: string;
  /** Gateway's merchant/facilitator address for receiving payments. */
  merchantAddress: string;
  /** Challenge TTL in seconds (how long a 402 offer is valid). */
  challengeTtlSeconds: number;
  /** Per-chain config for the active payment chain (used by settlement service). */
  paymentChainConfig: ChainSettleConfig;
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

  if (registry.list().length === 0) {
    throw new Error(
      "No payment chains configured. Set ALCHEMY_API_KEY or EVM_RPC_URL.",
    );
  }

  return registry;
}

/**
 * Build ChainSettleConfig for the primary payment chain.
 * Falls back to "base" if PAYMENT_CHAIN is not set or the configured chain
 * has no RPC.
 */
function buildPaymentChainConfig(
  chainName: string,
  chainRegistry: IChainRegistry,
): ChainSettleConfig {
  const registered = chainRegistry.get(chainName);
  if (!registered) {
    // Fall back to first registered chain
    const fallbackName = chainRegistry.list()[0];
    if (!fallbackName) {
      throw new Error("No payment chains registered for settlement");
    }
    const fb = chainRegistry.get(fallbackName)!;
    return {
      chain: fb.chain,
      rpcUrl: fb.rpcUrl,
      tokenAddress: fb.usdcAddress,
    };
  }
  return {
    chain: registered.chain,
    rpcUrl: registered.rpcUrl,
    tokenAddress: registered.usdcAddress,
  };
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
  // ============================================================

  // --- OpenAI GPT-4o ---
  if (config.openaiApiKey) {
    const openaiBaseUrl = config.openaiBaseUrl || "https://api.openai.com/v1";
    providerRegistry.register(
      "gpt-4o",
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
    const minimaxBaseUrl =
      config.minimaxBaseUrl || "https://api.minimaxi.com/v1";
    providerRegistry.register(
      "MiniMax-M2.5",
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
    const minimaxBaseUrl =
      config.minimaxBaseUrl || "https://api.minimaxi.com/v1";
    providerRegistry.register(
      "MiniMax-M2.7",
      new OpenAIAdapter(config.minimaxApiKey, minimaxBaseUrl),
      {
        input_usd_per_token: "0.000001",
        output_usd_per_token: "0.000004",
        effective_at: new Date().toISOString(),
      },
    );
  }

  // --- Kimi K2.6 (Moonshot AI) ---
  if (config.moonshotApiKey) {
    const moonshotBaseUrl =
      config.moonshotBaseUrl || "https://api.moonshot.cn/v1";
    providerRegistry.register(
      "kimi-k2.6",
      new OpenAIAdapter(config.moonshotApiKey, moonshotBaseUrl),
      {
        input_usd_per_token: "0.0000005",
        output_usd_per_token: "0.000002",
        effective_at: new Date().toISOString(),
      },
    );
  }

  // --- GLM 5.1 (智谱 AI) ---
  if (config.zhipuApiKey) {
    const zhipuBaseUrl =
      config.zhipuBaseUrl || "https://open.bigmodel.cn/api/paas/v4";
    providerRegistry.register(
      "glm-5.1",
      new OpenAIAdapter(config.zhipuApiKey, zhipuBaseUrl),
      {
        input_usd_per_token: "0.0000005",
        output_usd_per_token: "0.000002",
        effective_at: new Date().toISOString(),
      },
    );
  }

  // --- DeepSeek V4 Pro (budget tier, flagship) ---
  if (config.deepseekApiKey) {
    const deepseekBaseUrl =
      config.deepseekBaseUrl || "https://api.deepseek.com/v1";
    providerRegistry.register(
      "deepseek-v4-pro",
      new OpenAIAdapter(config.deepseekApiKey, deepseekBaseUrl),
      {
        input_usd_per_token: "0.00000014",
        output_usd_per_token: "0.0000004",
        effective_at: new Date().toISOString(),
      },
    );
  }

  // --- DeepSeek V4 Flash (budget tier, fastest/cheapest) ---
  if (config.deepseekApiKey) {
    const deepseekBaseUrl =
      config.deepseekBaseUrl || "https://api.deepseek.com/v1";
    providerRegistry.register(
      "deepseek-v4-flash",
      new OpenAIAdapter(config.deepseekApiKey, deepseekBaseUrl),
      {
        input_usd_per_token: "0.00000014",
        output_usd_per_token: "0.00000028",
        effective_at: new Date().toISOString(),
      },
    );
  }

  const costService = createCostService();
  const ledgerService = createLedgerService();
  const traceService = createTraceService();

  /**
   * In-memory usage store for MVP stage.
   * Production environment must migrate to PostgreSQL for persistence.
   */
  const usageStore = new Map<
    string,
    {
      request_id: string;
      model_id: string;
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      created_at: string;
    }
  >();

  const chainRegistry = buildChainRegistry(config);
  const tokenRegistry = buildTokenRegistryFromChains(
    getSupportedChains(config.paymentNetwork),
  );

  // Register Solana assets (not covered by EVM chain config)
  tokenRegistry.register("solana", "USDC", {
    symbol: "USDC",
    decimals: 6,
    address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as `0x${string}`,
    type: "erc20",
  });

  const paymentChainName = config.paymentChain ?? "base";
  const paymentChainConfig = buildPaymentChainConfig(
    paymentChainName,
    chainRegistry,
  );

  const services: ServiceContainer = {
    providerRegistry,
    verifyService: createPaymentVerifyService({
      chainRegistry,
      tokenRegistry,
      solanaRpcUrl: config.solanaRpcUrl,
      merchantAddress: config.merchantAddress,
    }),
    settleService: createExactSettleService({
      facilitatorPrivateKey: config.challengeSecret, // Reuse challengeSecret as facilitator key for MVP
    }),
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
    costService,
    paymentService: createPaymentService({ costService }),
    platformFeeBps: config.platformFeeBps,
    ledgerService,
    traceService,
    receiptService: createReceiptService({ traceService, ledgerService }),
    paymentChain: paymentChainName,
    merchantAddress: config.merchantAddress,
    challengeTtlSeconds: config.challengeTtlSeconds,
    paymentChainConfig,
  };

  registerRoutes(app, services);

  return app;
}
