// ---------------------------------------------------------------------------
// x402 Exact Scheme — EIP-3009 Settlement Service
//
// Submits transferWithAuthorization transactions to settle x402 payments.
// Uses viem WalletClient for transaction signing and submission.
//
// EIP-3009 `transferWithAuthorization` ABI fragment:
//   function transferWithAuthorization(
//     address from,
//     address to,
//     uint256 value,
//     uint256 validAfter,
//     uint256 validBefore,
//     bytes32 nonce,
//     uint8 v,
//     bytes32 r,
//     bytes32 s
//   )
// ---------------------------------------------------------------------------

import {
  createWalletClient,
  http,
  getAddress,
  parseSignature,
  encodeFunctionData,
  type Address,
  type Hex,
  type Chain,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { PaymentPayloadV2 } from "../../transport/types.js";
import type { SettlementResponseV2 } from "../../transport/types.js";

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface IExactSettleService {
  /**
   * Settle an x402 exact payment by submitting a transferWithAuthorization
   * transaction to the blockchain.
   *
   * @param paymentPayload - Verified x402 v2 payment payload
   * @param chain - Viem chain config (e.g., base mainnet)
   * @param rpcUrl - RPC URL for the target chain
   * @param tokenAddress - ERC-20 token contract address (e.g., USDC)
   * @returns Settlement response with transaction hash
   */
  settlePayment(
    paymentPayload: PaymentPayloadV2,
    chain: Chain,
    rpcUrl: string,
    tokenAddress: Address,
  ): Promise<SettlementResponseV2>;
}

// ---------------------------------------------------------------------------
// EIP-3009 transferWithAuthorization ABI
// ---------------------------------------------------------------------------

const transferWithAuthorizationAbi = [
  {
    type: "function",
    name: "transferWithAuthorization",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

// ---------------------------------------------------------------------------
// Helper: parse EIP-712 signature into (v, r, s) components
// ---------------------------------------------------------------------------

function parseEip712Signature(sig: Hex): { v: number; r: Hex; s: Hex } {
  const parsed = parseSignature(sig);
  const v = Number(parsed.v ?? 0n);
  // Normalize v for EIP-1559 / EIP-712 (no chain-specific offset needed)
  return { v, r: parsed.r, s: parsed.s };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createExactSettleService(deps: {
  /** Private key for the facilitator wallet (hex, with or without 0x prefix). */
  facilitatorPrivateKey: string;
}): IExactSettleService {
  const { facilitatorPrivateKey } = deps;

  // Derive the account from the private key
  const account: Account = privateKeyToAccount(
    facilitatorPrivateKey.startsWith("0x")
      ? (facilitatorPrivateKey as Hex)
      : (`0x${facilitatorPrivateKey}` as Hex),
  );

  return {
    async settlePayment(
      paymentPayload: PaymentPayloadV2,
      chain: Chain,
      rpcUrl: string,
      tokenAddress: Address,
    ): Promise<SettlementResponseV2> {
      const payloadData = paymentPayload.payload as Record<string, unknown>;
      const authData = (payloadData["authorization"] ?? {}) as Record<
        string,
        unknown
      >;
      const signature = payloadData["signature"] as Hex;

      if (!signature) {
        return {
          success: false,
          errorReason: "missing_signature",
          errorMessage: "No signature in payment payload for settlement",
          transaction: "",
          network: paymentPayload.accepted.network,
        };
      }

      // Build wallet + public clients
      const walletClient = createWalletClient({
        account,
        chain,
        transport: http(rpcUrl),
      });

      // Parse EIP-712 signature into v/r/s
      const { v, r, s } = parseEip712Signature(signature);

      const fromAddr = getAddress(authData["from"] as string);
      const toAddr = getAddress(authData["to"] as string);
      const value = BigInt(authData["value"] as string);
      const validAfter = BigInt(authData["validAfter"] as string);
      const validBefore = BigInt(authData["validBefore"] as string);
      const nonce = authData["nonce"] as Hex;

      // Submit transferWithAuthorization transaction
      let txHash: Hex;
      try {
        txHash = await walletClient.sendTransaction({
          to: tokenAddress,
          data: encodeFunctionData({
            abi: transferWithAuthorizationAbi,
            functionName: "transferWithAuthorization",
            args: [
              fromAddr,
              toAddr,
              value,
              validAfter,
              validBefore,
              nonce,
              v,
              r,
              s,
            ],
          }),
        });
      } catch (error) {
        return {
          success: false,
          errorReason: "settlement_tx_failed",
          errorMessage: (error as Error).message,
          transaction: "",
          network: paymentPayload.accepted.network,
        };
      }

      return {
        success: true,
        payer: fromAddr,
        transaction: txHash,
        network: paymentPayload.accepted.network,
        amount: value.toString(),
      };
    },
  };
}
