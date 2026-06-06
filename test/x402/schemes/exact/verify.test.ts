import { describe, it, expect } from "vitest";
import { getAddress, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createExactVerifyService } from "../../../../src/x402/schemes/exact/verify.service.js";
import type { TokenMeta } from "../../../../src/x402/schemes/exact/verify.service.js";
import type { PaymentPayloadV2 } from "../../../../src/x402/transport/types.js";

// Test constants
const TEST_TOKEN: TokenMeta = {
  name: "USD Coin",
  version: "2",
  address: getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
  decimals: 6,
};

const TEST_CHAIN_ID = 8453; // Base mainnet
const MERCHANT_ADDRESS = getAddress(
  "0x0000000000000000000000000000000000000001",
);

const service = createExactVerifyService();

/**
 * Create a signed EIP-3009 PaymentPayloadV2 for testing.
 *
 * @param overrides - Override authorization fields
 * @param signerPrivateKey - Optional specific private key for signing.
 *   If provided, the signer's address becomes the authorization.from.
 *   If not provided, a random key is generated internally.
 */
async function createSignedPayload(
  overrides?: {
    from?: Address;
    to?: Address;
    value?: bigint;
    validAfter?: bigint;
    validBefore?: bigint;
    amount?: string;
    chainId?: number;
  },
  signerPrivateKey?: `0x${string}`,
): Promise<PaymentPayloadV2> {
  const privateKey = signerPrivateKey ?? generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const chainId = overrides?.chainId ?? TEST_CHAIN_ID;

  const authorization = {
    from: overrides?.from ?? account.address,
    to: overrides?.to ?? MERCHANT_ADDRESS,
    value: (overrides?.value ?? 1000000n).toString(),
    validAfter: (overrides?.validAfter ?? 0n).toString(),
    validBefore: (
      overrides?.validBefore ??
      BigInt(Math.floor(Date.now() / 1000) + 3600)
    ).toString(),
    nonce:
      "0x0000000000000000000000000000000000000000000000000000000000000001",
  };

  const signature = await account.signTypedData({
    domain: {
      name: TEST_TOKEN.name,
      version: TEST_TOKEN.version,
      chainId,
      verifyingContract: TEST_TOKEN.address,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: getAddress(authorization.from),
      to: getAddress(authorization.to),
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce as `0x${string}`,
    },
  });

  return {
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: `eip155:${chainId}`,
      asset: "USDC",
      amount: overrides?.amount ?? "0.001",
      payTo: overrides?.to ?? MERCHANT_ADDRESS,
      maxTimeoutSeconds: 300,
      extra: { quote_id: "test-q", request_hash: "rh_test" },
    },
    payload: {
      signature,
      authorization,
    },
  };
}

describe("ExactVerifyService — EIP-3009", () => {
  it("should verify a valid EIP-3009 signature successfully", async () => {
    const payload = await createSignedPayload();
    const result = await service.verifyExactPayment(
      payload,
      TEST_TOKEN,
      TEST_CHAIN_ID,
      MERCHANT_ADDRESS,
    );

    expect(result.payer).toBeTruthy();
    expect(typeof result.payer).toBe("string");
    expect(result.payer).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it("should verify and return the correct payer address", async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    // Pass the signer's private key so the signature comes from this account
    const payload = await createSignedPayload({}, privateKey);

    const result = await service.verifyExactPayment(
      payload,
      TEST_TOKEN,
      TEST_CHAIN_ID,
      MERCHANT_ADDRESS,
    );

    expect(result.payer.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it("should reject when 'to' address does not match merchant", async () => {
    const wrongMerchant = getAddress(
      "0x0000000000000000000000000000000000000002",
    );
    const payload = await createSignedPayload({
      to: wrongMerchant,
    });

    await expect(
      service.verifyExactPayment(
        payload,
        TEST_TOKEN,
        TEST_CHAIN_ID,
        MERCHANT_ADDRESS,
      ),
    ).rejects.toThrow(/does not match merchant address/);
  });

  it("should reject expired authorization (validBefore in past)", async () => {
    const payload = await createSignedPayload({
      validBefore: BigInt(Math.floor(Date.now() / 1000) - 60), // 1 min ago
    });

    await expect(
      service.verifyExactPayment(
        payload,
        TEST_TOKEN,
        TEST_CHAIN_ID,
        MERCHANT_ADDRESS,
      ),
    ).rejects.toThrow(/expired/);
  });

  it("should reject not-yet-valid authorization (validAfter in future)", async () => {
    const payload = await createSignedPayload({
      validAfter: BigInt(Math.floor(Date.now() / 1000) + 3600), // 1 hour in future
    });

    await expect(
      service.verifyExactPayment(
        payload,
        TEST_TOKEN,
        TEST_CHAIN_ID,
        MERCHANT_ADDRESS,
      ),
    ).rejects.toThrow(/not yet active/);
  });

  it("should reject insufficient payment amount", async () => {
    // value = 500 (0.0005 USDC for 6 decimals), but required = 0.001 USDC (1000 units)
    const payload = await createSignedPayload({
      value: 500n,
      amount: "0.001", // requires 1000 units
    });

    await expect(
      service.verifyExactPayment(
        payload,
        TEST_TOKEN,
        TEST_CHAIN_ID,
        MERCHANT_ADDRESS,
      ),
    ).rejects.toThrow(/Insufficient payment/);
  });

  it("should reject missing authorization data", async () => {
    const payload: PaymentPayloadV2 = {
      x402Version: 2,
      accepted: {
        scheme: "exact",
        network: "eip155:8453",
        asset: "USDC",
        amount: "0.001",
        payTo: MERCHANT_ADDRESS,
        maxTimeoutSeconds: 300,
        extra: {},
      },
      payload: {},
    };

    await expect(
      service.verifyExactPayment(
        payload,
        TEST_TOKEN,
        TEST_CHAIN_ID,
        MERCHANT_ADDRESS,
      ),
    ).rejects.toThrow(/Missing authorization data/);
  });

  it("should reject missing signature", async () => {
    const payload: PaymentPayloadV2 = {
      x402Version: 2,
      accepted: {
        scheme: "exact",
        network: "eip155:8453",
        asset: "USDC",
        amount: "0.001",
        payTo: MERCHANT_ADDRESS,
        maxTimeoutSeconds: 300,
        extra: {},
      },
      payload: {
        authorization: {
          from: MERCHANT_ADDRESS,
          to: MERCHANT_ADDRESS,
          value: "1000000",
          validAfter: "0",
          validBefore: "9999999999",
          nonce: "0x0000000000000000000000000000000000000000000000000000000000000001",
        },
      },
    };

    await expect(
      service.verifyExactPayment(
        payload,
        TEST_TOKEN,
        TEST_CHAIN_ID,
        MERCHANT_ADDRESS,
      ),
    ).rejects.toThrow(/Missing.*signature/);
  });

  it("should reject tampered signature", async () => {
    const payload = await createSignedPayload();
    // Tamper with the signature
    const sigData = payload.payload as Record<string, unknown>;
    const sig = sigData["signature"] as string;
    const tamperedSig =
      sig.slice(0, -4) +
      (sig[sig.length - 1] === "a" ? "b" : "a") +
      sig.slice(-3);
    sigData["signature"] = tamperedSig;

    await expect(
      service.verifyExactPayment(
        payload,
        TEST_TOKEN,
        TEST_CHAIN_ID,
        MERCHANT_ADDRESS,
      ),
    ).rejects.toThrow();
  });

  it("should reject when signer does not match from address", async () => {
    const privateKey1 = generatePrivateKey();
    const account1 = privateKeyToAccount(privateKey1);
    const privateKey2 = generatePrivateKey();
    const account2 = privateKeyToAccount(privateKey2);

    // Create an authorization where from=account1 but signed by account2
    const authorization = {
      from: account1.address,
      to: MERCHANT_ADDRESS,
      value: "1000000",
      validAfter: "0",
      validBefore: BigInt(
        Math.floor(Date.now() / 1000) + 3600,
      ).toString(),
      nonce:
        "0x0000000000000000000000000000000000000000000000000000000000000001",
    };

    const signature = await account2.signTypedData({
      domain: {
        name: TEST_TOKEN.name,
        version: TEST_TOKEN.version,
        chainId: TEST_CHAIN_ID,
        verifyingContract: TEST_TOKEN.address,
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: getAddress(authorization.from),
        to: getAddress(authorization.to),
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce as `0x${string}`,
      },
    });

    const payload: PaymentPayloadV2 = {
      x402Version: 2,
      accepted: {
        scheme: "exact",
        network: "eip155:8453",
        asset: "USDC",
        amount: "0.001",
        payTo: MERCHANT_ADDRESS,
        maxTimeoutSeconds: 300,
        extra: {},
      },
      payload: { signature, authorization },
    };

    await expect(
      service.verifyExactPayment(
        payload,
        TEST_TOKEN,
        TEST_CHAIN_ID,
        MERCHANT_ADDRESS,
      ),
    ).rejects.toThrow(/does not match/);
  });
});

describe("ExactVerifyService — TokenMeta", () => {
  it("should work with different chain IDs", async () => {
    // Create payload signed for chain ID 1 (Ethereum mainnet).
    // Use the same TEST_TOKEN (USD Coin name, Base USDC address) for domain consistency.
    const payload = await createSignedPayload({ chainId: 1 });
    const result = await service.verifyExactPayment(
      payload,
      TEST_TOKEN,
      1, // Must match the chain ID used for signing
      MERCHANT_ADDRESS,
    );
    expect(result.payer).toBeTruthy();
  });
});
