import type { FastifyInstance } from "fastify";
import { chatCompletionBodySchema, auditParamsSchema } from "./schemas.js";
import type { ServiceContainer } from "../app.js";

export function registerRoutes(
  app: FastifyInstance,
  services: ServiceContainer,
): void {
  app.post("/v1/chat/completions", async (request, reply) => {
    const body = chatCompletionBodySchema.parse(request.body);
    const challengeHeader = request.headers["x-402-challenge"] as string | undefined;
    const paymentHeader = request.headers["x-402-payment"] as string | undefined;
    const idempotencyKey = request.headers["idempotency-key"] as string | undefined;

    if (!challengeHeader || !paymentHeader) {
      const estimatedCost = "0.001";
      return reply.status(402).send({
        error: { code: "payment_required", message: "Payment proof required" },
        payment_requirements: await services.challengeService.generateChallenge(body, estimatedCost),
      });
    }

    void body;
    void idempotencyKey;
    void services;

    return reply.status(501).send({
      error: { code: "internal_error", message: "Payment flow not yet implemented" },
    });
  });

  app.get("/v1/models", async (_request, reply) => {
    const models = services.providerRegistry.listModels();
    return reply.send({ data: models });
  });

  app.get("/v1/audit/requests/:request_id", async (request, reply) => {
    const params = auditParamsSchema.parse(request.params);
    void params;
    return reply.status(501).send({
      error: { code: "internal_error", message: "Audit query not yet implemented" },
    });
  });
}