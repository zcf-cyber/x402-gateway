import { createHash, randomUUID } from "crypto";
import type { FastifyInstance } from "fastify";
import { chatCompletionBodySchema } from "./schemas.js";
import type { ServiceContainer } from "../app.js";
import {
  errorToResponse,
  PaymentVerificationFailedError,
  PaymentReplayedError,
  InsufficientPaymentError,
} from "../errors.js";
import { decodePaymentPayload } from "../x402/transport/decode.js";
import {
  encodePaymentRequired,
  encodeSettlementResponse,
} from "../x402/transport/encode.js";
import { chainToCaip2 } from "../x402/transport/caip2.js";
import type {
  PaymentRequirementsV2,
  PaymentPayloadV2,
  SettlementResponseV2,
} from "../x402/transport/types.js";

/** Compute a deterministic request hash from the chat completion body. */
function computeRequestHash(body: Record<string, unknown>): string {
  const sortedKeys = Object.keys(body).sort();
  const objWithSortedKeys: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    objWithSortedKeys[key] = body[key];
  }
  const sortedBody = JSON.stringify(objWithSortedKeys, null, 2);
  const hash = createHash("sha256").update(sortedBody).digest("hex");
  return `rh_${hash}`;
}

/** Generate a short unique quote ID. */
function generateQuoteId(): string {
  return randomUUID().replace(/-/g, "").substring(0, 16);
}

/** Compute payment signature hash for replay protection. */
function paymentSignatureHash(payload: PaymentPayloadV2): string {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("base64url");
}

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
    // No PAYMENT-SIGNATURE → return 402 Payment Required
    // ------------------------------------------------------------------
    if (!paymentSignature) {
      const pricing = services.providerRegistry.getModelPricing(body.model);
      const estimatedTokens = services.paymentService.estimateTokens(body);
      const estimatedCost = services.paymentService.estimateTotalCost(
        estimatedTokens,
        pricing,
        services.platformFeeBps,
      );

      const quoteId = generateQuoteId();
      const requestHash = computeRequestHash(body);

      const requirement: PaymentRequirementsV2 = {
        scheme: "exact",
        network: chainToCaip2(preferredChain),
        asset: preferredAsset,
        amount: estimatedCost,
        payTo: services.merchantAddress,
        maxTimeoutSeconds: services.challengeTtlSeconds,
        extra: {
          quote_id: quoteId,
          request_hash: requestHash,
        },
      };

      // Set v2 PAYMENT-REQUIRED header
      reply.header("PAYMENT-REQUIRED", encodePaymentRequired([requirement]));

      return reply.status(402).send({
        error: { code: "payment_required", message: "Payment proof required" },
        payment_requirements: {
          quote_id: quoteId,
          request_hash: requestHash,
          chain: preferredChain,
          asset: preferredAsset,
          amount: estimatedCost,
          expires_at: new Date(
            Date.now() + services.challengeTtlSeconds * 1000,
          ).toISOString(),
          merchant_address: services.merchantAddress,
          pay_to: services.merchantAddress,
          scheme: "exact",
          network: requirement.network,
          max_timeout_seconds: services.challengeTtlSeconds,
        },
      });
    }

    // ------------------------------------------------------------------
    // PAYMENT-SIGNATURE present → verify, settle, execute
    // ------------------------------------------------------------------
    try {
      // 1. Decode the v2 payment payload
      let paymentPayload: PaymentPayloadV2;
      try {
        paymentPayload = decodePaymentPayload(paymentSignature);
      } catch {
        throw new PaymentVerificationFailedError(
          "Invalid PAYMENT-SIGNATURE header format",
        );
      }

      // 2. Idempotency check
      if (idempotencyKey) {
        const cached =
          await services.replayService.checkIdempotency(idempotencyKey);
        if (cached) return reply.send(cached);
      }

      // 3. Replay protection (prevent double-spend of payment signature)
      await services.replayService.checkAndMark(
        paymentSignatureHash(paymentPayload),
        86400,
      );

      // 4. Verify payment via exact scheme (EIP-3009)
      const { payer } = await services.verifyService.verifyPaymentV2(
        paymentPayload,
        services.merchantAddress,
      );

      // 5. Start request trace for audit
      const requestId =
        `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}` as import("../types.js").RequestId;
      const requestHash =
        (paymentPayload.accepted.extra as Record<string, unknown>)?.[
          "request_hash"
        ] as string;
      await services.traceService.startTrace(requestId, requestHash);

      let settlementResponse: SettlementResponseV2 = {
        success: false,
        errorReason: "not_settled",
        errorMessage: "Settlement not attempted",
        transaction: "",
        network: paymentPayload.accepted.network,
      };

      try {
        // 6. Route the request to upstream provider
        const { decision, response } = await services.routerService.route(
          body,
        );

        // 7. Record token usage
        await services.meterService.recordUsage(
          requestId,
          decision.selected_model,
          response,
        );

        // 8. Get pricing and calculate cost
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
        const cost = services.costService.calculateCost(
          usage,
          pricing,
          services.platformFeeBps,
        );

        // 9. Validate actual cost <= authorized amount (x402 upto semantics)
        services.paymentService.validatePayment(
          cost.total_usd,
          paymentPayload.accepted.amount,
        );

        // 10. Commit to ledger
        const quoteId =
          (paymentPayload.accepted.extra as Record<string, unknown>)?.[
            "quote_id"
          ] as string;
        await services.ledgerService.commit({
          request_id: requestId,
          quote_id: quoteId || "",
          payer_address: payer,
          model_used: decision.selected_model,
          usage,
          cost,
        });

        // 11. Settle payment on-chain (transferWithAuthorization)
        try {
          settlementResponse = await services.settleService.settlePayment(
            paymentPayload,
            services.paymentChainConfig.chain,
            services.paymentChainConfig.rpcUrl,
            services.paymentChainConfig.tokenAddress,
          );
        } catch {
          // Settlement failure is logged but doesn't block the response
          settlementResponse = {
            success: false,
            errorReason: "settlement_error",
            errorMessage: "Settlement transaction failed",
            transaction: "",
            network: paymentPayload.accepted.network,
          };
        }

        // 12. Complete the trace
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
          quoteId: quoteId || "",
          chain: services.paymentChain,
          asset: paymentPayload.accepted.asset,
          payerAddress: payer,
          latencyMs: response.latency_ms,
        });

        // 13. Set PAYMENT-RESPONSE header
        reply.header(
          "PAYMENT-RESPONSE",
          encodeSettlementResponse(settlementResponse),
        );

        // 14. Build and return result
        const result = {
          id: requestId,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: decision.selected_model,
          choices: response.choices,
          usage: response.usage,
          usage_receipt: {
            request_id: requestId,
            quote_id: quoteId || "",
            payer_address: payer,
            model_used: decision.selected_model,
            unit_price_input_usd: cost.unit_price_input,
            unit_price_output_usd: cost.unit_price_output,
            total_cost_usd: cost.total_usd,
            route_proof_hash: decision.route_proof_hash,
          },
          settlement: {
            success: settlementResponse.success,
            transaction: settlementResponse.transaction,
            error_reason: settlementResponse.errorReason,
          },
        };

        // 15. Cache idempotent result
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
          routeError instanceof Error
            ? routeError.message
            : "Routing failed",
        );
        throw routeError;
      }
    } catch (error) {
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
