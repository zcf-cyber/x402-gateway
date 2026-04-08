import { z } from 'zod';
import 'dotenv/config';

const configSchema = z.object({
  port: z.coerce.number().default(3000),
  host: z.string().default('0.0.0.0'),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  databaseUrl: z.string().url(),
  redisUrl: z.string().url(),

  challengeSecret: z.string().min(32),
  challengeTtlSeconds: z.coerce.number().default(300),

  merchantAddress: z.string().startsWith('0x'),
  paymentChain: z.string().default('base'),
  paymentAsset: z.string().default('USDC'),

  openaiApiKey: z.string().optional(),
  anthropicApiKey: z.string().optional(),

  platformFeeBps: z.coerce.number().default(500),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  return configSchema.parse({
    port: process.env['PORT'],
    host: process.env['HOST'],
    nodeEnv: process.env['NODE_ENV'],
    logLevel: process.env['LOG_LEVEL'],
    databaseUrl: process.env['DATABASE_URL'],
    redisUrl: process.env['REDIS_URL'],
    challengeSecret: process.env['CHALLENGE_SECRET'],
    challengeTtlSeconds: process.env['CHALLENGE_TTL_SECONDS'],
    merchantAddress: process.env['MERCHANT_ADDRESS'],
    paymentChain: process.env['PAYMENT_CHAIN'],
    paymentAsset: process.env['PAYMENT_ASSET'],
    openaiApiKey: process.env['OPENAI_API_KEY'],
    anthropicApiKey: process.env['ANTHROPIC_API_KEY'],
    platformFeeBps: process.env['PLATFORM_FEE_BPS'],
  });
}
