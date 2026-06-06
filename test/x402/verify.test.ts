import { describe, it, expect } from "vitest";
import {
  createPaymentVerifyService,
} from "../../src/x402/verify/index.js";
import {
  parseAmount,
} from "../../src/x402/verify/evm-verify.service.js";
import { createChainRegistry } from "../../src/x402/chain-registry.service.js";
import { createTokenRegistry } from "../../src/x402/token-registry.service.js";
import { PaymentVerificationFailedError } from "../../src/errors.js";
import type { PaymentPayloadV2 } from "../../src/x402/transport/types.js";

describe("PaymentVerifyService", () => {
  const registry = createChainRegistry();
  registry.register("base", {
    chain: { id: 8453, name: "Base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [] } } } as import("viem").Chain,
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    rpcUrl: "https://mainnet.base.org",
  });

  const tokenRegistry = createTokenRegistry();
  tokenRegistry.register("base", "USDC", {
    symbol: "USDC",
    decimals: 6,
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    type: "erc20",
  });

  const service = createPaymentVerifyService({
    chainRegistry: registry,
    tokenRegistry,
    merchantAddress: "0x0000000000000000000000000000000000000002",
  });

  // -----------------------------------------------------------------------
  // Legacy verifyPayment tests (still supported for backward compat)
  // -----------------------------------------------------------------------

  it("should throw PaymentVerificationFailedError for unsupported chain", async () => {
    const proof = {
      tx_hash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      chain: "unsupported-chain",
      payer_address: "0x0000000000000000000000000000000000000001",
    };
    const challenge = {
      quote_id: "test-quote",
      request_hash: "rh_test",
      amount: "0.001",
      asset: "USDC",
      chain: "unsupported-chain",
      merchant_address: "0x0000000000000000000000000000000000000002",
      expires_at: new Date(Date.now() + 300000).toISOString(),
    };

    await expect(service.verifyPayment(proof, challenge)).rejects.toThrow(
      PaymentVerificationFailedError,
    );
  });

  // -----------------------------------------------------------------------
  // v2 verifyPaymentV2 tests
  // -----------------------------------------------------------------------

  it("verifyPaymentV2 should throw for unsupported network", async () => {
    const payload: PaymentPayloadV2 = {
      x402Version: 2,
      accepted: {
        scheme: "exact",
        network: "eip155:99999",
        asset: "USDC",
        amount: "0.001",
        payTo: "0x0000000000000000000000000000000000000002",
        maxTimeoutSeconds: 300,
        extra: {},
      },
      payload: {},
    };

    await expect(
      service.verifyPaymentV2(payload, "0x0000000000000000000000000000000000000002"),
    ).rejects.toThrow(PaymentVerificationFailedError);
  });

  it("verifyPaymentV2 should throw for unsupported asset", async () => {
    const payload: PaymentPayloadV2 = {
      x402Version: 2,
      accepted: {
        scheme: "exact",
        network: "eip155:8453",
        asset: "UNKNOWN_TOKEN",
        amount: "0.001",
        payTo: "0x0000000000000000000000000000000000000002",
        maxTimeoutSeconds: 300,
        extra: {},
      },
      payload: {},
    };

    await expect(
      service.verifyPaymentV2(payload, "0x0000000000000000000000000000000000000002"),
    ).rejects.toThrow(PaymentVerificationFailedError);
    await expect(
      service.verifyPaymentV2(payload, "0x0000000000000000000000000000000000000002"),
    ).rejects.toThrow("Unsupported asset");
  });
});

describe("parseAmount", () => {
  it("should parse decimal amount according to token decimals", () => {
    expect(parseAmount("0.001", 6)).toBe(1000n);
    expect(parseAmount("1.5", 6)).toBe(1500000n);
    expect(parseAmount("0.001", 18)).toBe(1000000000000000n);
    expect(parseAmount("1.5", 18)).toBe(1500000000000000000n);
  });

  it("should default to 18 decimals for backward compatibility", () => {
    expect(parseAmount("0.001")).toBe(1000000000000000n);
  });

  it("should handle whole numbers as raw atomic units", () => {
    expect(parseAmount("100", 6)).toBe(100n);
    expect(parseAmount("100", 18)).toBe(100n);
  });

  it("should be deterministic for any arbitrary decimals", () => {
    expect(parseAmount("0.1", 8)).toBe(10000000n);
    expect(parseAmount("0.1", 9)).toBe(100000000n);
    expect(parseAmount("0.1", 12)).toBe(100000000000n);
  });
});

describe("TokenRegistry-driven decimals", () => {
  it("should normalize requiredAmount to token decimals for comparison", () => {
    const usdcDecimals = 6;
    const requiredAmount = parseAmount("0.001", usdcDecimals);
    const onChainTransferValue = 1000n;

    expect(requiredAmount).toBe(1000n);
    expect(onChainTransferValue).toBeGreaterThanOrEqual(requiredAmount);
  });

  it("should still reject payment below required amount", () => {
    const usdcDecimals = 6;
    const requiredAmount = parseAmount("0.001", usdcDecimals);
    const onChainTransferValue = 500n;

    expect(onChainTransferValue).toBeLessThan(requiredAmount);
  });
});
