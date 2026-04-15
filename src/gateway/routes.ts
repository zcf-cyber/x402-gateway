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

    // No payment headers -> return 402 with challenge
    if (!challengeHeader || !paymentHeader) {
      const requirements = await services.challengeService.generateChallenge(
        body,
        "0.001",
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

      // P1-P4: Route, meter, cost, ledger will be integrated here
      // For now, return 501 as downstream services are not yet implemented
      return reply.status(501).send({
        error: {
          code: "internal_error",
          message: "Payment flow validated, routing not yet implemented",
        },
      });
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

  app.get("/v1/audit/requests/:request_id", async (_request, reply) => {
    return reply.status(501).send({
      error: {
        code: "internal_error",
        message: "Audit query not yet implemented",
      },
    });
  });
}