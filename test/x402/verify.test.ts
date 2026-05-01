import { describe, it, expect } from "vitest";
import {
  createPaymentVerifyService,
} from "../../src/x402/verify/index.js";
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
