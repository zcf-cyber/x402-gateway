import type { FastifyInstance } from 'fastify';
import { chatCompletionBodySchema, auditParamsSchema } from './schemas.js';
import type { ServiceContainer } from '../app.js';

/**
 * Register all API routes (thin handlers).
 * Handlers parse parameters and delegate to services -- zero business logic here.
 */
export function registerRoutes(app: FastifyInstance, services: ServiceContainer): void {
  /**
   * POST /v1/chat/completions
   * OpenAI-compatible chat completion with x402 payment flow.
   *
   * Flow:
   * 1. Parse & validate body
   * 2. Check X-402 headers
   *    - No headers -> generate challenge -> return 402
   *    - Headers present -> verify challenge -> verify payment -> execute
   * 3. Route to upstream model
   * 4. Record usage, calculate cost, commit ledger
   * 5. Return response with usage_receipt
   */
  app.post('/v1/chat/completions', async (request, reply) => {
    const body = chatCompletionBodySchema.parse(request.body);
    const challengeHeader = request.headers['x-402-challenge'] as string | undefined;
    const paymentHeader = request.headers['x-402-payment'] as string | undefined;
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    // No payment headers -> issue challenge
    if (!challengeHeader || !paymentHeader) {
      // TODO: Estimate cost, generate challenge, return 402
      void body;
      return reply.status(402).send({
        error: { code: 'payment_required', message: 'Payment proof required' },
        payment_requirements: {
          quote_id: 'placeholder',
          chain: 'base',
          asset: 'USDC',
          amount: '0.0000',
          expires_at: new Date(Date.now() + 300_000).toISOString(),
          merchant_address: '0x0000000000000000000000000000000000000000',
          request_hash: 'placeholder',
          challenge_token: 'placeholder',
        },
      });
    }

    // Has payment headers -> verify and execute
    void body;
    void idempotencyKey;
    void services;

    // TODO: Implement full paid request flow:
    // 1. services.challengeService.verifyChallenge(challengeHeader, _body)
    // 2. services.replayService.checkAndMark(paymentProofHash)
    // 3. services.verifyService.verifyPayment(proof, challenge)
    // 4. services.routerService.route(_body, _body.routing_mode)
    // 5. services.meterService.recordUsage(...)
    // 6. services.costService.calculateCost(...)
    // 7. services.ledgerService.commit(...)
    // 8. services.traceService.completeTrace(...)
    // 9. Return ChatCompletionResponse with usage_receipt

    return reply.status(501).send({
      error: { code: 'internal_error', message: 'Payment flow not yet implemented' },
    });
  });

  /**
   * GET /v1/models
   * Return available model catalog and pricing metadata.
   */
  app.get('/v1/models', async (_request, reply) => {
    const models = services.providerRegistry.listModels();
    return reply.send({ data: models });
  });

  /**
   * GET /v1/audit/requests/:request_id
   * Return route and settlement evidence for a completed request.
   */
  app.get('/v1/audit/requests/:request_id', async (request, reply) => {
    const params = auditParamsSchema.parse(request.params);

    // TODO: Wire to receiptService
    // const result = await services.receiptService.getByRequestId(params.request_id);
    // if (!result) return reply.status(404).send({ error: { code: 'not_found', message: 'Request not found' } });
    // return reply.send(result);

    void params;
    return reply.status(501).send({
      error: { code: 'internal_error', message: 'Audit query not yet implemented' },
    });
  });
}
