// ---------------------------------------------------------------------------
// x402 Exact Scheme — EIP-3009 Signature Verification
//
// Verifies EIP-3009 transferWithAuthorization signatures per the x402 v2
// exact scheme. Uses viem's recoverTypedDataAddress for signature recovery
// (standalone, no RPC client required).
//
// EIP-3009: https://eips.ethereum.org/EIPS/eip-3009
// x402 exact scheme: full amount pre-authorization, no partial settlement.
// ---------------------------------------------------------------------------

import {
  recoverTypedDataAddress,
  getAddress,
  type Address,
  type Hex,
  type TypedDataDefinition,
} from "viem";
import type { PaymentPayloadV2 } from "../../transport/types.js";
import {
  PaymentVerificationFailedError,
  InsufficientPaymentError,
} from "../../../errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Fields expected in PaymentPayloadV2.payload for the exact/EIP-3009 scheme. */
export interface ExactPaymentPayloadData {
  signature: Hex;
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
}

/** Token metadata needed for EIP-712 domain construction. */
export interface TokenMeta {
  name: string;          // token name for domain (e.g., "USD Coin")
  version: string;       // EIP-3009 domain version (e.g., "2" for USDC)
  address: Address;      // token contract address
  decimals: number;      // token decimals for amount parsing
}

// ---------------------------------------------------------------------------
// EIP-712 Constants
// ---------------------------------------------------------------------------

const EIP3009_PRIMARY_TYPE = "TransferWithAuthorization" as const;

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Parse a decimal amount string to atomic units using token decimals.
 * e.g., parseAmount("0.001", 6) → 1000n
 */
function parseAmount(amount: string, decimals: number): bigint {
  if (amount.includes(".")) {
    const [whole, fraction = ""] = amount.split(".");
    const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
    return BigInt(whole + paddedFraction);
  }
  return BigInt(amount);
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface IExactVerifyService {
  /**
   * Verify an EIP-3009 signature from an x402 v2 payment payload.
   *
   * Steps:
   *   1. Parse the EIP-3009 authorization from the payload
   *   2. Recover the signer via recoverTypedDataAddress
   *   3. Validate `from` matches recovered signer
   *   4. Validate deadline (validBefore) has not passed
   *   5. Validate validAfter has passed
   *   6. Validate `to` matches merchant/facilitator address
   *   7. Validate `value >= requiredAmount` (both in atomic units)
   *
   * @param paymentPayload - Decoded x402 v2 payment payload
   * @param tokenMeta - Token metadata for EIP-712 domain construction
   * @param chainId - EVM chain ID for the domain separator
   * @param merchantAddress - Expected recipient (facilitator) address
   * @returns The verified payer address
   * @throws PaymentVerificationFailedError, InsufficientPaymentError
   */
  verifyExactPayment(
    paymentPayload: PaymentPayloadV2,
    tokenMeta: TokenMeta,
    chainId: number,
    merchantAddress: string,
  ): Promise<{ payer: Address }>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createExactVerifyService(): IExactVerifyService {
  return {
    async verifyExactPayment(
      paymentPayload: PaymentPayloadV2,
      tokenMeta: TokenMeta,
      chainId: number,
      merchantAddress: string,
    ): Promise<{ payer: Address }> {
      // 1. Extract authorization data from the payload
      const payloadData = paymentPayload.payload as Record<string, unknown>;
      const authData = payloadData["authorization"] as
        | Record<string, unknown>
        | undefined;
      const signature = payloadData["signature"] as Hex | undefined;

      if (!authData) {
        throw new PaymentVerificationFailedError(
          "Missing authorization data in payment payload",
        );
      }
      if (!signature || typeof signature !== "string") {
        throw new PaymentVerificationFailedError(
          "Missing or invalid signature in payment payload",
        );
      }

      // 2. Parse and validate authorization fields
      const from = getAddress(authData["from"] as string);
      const to = getAddress(authData["to"] as string);
      const value = BigInt(authData["value"] as string);
      const validAfter = BigInt(authData["validAfter"] as string);
      const validBefore = BigInt(authData["validBefore"] as string);
      const nonce = authData["nonce"] as Hex;

      // 3. Verify `to` matches merchant address
      const expectedPayTo = getAddress(merchantAddress);
      if (to.toLowerCase() !== expectedPayTo.toLowerCase()) {
        throw new PaymentVerificationFailedError(
          `Authorization 'to' address (${to}) does not match merchant address (${expectedPayTo})`,
        );
      }

      // 4. Build EIP-712 typed data and recover signer
      const typedData: TypedDataDefinition<
        typeof EIP3009_TYPES,
        typeof EIP3009_PRIMARY_TYPE
      > = {
        domain: {
          name: tokenMeta.name,
          version: tokenMeta.version,
          chainId,
          verifyingContract: getAddress(tokenMeta.address),
        },
        types: EIP3009_TYPES,
        primaryType: EIP3009_PRIMARY_TYPE,
        message: {
          from,
          to,
          value,
          validAfter,
          validBefore,
          nonce,
        },
      };

      // Pre-hash the typed data for error messages
      let recoveredAddress: Address;
      try {
        recoveredAddress = await recoverTypedDataAddress({
          ...typedData,
          signature,
        });
      } catch (error) {
        throw new PaymentVerificationFailedError(
          `EIP-712 signature recovery failed: ${(error as Error).message}`,
        );
      }

      // 5. Verify recovered signer matches `from`
      if (recoveredAddress.toLowerCase() !== from.toLowerCase()) {
        throw new PaymentVerificationFailedError(
          `Signature signer (${recoveredAddress}) does not match authorization 'from' address (${from})`,
        );
      }

      // 6. Validate temporal constraints
      const nowSec = BigInt(Math.floor(Date.now() / 1000));
      if (nowSec > validBefore) {
        throw new PaymentVerificationFailedError(
          `Authorization expired: validBefore=${validBefore}, current time=${nowSec}`,
        );
      }
      if (nowSec < validAfter) {
        throw new PaymentVerificationFailedError(
          `Authorization not yet active: validAfter=${validAfter}, current time=${nowSec}`,
        );
      }

      // 7. Validate payment sufficiency
      const requiredAmountStr = paymentPayload.accepted.amount;
      const requiredAmount = parseAmount(requiredAmountStr, tokenMeta.decimals);

      if (value < requiredAmount) {
        throw new InsufficientPaymentError(
          requiredAmount.toString(),
          value.toString(),
        );
      }

      return { payer: from };
    },
  };
}
