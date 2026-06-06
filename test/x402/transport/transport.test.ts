import { describe, it, expect } from "vitest";
import {
  encodePaymentRequired,
  encodeSettlementResponse,
} from "../../../src/x402/transport/encode.js";
import { decodePaymentPayload } from "../../../src/x402/transport/decode.js";
import { chainToCaip2, caip2ToChain, isKnownCaip2 } from "../../../src/x402/transport/caip2.js";
import type {
  PaymentRequirementsV2,
  PaymentPayloadV2,
  SettlementResponseV2,
} from "../../../src/x402/transport/types.js";

// ---------------------------------------------------------------------------
// CAIP-2 Conversion Tests
// ---------------------------------------------------------------------------

describe("CAIP-2 chain conversion", () => {
  it.each([
    { chain: "base", caip2: "eip155:8453" },
    { chain: "ethereum", caip2: "eip155:1" },
    { chain: "polygon", caip2: "eip155:137" },
    { chain: "arbitrum", caip2: "eip155:42161" },
    { chain: "optimism", caip2: "eip155:10" },
    { chain: "avalanche", caip2: "eip155:43114" },
    { chain: "ethereum-sepolia", caip2: "eip155:11155111" },
    { chain: "base-sepolia", caip2: "eip155:84532" },
  ])("chainToCaip2($chain) → $caip2", ({ chain, caip2 }) => {
    expect(chainToCaip2(chain)).toBe(caip2);
  });

  it.each([
    { caip2: "eip155:8453", chain: "base" },
    { caip2: "eip155:1", chain: "ethereum" },
    { caip2: "eip155:137", chain: "polygon" },
  ])("caip2ToChain($caip2) → $chain", ({ caip2, chain }) => {
    expect(caip2ToChain(caip2)).toBe(chain);
  });

  it("chainToCaip2 should throw for unknown chain", () => {
    expect(() => chainToCaip2("unknown-chain")).toThrow(
      "Unknown chain name",
    );
  });

  it("caip2ToChain should throw for unknown CAIP-2", () => {
    expect(() => caip2ToChain("eip155:99999")).toThrow(
      "Unknown CAIP-2 identifier",
    );
  });

  it("isKnownCaip2 should return true for known identifiers", () => {
    expect(isKnownCaip2("eip155:8453")).toBe(true);
    expect(isKnownCaip2("eip155:1")).toBe(true);
  });

  it("isKnownCaip2 should return false for unknown identifiers", () => {
    expect(isKnownCaip2("eip155:99999")).toBe(false);
    expect(isKnownCaip2("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Encode / Decode Round-trip Tests
// ---------------------------------------------------------------------------

describe("Transport encode/decode round-trip", () => {
  it("encodePaymentRequired → decode should be reversible", () => {
    const requirements: PaymentRequirementsV2[] = [
      {
        scheme: "exact",
        network: "eip155:8453",
        asset: "USDC",
        amount: "0.001",
        payTo: "0x0000000000000000000000000000000000000001",
        maxTimeoutSeconds: 300,
        extra: {
          quote_id: "test-quote-123",
          request_hash: "rh_test_hash",
        },
      },
    ];

    const encoded = encodePaymentRequired(requirements);
    expect(encoded).toBeTruthy();
    expect(typeof encoded).toBe("string");

    // Decode back
    const decoded = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf-8"),
    );
    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepts).toHaveLength(1);
    expect(decoded.accepts[0].scheme).toBe("exact");
    expect(decoded.accepts[0].network).toBe("eip155:8453");
    expect(decoded.accepts[0].asset).toBe("USDC");
    expect(decoded.accepts[0].amount).toBe("0.001");
    expect(decoded.accepts[0].payTo).toBe(
      "0x0000000000000000000000000000000000000001",
    );
  });

  it("encodeSettlementResponse round-trip", () => {
    const response: SettlementResponseV2 = {
      success: true,
      payer: "0x1234567890123456789012345678901234567890",
      transaction:
        "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      network: "eip155:8453",
      amount: "1000000",
    };

    const encoded = encodeSettlementResponse(response);
    expect(encoded).toBeTruthy();

    const decoded = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf-8"),
    ) as SettlementResponseV2;
    expect(decoded.success).toBe(true);
    expect(decoded.payer).toBe(
      "0x1234567890123456789012345678901234567890",
    );
    expect(decoded.transaction).toBe(response.transaction);
    expect(decoded.network).toBe("eip155:8453");
  });

  it("decodePaymentPayload should parse valid PAYMENT-SIGNATURE header", () => {
    const payload: PaymentPayloadV2 = {
      x402Version: 2,
      accepted: {
        scheme: "exact",
        network: "eip155:8453",
        asset: "USDC",
        amount: "0.001",
        payTo: "0x0000000000000000000000000000000000000001",
        maxTimeoutSeconds: 300,
        extra: {
          quote_id: "test-quote",
          request_hash: "rh_test",
        },
      },
      payload: {
        signature:
          "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1b",
        authorization: {
          from: "0x1234567890123456789012345678901234567890",
          to: "0x0000000000000000000000000000000000000001",
          value: "1000000",
          validAfter: "0",
          validBefore: "9999999999",
          nonce:
            "0x0000000000000000000000000000000000000000000000000000000000000001",
        },
      },
    };

    const header = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const decoded = decodePaymentPayload(header);

    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepted.scheme).toBe("exact");
    expect(decoded.accepted.network).toBe("eip155:8453");
    expect(decoded.accepted.amount).toBe("0.001");
    expect((decoded.payload as Record<string, unknown>)["signature"]).toBe(
      payload.payload["signature"],
    );
  });

  it("decodePaymentPayload should throw for empty header", () => {
    expect(() => decodePaymentPayload("")).toThrow(
      "Empty PAYMENT-SIGNATURE header",
    );
  });

  it("decodePaymentPayload should throw for invalid base64url", () => {
    // Buffer.from with invalid base64url silently produces garbage bytes,
    // which then fail JSON.parse.
    expect(() => decodePaymentPayload("!!!not-valid-base64!!!")).toThrow(
      "not valid JSON",
    );
  });

  it("decodePaymentPayload should throw for invalid JSON", () => {
    const encoded = Buffer.from("not json").toString("base64url");
    expect(() => decodePaymentPayload(encoded)).toThrow("not valid JSON");
  });

  it("decodePaymentPayload should throw if missing accepted field", () => {
    const encoded = Buffer.from(
      JSON.stringify({ x402Version: 2 }),
    ).toString("base64url");
    expect(() => decodePaymentPayload(encoded)).toThrow(
      "missing 'accepted' field",
    );
  });
});

// ---------------------------------------------------------------------------
// Real-world scenarios
// ---------------------------------------------------------------------------

describe("Transport real-world scenarios", () => {
  it("should produce a header compatible with x402 v2 spec format", () => {
    const requirements: PaymentRequirementsV2[] = [
      {
        scheme: "exact",
        network: "eip155:8453",
        asset: "USDC",
        amount: "0.05",
        payTo: "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B",
        maxTimeoutSeconds: 300,
        extra: {},
      },
    ];

    const header = encodePaymentRequired(requirements);
    // The header should be a valid base64url string
    expect(header).toMatch(/^[A-Za-z0-9_-]+$/);

    // Should be decodable
    const decoded = Buffer.from(header, "base64url").toString("utf-8");
    const parsed = JSON.parse(decoded);
    expect(parsed.x402Version).toBe(2);
    expect(parsed.accepts).toHaveLength(1);
    expect(parsed.accepts[0].payTo).toBe(
      "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B",
    );
  });
});
