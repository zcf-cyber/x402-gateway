import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import type { Config } from './config.js';
import { AppError, errorToResponse } from './errors.js';
import { traceIdHook } from './gateway/middleware.js';
import { registerRoutes } from './gateway/routes.js';
import { createProviderRegistry, type IProviderRegistry } from './provider/index.js';
import { createChallengeService, type IChallengeService } from './x402/challenge.service.js';
import { createPaymentVerifyService, type IPaymentVerifyService } from './x402/verify.service.js';
import { createReplayProtectionService, type IReplayProtectionService } from './x402/replay.service.js';
import { createRouterService, type IRouterService } from './router/router.service.js';
import { createMeterService, type IMeterService } from './billing/meter.service.js';
import { createCostService, type ICostService } from './billing/cost.service.js';
import { createLedgerService, type ILedgerService } from './billing/ledger.service.js';
import { createTraceService, type ITraceService } from './audit/trace.service.js';
import { createReceiptService, type IReceiptService } from './audit/receipt.service.js';

/** All instantiated services, passed to route handlers */
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
    genReqId: () => '', // overridden by traceIdHook
  });

  // --- Plugins ---
  await app.register(cors);
  await app.register(helmet);
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  await app.register(sensible);

  // --- Hooks ---
  app.addHook('onRequest', traceIdHook);

  // --- Global error handler ---
  app.setErrorHandler((error: Error, _request, reply) => {
    if (error instanceof AppError) {
      const body = errorToResponse(error);
      return reply.status(error.statusCode).send(body);
    }

    // Zod validation errors
    if (error.name === 'ZodError') {
      return reply.status(400).send({
        error: { code: 'validation_error', message: error.message },
      });
    }

    app.log.error(error);
    return reply.status(500).send({
      error: { code: 'internal_error', message: 'Internal server error' },
    });
  });

  // --- Service wiring ---
  // TODO: Initialize Redis and PostgreSQL connections here
  // const redis = new Redis(config.redisUrl);
  // const db = createKyselyPool(config.databaseUrl);

  const services: ServiceContainer = {
    providerRegistry: createProviderRegistry(),
    challengeService: createChallengeService({
      challengeSecret: config.challengeSecret,
      challengeTtlSeconds: config.challengeTtlSeconds,
      merchantAddress: config.merchantAddress,
      paymentChain: config.paymentChain,
      paymentAsset: config.paymentAsset,
    }),
    verifyService: createPaymentVerifyService(),
    replayService: createReplayProtectionService(null as never), // TODO: pass real Redis
    routerService: createRouterService({}),
    meterService: createMeterService(),
    costService: createCostService(),
    ledgerService: createLedgerService(),
    traceService: createTraceService(),
    receiptService: createReceiptService(),
  };

  // --- Routes ---
  registerRoutes(app, services);

  return app;
}
