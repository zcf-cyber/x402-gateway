import { z } from "zod";
import "dotenv/config";

const configSchema = z.object({
  port: z.coerce.number().default(3000),
  host: z.string().default("0.0.0.0"),
  nodeEnv: z.enum(["development", "production", "test"]).default("development"),
  logLevel: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  // Database configuration
  databaseUrl: z.string().url().default("postgresql://postgres:postgres@localhost:5432/x402_gateway"),
  redisUrl: z.string().url().default("redis://localhost:6379"),

  challengeSecret: z.string().min(32),
  challengeTtlSeconds: z.coerce.number().default(300),

  merchantAddress: z.string().startsWith("0x"),
  paymentNetwork: z.enum(["mainnet", "testnet"]).default("mainnet"),
  paymentChain: z.string().optional(),
  paymentAsset: z.string().optional(),

  openaiApiKey: z.string().optional(),
  openaiBaseUrl: z.string().url().optional(),
  anthropicApiKey: z.string().optional(),
  anthropicBaseUrl: z.string().url().optional(),
  minimaxApiKey: z.string().optional(),
  minimaxBaseUrl: z.string().url().optional(),

  moonshotApiKey: z.string().optional(),
  moonshotBaseUrl: z.string().url().optional(),

  zhipuApiKey: z.string().optional(),
  zhipuBaseUrl: z.string().url().optional(),

  deepseekApiKey: z.string().optional(),
  deepseekBaseUrl: z.string().url().optional(),

  evmRpcUrl: z.string().url().optional(),
  alchemyApiKey: z.string().optional(),
  solanaRpcUrl: z.string().url().optional(),

  platformFeeBps: z.coerce.number().default(500),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  return configSchema.parse({
    port: process.env["PORT"],
    host: process.env["HOST"],
    nodeEnv: process.env["NODE_ENV"],
    logLevel: process.env["LOG_LEVEL"],
    databaseUrl: process.env["DATABASE_URL"],
    redisUrl: process.env["REDIS_URL"],
    challengeSecret: process.env["CHALLENGE_SECRET"],
    challengeTtlSeconds: process.env["CHALLENGE_TTL_SECONDS"],
    merchantAddress: process.env["MERCHANT_ADDRESS"],
    paymentNetwork: process.env["PAYMENT_NETWORK"],
    paymentChain: process.env["PAYMENT_CHAIN"],
    paymentAsset: process.env["PAYMENT_ASSET"],
    openaiApiKey: process.env["OPENAI_API_KEY"],
    openaiBaseUrl: process.env["OPENAI_BASE_URL"],
    anthropicApiKey: process.env["ANTHROPIC_API_KEY"],
    anthropicBaseUrl: process.env["ANTHROPIC_BASE_URL"],
    minimaxApiKey: process.env["MINIMAX_API_KEY"],
    minimaxBaseUrl: process.env["MINIMAX_BASE_URL"],
    moonshotApiKey: process.env["MOONSHOT_API_KEY"],
    moonshotBaseUrl: process.env["MOONSHOT_BASE_URL"],
    zhipuApiKey: process.env["ZHIPU_API_KEY"],
    zhipuBaseUrl: process.env["ZHIPU_BASE_URL"],
    deepseekApiKey: process.env["DEEPSEEK_API_KEY"],
    deepseekBaseUrl: process.env["DEEPSEEK_BASE_URL"],
    platformFeeBps: process.env["PLATFORM_FEE_BPS"],
    evmRpcUrl: process.env["EVM_RPC_URL"],
    alchemyApiKey: process.env["ALCHEMY_API_KEY"],
    solanaRpcUrl: process.env["SOLANA_RPC_URL"],
  });
}

export function parseDatabaseConfig(config: Config) {
  const { databaseUrl, redisUrl } = config;
  
  const postgresUrl = new URL(databaseUrl);
  const postgresConfig = {
    host: postgresUrl.hostname,
    port: parseInt(postgresUrl.port) || 5432,
    database: postgresUrl.pathname.slice(1),
    user: postgresUrl.username || "postgres",
    password: postgresUrl.password || "postgres",
  };

  const redisUrlObj = new URL(redisUrl);
  const redisConfig = {
    host: redisUrlObj.hostname,
    port: parseInt(redisUrlObj.port) || 6379,
    password: redisUrlObj.password,
    db: parseInt(redisUrlObj.searchParams.get('db') || '0'),
  };

  return {
    postgres: postgresConfig,
    redis: redisConfig,
  };
}
