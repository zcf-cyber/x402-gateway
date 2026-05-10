import type { FastifyInstance } from "fastify";
import { chatCompletionBodySchema } from "./schemas.js";
import type { ServiceContainer } from "../app.js";
import {
  errorToResponse,
  ChallengeExpiredError,
  RequestHashMismatchError,
  PaymentVerificationFailedError,
  PaymentReplayedError,
  InsufficientPaymentError,
} from "../errors.js";
import type { PaymentProof, ChallengePayload } from "../x402/types.js";

/** Parse X-402-Payment header */
function parsePaymentHeader(header: string): PaymentProof {
  try {
    const decoded = Buffer.from(header, "base64url").toString("utf-8");
    const parsed = JSON.parse(decoded);
    if (!parsed.tx_hash || !parsed.chain || !parsed.payer_address) {
      throw new Error("Missing required fields");
    }
    return parsed as PaymentProof;
  } catch (error) {
    throw new PaymentVerificationFailedError("Invalid payment proof format");
  }
}

/** Compute payment proof hash for replay protection */
function computePaymentProofHash(proof: PaymentProof): string {
  return Buffer.from(
    `${proof.tx_hash}:${proof.chain}:${proof.payer_address}`,
  ).toString("base64url");
}

export function registerRoutes(
  app: FastifyInstance,
  services: ServiceContainer,
): void {
  app.post("/v1/chat/completions", async (request, reply) => {
    const body = chatCompletionBodySchema.parse(request.body);
    const challengeHeader = request.headers["x-402-challenge"] as
      | string
      | undefined;
    const paymentHeader = request.headers["x-402-payment"] as
      | string
      | undefined;
    const idempotencyKey = request.headers["idempotency-key"] as
      | string
      | undefined;
    const preferredAsset = (request.headers["x-402-preferred-asset"] as
      | string
      | undefined) ?? "USDC";
    const preferredChain = (request.headers["x-402-preferred-chain"] as
      | string
      | undefined) ?? "base";

    // No payment headers -> return 402 with challenge
    if (!challengeHeader || !paymentHeader) {
      const requirements = await services.challengeService.generateChallenge(
        body,
        "0.001",
        preferredAsset,
        preferredChain,
      );
      return reply.status(402).send({
        error: { code: "payment_required", message: "Payment proof required" },
        payment_requirements: requirements,
      });
    }

    try {
      // Parse and validate payment
      const paymentProof = parsePaymentHeader(paymentHeader);
      const challengePayload: ChallengePayload =
        await services.challengeService.verifyChallenge(challengeHeader, body);

      // Idempotency check
      if (idempotencyKey) {
        const cached =
          await services.replayService.checkIdempotency(idempotencyKey);
        if (cached) return reply.send(cached);
      }

      // Replay protection
      await services.replayService.checkAndMark(
        computePaymentProofHash(paymentProof),
        86400,
      );

      // On-chain verification
      await services.verifyService.verifyPayment(
        paymentProof,
        challengePayload,
      );

      // Start request trace for audit
      const requestId =
        `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}` as import("../types.js").RequestId;
      await services.traceService.startTrace(
        requestId,
        challengePayload.request_hash,
        body.routing_mode || "manual",
      );

      try {
        // Route the request to upstream provider
        const { decision, response } = await services.routerService.route(
          body,
          body.routing_mode || "manual",
        );

        // Record token usage
        await services.meterService.recordUsage(
          requestId,
          decision.selected_model,
          response,
        );

        // Get pricing from provider registry and calculate cost
        const pricing = services.providerRegistry.getModelPricing(
          decision.selected_model,
        );
        const usage = {
          request_id: requestId,
          model_id: decision.selected_model,
          prompt_tokens: response.usage.prompt_tokens,
          completion_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens,
        };
        const cost = services.costService.calculateCost(usage, pricing, 50);

        // Commit to ledger
        await services.ledgerService.commit({
          request_id: requestId,
          quote_id: challengePayload.quote_id,
          payer_address: paymentProof.payer_address,
          model_used: decision.selected_model,
          usage,
          cost,
        });

        // Complete the trace
        await services.traceService.completeTrace(requestId, {
          selectedModel: decision.selected_model,
          fallbackChain: decision.fallback_chain,
          scoreSummary: decision.score_summary,
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
          subtotalUsd: cost.subtotal_usd,
          platformFeeUsd: cost.platform_fee_usd,
          totalUsd: cost.total_usd,
          quoteId: challengePayload.quote_id,
          chain: paymentProof.chain,
          asset: challengePayload.asset,
          payerAddress: paymentProof.payer_address,
          latencyMs: response.latency_ms,
        });

        // Store idempotent result if key provided
        const result = {
          id: requestId,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: decision.selected_model,
          choices: response.choices,
          usage: response.usage,
          usage_receipt: {
            request_id: requestId,
            quote_id: challengePayload.quote_id,
            payer_address: paymentProof.payer_address,
            routing_mode: body.routing_mode || "manual",
            model_used: decision.selected_model,
            unit_price_input_usd: cost.unit_price_input,
            unit_price_output_usd: cost.unit_price_output,
            total_cost_usd: cost.total_usd,
            route_proof_hash: decision.route_proof_hash,
          },
        };

        if (idempotencyKey) {
          await services.replayService.saveIdempotency(
            idempotencyKey,
            result,
            86400,
          );
        }

        return reply.send(result);
      } catch (routeError) {
        // Mark trace as failed
        await services.traceService.failTrace(
          requestId,
          routeError instanceof Error ? routeError.message : "Routing failed",
        );
        throw routeError;
      }
    } catch (error) {
      if (error instanceof ChallengeExpiredError) {
        return reply.status(402).send(errorToResponse(error));
      }
      if (error instanceof RequestHashMismatchError) {
        return reply.status(400).send(errorToResponse(error));
      }
      if (
        error instanceof PaymentVerificationFailedError ||
        error instanceof InsufficientPaymentError
      ) {
        return reply.status(402).send(errorToResponse(error));
      }
      if (error instanceof PaymentReplayedError) {
        return reply.status(409).send(errorToResponse(error));
      }
      throw error;
    }
  });

  app.get("/v1/models", async (_request, reply) => {
    return reply.send({ data: services.providerRegistry.listModels() });
  });

  app.get("/v1/audit/requests/:request_id", async (request, reply) => {
    const { request_id } = request.params as { request_id: string };

    const auditRecord = await services.receiptService.getByRequestId(
      request_id as import("../types.js").RequestId,
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
