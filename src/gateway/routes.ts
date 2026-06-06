// ---------------------------------------------------------------------------
// Gateway Routes — Thin HTTP Handlers
//
// All business logic is delegated to the PaymentOrchestrator service.
// This file handles only HTTP-level concerns: header extraction, schema
// validation, and response formatting.
// ---------------------------------------------------------------------------

import type { FastifyInstance } from "fastify";
import { chatCompletionBodySchema } from "./schemas.js";
import type { ServiceContainer } from "../app.js";
import type { RequestId } from "../types.js";

export function registerRoutes(
  app: FastifyInstance,
  services: ServiceContainer,
): void {
  app.post("/v1/chat/completions", async (request, reply) => {
    const body = chatCompletionBodySchema.parse(request.body);

    const paymentSignature = request.headers["payment-signature"] as
      | string
      | undefined;
    const idempotencyKey = request.headers["idempotency-key"] as
      | string
      | undefined;
    const preferredAsset =
      (request.headers["x-402-preferred-asset"] as string | undefined) ??
      "USDC";
    const preferredChain =
      (request.headers["x-402-preferred-chain"] as string | undefined) ??
      services.paymentChain;

    // ------------------------------------------------------------------
    // No payment → return 402 with PAYMENT-REQUIRED header
    // ------------------------------------------------------------------
    if (!paymentSignature) {
      const result = services.orchestrator.build402Response(
        body,
        preferredAsset,
        preferredChain,
      );
      reply.header("PAYMENT-REQUIRED", result.paymentRequiredHeader);
      return reply.status(402).send(result.body);
    }

    // ------------------------------------------------------------------
    // Payment present → delegate to orchestrator
    // ------------------------------------------------------------------
    const requestId = request.id as RequestId;

    const result = await services.orchestrator.processPayment(
      body,
      paymentSignature,
      idempotencyKey,
      requestId,
    );

    if (result.paymentResponseHeader) {
      reply.header("PAYMENT-RESPONSE", result.paymentResponseHeader);
    }

    return reply.status(result.statusCode).send(result.body);
  });

  app.get("/v1/models", async (_request, reply) => {
    return reply.send({ data: services.providerRegistry.listModels() });
  });

  app.get("/v1/audit/requests/:request_id", async (request, reply) => {
    const { request_id } = request.params as { request_id: string };

    const auditRecord = await services.receiptService.getByRequestId(
      request_id as RequestId,
    );

    if (!auditRecord) {
      return reply.status(404).send({
        error: {
          code: "not_found",
          message: `Request ${request_id} not found or incomplete`,
        },
      });
    }

    return reply.send(auditRecord);
  });
}
