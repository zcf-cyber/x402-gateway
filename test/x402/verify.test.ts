import { describe, it, expect } from "vitest";
import {
  createPaymentVerifyService,
} from "../../src/x402/verify/index.js";
import {
  parseAmount,
  getAssetDecimals,
} from "../../src/x402/verify/evm-verify.service.js";
import { createChainRegistry } from "../../src/x402/chain-registry.service.js";
import { PaymentVerificationFailedError } from "../../src/errors.js";

describe("PaymentVerifyService", () => {
  const registry = createChainRegistry();
  registry.register("base", {
    chain: { id: 8453, name: "Base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [] } } } as import("viem").Chain,
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    rpcUrl: "https://mainnet.base.org",
  });

  const service = createPaymentVerifyService({ chainRegistry: registry });

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
    await expect(service.verifyPayment(proof, challenge)).rejects.toThrow(
      "Unsupported chain: unsupported-chain",
    );
  });

  it("should throw PaymentVerificationFailedError for unsupported chain (case insensitive)", async () => {
    const proof = {
      tx_hash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      chain: "UNSUPPORTED",
      payer_address: "0x0000000000000000000000000000000000000001",
    };
    const challenge = {
      quote_id: "test-quote",
      request_hash: "rh_test",
      amount: "0.001",
      asset: "USDC",
      chain: "UNSUPPORTED",
      merchant_address: "0x0000000000000000000000000000000000000002",
      expires_at: new Date(Date.now() + 300000).toISOString(),
    };

    await expect(service.verifyPayment(proof, challenge)).rejects.toThrow(
      PaymentVerificationFailedError,
    );
    await expect(service.verifyPayment(proof, challenge)).rejects.toThrow(
      "Unsupported chain: UNSUPPORTED",
    );
  });
});

describe("parseAmount", () => {
  it("should parse decimal amount according to token decimals", () => {
    // 0.001 * 10^6 = 1000 (USDC)
    expect(parseAmount("0.001", 6)).toBe(1000n);
    // 1.5 * 10^6 = 1_500_000 (USDC)
    expect(parseAmount("1.5", 6)).toBe(1500000n);
    // 0.001 * 10^18 = 10^15 (ETH)
    expect(parseAmount("0.001", 18)).toBe(1000000000000000n);
    // 1.5 * 10^18 = 1.5 * 10^18 (ETH)
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
    // Supports future tokens with arbitrary decimals (e.g. 8, 9, 12)
    expect(parseAmount("0.1", 8)).toBe(10000000n);
    expect(parseAmount("0.1", 9)).toBe(100000000n);
    expect(parseAmount("0.1", 12)).toBe(100000000000n);
  });
});

describe("getAssetDecimals", () => {
  it("should return 6 for USDC", () => {
    expect(getAssetDecimals("USDC")).toBe(6);
    expect(getAssetDecimals("usdc")).toBe(6);
    expect(getAssetDecimals("Usdc")).toBe(6);
  });

  it("should return 18 for native assets and unknown tokens", () => {
    expect(getAssetDecimals("ETH")).toBe(18);
    expect(getAssetDecimals("MATIC")).toBe(18);
    expect(getAssetDecimals("BASE")).toBe(18);
    expect(getAssetDecimals("UNKNOWN")).toBe(18);
  });
});

describe("USDC decimal bug fix (issue #56)", () => {
  it("should normalize requiredAmount to token decimals for comparison", () => {
    // Bug: parseAmount("0.001") defaulted to 18 decimals = 10^15
    // USDC transfer value on-chain for 0.001 USDC = 1000 (6 decimals)
    // 1000 < 10^15 would falsely trigger insufficient_payment
    const usdcDecimals = getAssetDecimals("USDC");
    const requiredAmount = parseAmount("0.001", usdcDecimals);
    const onChainTransferValue = 1000n; // 0.001 USDC in 6 decimals

    expect(requiredAmount).toBe(1000n);
    expect(onChainTransferValue).toBeGreaterThanOrEqual(requiredAmount);
  });

  it("should still reject payment below required amount", () => {
    const usdcDecimals = getAssetDecimals("USDC");
    const requiredAmount = parseAmount("0.001", usdcDecimals); // 1000n
    const onChainTransferValue = 500n; // 0.0005 USDC in 6 decimals

    expect(onChainTransferValue).toBeLessThan(requiredAmount);
  });
});
