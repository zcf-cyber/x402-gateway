// ---------------------------------------------------------------------------
// x402 Scheme System — Strategy Pattern for Payment Scheme Extensibility
//
// The x402 protocol defines multiple payment schemes (exact, upto, batch, etc.).
// Each scheme encapsulates its own verification and settlement logic behind a
// common interface. New schemes can be added by implementing PaymentScheme and
// registering with the SchemeRegistry — no core routing code needs to change.
// ---------------------------------------------------------------------------

import type { Address, Chain } from "viem";
import type { PaymentPayloadV2, SettlementResponseV2 } from "../transport/types.js";
import type { IChainRegistry } from "../chain-registry.service.js";
import type { ITokenRegistry } from "../token-registry.service.js";

/** Context passed to verify() — shared resources each scheme may need. */
export interface SchemeVerifyContext {
  merchantAddress: string;
  chainRegistry: IChainRegistry;
  tokenRegistry: ITokenRegistry;
}

/** Context passed to settle() — per-chain config for on-chain transaction submission. */
export interface SchemeSettleContext {
  chain: Chain;
  rpcUrl: string;
  tokenAddress: Address;
}

/**
 * A payment scheme implementation (e.g., "exact" for EIP-3009).
 *
 * To add a new scheme:
 *   1. Create a directory under src/x402/schemes/<name>/
 *   2. Implement this interface
 *   3. Register via SchemeRegistry.register()
 *   4. No changes to routes.ts, app.ts, or ServiceContainer needed
 */
export interface PaymentScheme {
  /** Unique scheme identifier (e.g., "exact", "upto"). */
  readonly name: string;

  /**
   * Verify a payment payload against this scheme's rules.
   * @throws PaymentVerificationFailedError, InsufficientPaymentError
   */
  verify(
    payload: PaymentPayloadV2,
    ctx: SchemeVerifyContext,
  ): Promise<{ payer: Address }>;

  /**
   * Settle a verified payment on-chain.
   * @returns Settlement response (success or failure details)
   */
  settle(
    payload: PaymentPayloadV2,
    ctx: SchemeSettleContext,
  ): Promise<SettlementResponseV2>;
}
