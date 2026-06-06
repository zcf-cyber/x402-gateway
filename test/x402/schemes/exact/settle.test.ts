import { describe, it, expect } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { createExactSettleService } from "../../../../src/x402/schemes/exact/settle.service.js";
import type { PaymentPayloadV2 } from "../../../../src/x402/transport/types.js";

describe("ExactSettleService", () => {
  const privateKey = generatePrivateKey();
  const service = createExactSettleService({
    facilitatorPrivateKey: privateKey,
  });

  it("should create a settle service instance", () => {
    expect(service).toBeDefined();
    expect(typeof service.settlePayment).toBe("function");
  });

  it("should return error when payment payload has no signature", async () => {
    const payload: PaymentPayloadV2 = {
      x402Version: 2,
      accepted: {
        scheme: "exact",
        network: "eip155:8453",
        asset: "USDC",
        amount: "0.001",
        payTo: "0x0000000000000000000000000000000000000001",
        maxTimeoutSeconds: 300,
        extra: {},
      },
      payload: {},
    };

    // This will fail because there's no valid RPC, but we test the error path
    const result = await service.settlePayment(
      payload,
      { id: 8453, name: "Base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [] } } } as import("viem").Chain,
      "https://mainnet.base.org",
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    );

    // Should return a SettlementResponseV2 with success=false
    expect(result.success).toBe(false);
    expect(result.errorReason).toBe("missing_signature");
    expect(result.network).toBe("eip155:8453");
  });
});
