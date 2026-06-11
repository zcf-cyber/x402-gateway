// ---------------------------------------------------------------------------
// Payment Orchestrator — Core Business Logic for Chat Completion Flow
//
// Extracted from routes.ts per playbook "thin handlers" rule.
// Orchestrates the full payment lifecycle:
//   402 challenge → verify → route → cost → validate → ledger → settle → trace
//
// routes.ts only handles HTTP parsing and delegates everything to this service.
// ---------------------------------------------------------------------------

import { createHash, randomUUID } from "crypto";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { getDefaultAsset } from "@x402/evm";
import { computeRequestHash } from "../x402/hash.js";
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
import type { ISchemeRegistry } from "../x402/schemes/registry.js";
import type { IChainRegistry } from "../x402/chain-registry.service.js";
import type { ITokenRegistry } from "../x402/token-registry.service.js";
import type { SchemeSettleContext } from "../x402/schemes/types.js";
import type { IReplayProtectionService } from "../x402/replay.service.js";
import type { IProviderRegistry } from "../provider/index.js";
import type { IRouterService } from "../router/router.service.js";
import type { IMeterService } from "../billing/meter.service.js";
import type { ICostService } from "../billing/cost.service.js";
import type { ILedgerService } from "../billing/ledger.service.js";
import type { IPaymentService } from "../billing/payment.service.js";
import type { ITraceService } from "../audit/trace.service.js";
import type { ChainSettleConfig } from "../app.js";
import {
  PaymentVerificationFailedError,
  PaymentReplayedError,
  InsufficientPaymentError,
  RequestHashMismatchError,
  errorToResponse,
} from "../errors.js";
import type { RequestId, ChatCompletionRequest } from "../types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OrchestratorDeps {
  schemeRegistry: ISchemeRegistry;
  chainRegistry: IChainRegistry;
  tokenRegistry: ITokenRegistry;
  replayService: IReplayProtectionService;
  providerRegistry: IProviderRegistry;
  routerService: IRouterService;
  meterService: IMeterService;
  costService: ICostService;
  ledgerService: ILedgerService;
  paymentService: IPaymentService;
  traceService: ITraceService;
  platformFeeBps: number;
  paymentChain: string;
  merchantAddress: string;
  offerTtlSeconds: number;
  paymentChainConfig: ChainSettleConfig;
}

export interface PaymentRequiredResult {
  statusCode: 402;
  paymentRequiredHeader: string;
  body: Record<string, unknown>;
}

export interface ProcessPaymentResult {
  statusCode: number;
  paymentResponseHeader?: string;
  body: Record<string, unknown>;
}

export interface IPaymentOrchestrator {
  build402Response(
    body: ChatCompletionRequest,
    preferredAsset: string,
    preferredChain: string,
  ): Promise<PaymentRequiredResult>;

  processPayment(
    body: ChatCompletionRequest,
    paymentSignature: string,
    idempotencyKey: string | undefined,
    requestId: RequestId,
  ): Promise<ProcessPaymentResult>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateQuoteId(): string {
  return randomUUID().replace(/-/g, "").substring(0, 16);
}

function sigHash(payload: PaymentPayloadV2): string {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("base64url");
}

/**
 * Convert an atomic-unit amount string back to a decimal string using token decimals.
 * e.g., atomicToDecimal("6195042", 6) → "6.195042"
 *
 * Uses @x402/evm getDefaultAsset for canonical decimal resolution when available.
 */
function atomicToDecimal(atomicAmount: string, decimals: number): string {
  // If amount already contains a decimal point, it's already in decimal format
  if (atomicAmount.includes(".")) return atomicAmount;

  const padded = atomicAmount.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, -decimals) || "0";
  const fracPart = padded.slice(-decimals);
  // Trim trailing zeros in fraction for cleaner display
  const trimmed = fracPart.replace(/0+$/, "");
  return trimmed ? `${intPart}.${trimmed}` : intPart;
}

/** 
 * Resolve token decimals for a given CAIP-2 network. Uses @x402/evm canonical defaults.
 *
 * NOTE: Only uses the `network` parameter for @x402/evm lookup — `asset` is the
 * fallback key for tokenRegistry when the network is not in DEFAULT_STABLECOINS
 * (e.g., eip155:1 / Ethereum mainnet). MVP assumes one default token per network.
 */
function resolveDecimals(
  network: string,
  tokenRegistry: ITokenRegistry,
  asset: string,
): number {
  try {
    return getDefaultAsset(network as `${string}:${string}`).decimals;
  } catch {
    // eip155:1 and other networks not in DEFAULT_STABLECOINS fall back here
    const config =
      tokenRegistry.getByAddress?.(network, asset) ??
      tokenRegistry.get(network, asset);
    return config?.decimals ?? 6;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPaymentOrchestrator(
  deps: OrchestratorDeps,
): IPaymentOrchestrator {
  const d = deps;

  return {
    async build402Response(
      body: ChatCompletionRequest,
      preferredAsset: string,
      preferredChain: string,
    ): Promise<PaymentRequiredResult> {
      const pricing = d.providerRegistry.getModelPricing(body.model);
      const estimatedMaxAmount = d.paymentService.estimateMaxAmount(
        body,
        pricing,
        d.platformFeeBps,
      );

      const quoteId = generateQuoteId();
      const requestHash = computeRequestHash(body as unknown as Record<string, unknown>);
      const caip2Network = chainToCaip2(preferredChain);

      // Use @x402/evm ExactEvmScheme (official package) to build x402/evm-compliant
      // PaymentRequirementsV2. This ensures:
      //   - asset is the ERC-20 contract address (not symbol)
      //   - amount is in atomic units (not decimal)
      //   - extra includes EIP-712 domain name and version
      const scheme = new ExactEvmScheme();
      let compliantAmount: string;
      let compliantAsset: string;
      let schemeExtra: Record<string, unknown>;

      try {
        const parsed = await scheme.parsePrice(estimatedMaxAmount, caip2Network);
        compliantAmount = parsed.amount;
        compliantAsset = parsed.asset;
        schemeExtra = (parsed.extra as Record<string, unknown>) ?? {};
      } catch {
        // If network not in @x402/evm DEFAULT_STABLECOINS (e.g., eip155:1 for
        // Ethereum mainnet), fall back to token registry with @x402/core
        // convertToTokenAmount logic and chain-config eip712Name.
        const { convertToTokenAmount } = await import("@x402/core/utils");
        const tokenConfig = d.tokenRegistry.get(preferredChain, preferredAsset);
        compliantAsset = tokenConfig?.address ?? preferredAsset;
        const decimals = tokenConfig?.decimals ?? 6;
        compliantAmount = convertToTokenAmount(estimatedMaxAmount, decimals);
        schemeExtra = {
          name: tokenConfig?.eip712Name ?? "USD Coin",
          version: tokenConfig?.eip712Version ?? "2",
        };
      }

      const requirement: PaymentRequirementsV2 = {
        scheme: "exact",
        network: caip2Network,
        asset: compliantAsset,
        amount: compliantAmount,
        payTo: d.merchantAddress,
        maxTimeoutSeconds: d.offerTtlSeconds,
        extra: {
          ...schemeExtra,
          quote_id: quoteId,
          request_hash: requestHash,
        },
      };

      return {
        statusCode: 402,
        paymentRequiredHeader: encodePaymentRequired([requirement]),
        body: {
          error: {
            code: "payment_required",
            message: "Payment proof required",
          },
          payment_requirements: {
            quote_id: quoteId,
            request_hash: requestHash,
            chain: preferredChain,
            asset: preferredAsset,
            amount: estimatedMaxAmount,
            expires_at: new Date(
              Date.now() + d.offerTtlSeconds * 1000,
            ).toISOString(),
            merchant_address: d.merchantAddress,
            pay_to: d.merchantAddress,
            scheme: "exact",
            network: requirement.network,
            max_timeout_seconds: d.offerTtlSeconds,
          },
        },
      };
    },

    async processPayment(
      body: ChatCompletionRequest,
      paymentSignature: string,
      idempotencyKey: string | undefined,
      requestId: RequestId,
    ): Promise<ProcessPaymentResult> {
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

        // 2. Validate requestHash — server-side recomputation
        const clientHash =
          (paymentPayload.accepted.extra as Record<string, unknown>)
            ?.request_hash as string | undefined;
        const serverHash = computeRequestHash(
          body as unknown as Record<string, unknown>,
        );
        if (clientHash !== undefined && clientHash !== serverHash) {
          throw new RequestHashMismatchError();
        }

        // 3. Idempotency check
        if (idempotencyKey) {
          const cached =
            await d.replayService.checkIdempotency(idempotencyKey);
          if (cached) {
            return {
              statusCode: 200,
              body: cached as Record<string, unknown>,
            };
          }
        }

        // 4. Replay protection
        await d.replayService.checkAndMark(sigHash(paymentPayload), 86400);

        // 5. Verify payment via scheme registry
        const { payer } = await d.schemeRegistry.verify(paymentPayload, {
          merchantAddress: d.merchantAddress,
          chainRegistry: d.chainRegistry,
          tokenRegistry: d.tokenRegistry,
        });

        // 6. Start request trace
        await d.traceService.startTrace(requestId, serverHash);

        let settlementResponse: SettlementResponseV2 = {
          success: false,
          errorReason: "not_settled",
          errorMessage: "Settlement not attempted",
          transaction: "",
          network: paymentPayload.accepted.network,
        };

        try {
          // 7. Route to upstream provider
          const { decision, response } =
            await d.routerService.route(body);

          // 8. Record usage
          await d.meterService.recordUsage(
            requestId,
            decision.selected_model,
            response,
          );

          // 9. Calculate cost
          const pricing = d.providerRegistry.getModelPricing(
            decision.selected_model,
          );
          const usage = {
            request_id: requestId,
            model_id: decision.selected_model,
            prompt_tokens: response.usage.prompt_tokens,
            completion_tokens: response.usage.completion_tokens,
            total_tokens: response.usage.total_tokens,
            cached_tokens: response.usage.prompt_tokens_details?.cached_tokens,
          };
          const cost = d.costService.calculateCost(
            usage,
            pricing,
            d.platformFeeBps,
          );

          // 10. Validate cost <= authorized amount
          // Convert authorized amount from atomic units to decimal for comparison,
          // using @x402/evm canonical decimals where available.
          const acceptedNetwork = paymentPayload.accepted.network;
          const acceptedDecimals = resolveDecimals(
            acceptedNetwork,
            d.tokenRegistry,
            paymentPayload.accepted.asset,
          );
          const authorizedDecimal = atomicToDecimal(
            paymentPayload.accepted.amount,
            acceptedDecimals,
          );
          d.paymentService.validatePayment(
            cost.total_usd,
            authorizedDecimal,
          );

          // 11. Commit to ledger (append-only)
          const quoteId = (
            paymentPayload.accepted.extra as Record<string, unknown>
          )?.quote_id as string;
          await d.ledgerService.commit({
            request_id: requestId,
            quote_id: quoteId || "",
            payer_address: payer,
            model_used: decision.selected_model,
            usage,
            cost,
          });

          // 12. Settle on-chain via SchemeRegistry
          try {
            const settleCtx: SchemeSettleContext = {
              chain: d.paymentChainConfig.chain,
              rpcUrl: d.paymentChainConfig.rpcUrl,
              tokenAddress: d.paymentChainConfig.tokenAddress,
            };
            settlementResponse = await d.schemeRegistry.settle(
              paymentPayload,
              settleCtx,
            );
          } catch {
            settlementResponse = {
              success: false,
              errorReason: "settlement_error",
              errorMessage: "Settlement transaction failed",
              transaction: "",
              network: paymentPayload.accepted.network,
            };
          }

          // 13. Complete trace
          await d.traceService.completeTrace(requestId, {
            selectedModel: decision.selected_model,
            fallbackChain: decision.fallback_chain,
            scoreSummary: decision.score_summary,
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
            cachedTokens: response.usage.prompt_tokens_details?.cached_tokens ?? 0,
            subtotalUsd: cost.subtotal_usd,
            platformFeeUsd: cost.platform_fee_usd,
            totalUsd: cost.total_usd,
            quoteId: quoteId || "",
            chain: d.paymentChain,
            asset: paymentPayload.accepted.asset,
            payerAddress: payer,
            latencyMs: response.latency_ms,
          });

          // 14. Build result
          const result: ProcessPaymentResult = {
            statusCode: 200,
            paymentResponseHeader:
              encodeSettlementResponse(settlementResponse),
            body: {
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
                unit_price_cached_usd: cost.unit_price_cached,
                total_cost_usd: cost.total_usd,
                route_proof_hash: decision.route_proof_hash,
              },
              settlement: {
                success: settlementResponse.success,
                transaction: settlementResponse.transaction,
                error_reason: settlementResponse.errorReason,
              },
            },
          };

          // 15. Cache for idempotent retry
          if (idempotencyKey) {
            await d.replayService.saveIdempotency(
              idempotencyKey,
              result,
              86400,
            );
          }

          return result;
        } catch (routeError) {
          await d.traceService.failTrace(
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
          error instanceof InsufficientPaymentError ||
          error instanceof RequestHashMismatchError
        ) {
          return {
            statusCode: 402,
            body: errorToResponse(error),
          };
        }
        if (error instanceof PaymentReplayedError) {
          return { statusCode: 409, body: errorToResponse(error) };
        }
        throw error;
      }
    },
  };
}
