import { describe, it, expect, vi } from "vitest";
import {
  createSolanaVerifyService,
  SOLANA_USDC_MINT,
  SPL_TOKEN_PROGRAM_ID,
} from "../../src/x402/verify/solana-verify.service.js";
import { createTokenRegistry } from "../../src/x402/token-registry.service.js";
import {
  PaymentVerificationFailedError,
  InsufficientPaymentError,
} from "../../src/errors.js";

// Mock @solana/web3.js Connection and PublicKey
vi.mock("@solana/web3.js", () => ({
  Connection: vi.fn(),
  PublicKey: vi.fn((value: string) => ({
    toBase58: () => value,
    toString: () => value,
  })),
}));

describe("SolanaVerifyService", () => {
  const mockRpcUrl = "https://api.mainnet-beta.solana.com";
  const payerAddress = "Payer111111111111111111111111111111111111111";
  const merchantAddress = "Merchant111111111111111111111111111111111111";
  const txSignature = "5VxPdN7fm6zQy1ZbYBHpJzgCCHkVWgTQe9FxWkBnjRaDqRqDqzrb7KMYE5YqRqDqzrb7KMYE5YqRqDqzrb7KMYE5";

  const tokenRegistry = createTokenRegistry();
  tokenRegistry.register("solana", "USDC", {
    symbol: "USDC",
    decimals: 6,
    address: SOLANA_USDC_MINT,
    type: "erc20",
  });

  function buildMockConnection(getParsedTransactionResult: unknown) {
    return {
      getParsedTransaction: vi.fn().mockResolvedValue(getParsedTransactionResult),
    };
  }

  function buildChallenge(amount = "0.001") {
    return {
      quote_id: "test-quote",
      request_hash: "rh_test",
      amount,
      asset: "USDC",
      chain: "solana",
      merchant_address: merchantAddress,
      expires_at: new Date(Date.now() + 300000).toISOString(),
    };
  }

  function baseMockTx(
    overrides: {
      instructions?: unknown[];
      preTokenBalances?: unknown[];
      postTokenBalances?: unknown[];
      err?: unknown;
    } = {},
  ) {
    return {
      meta: {
        err: overrides.err ?? null,
        preTokenBalances: overrides.preTokenBalances ?? [],
        postTokenBalances: overrides.postTokenBalances ?? [],
      },
      transaction: {
        message: {
          accountKeys: [
            { pubkey: { toBase58: () => payerAddress } },
            { pubkey: { toBase58: () => "TokenAccount1111111111111111111111111111" } },
            { pubkey: { toBase58: () => "TokenAccount2222222222222222222222222222" } },
          ],
          instructions: overrides.instructions ?? [],
        },
      },
    };
  }

  it("should throw PaymentVerificationFailedError when Solana RPC fails", async () => {
    const { Connection } = await import("@solana/web3.js");
    const mockConn = buildMockConnection(null);
    mockConn.getParsedTransaction.mockRejectedValue(new Error("Network error"));
    vi.mocked(Connection).mockImplementation(() => mockConn as unknown as import("@solana/web3.js").Connection);

    const service = createSolanaVerifyService({ rpcUrl: mockRpcUrl, tokenRegistry });
    const proof = { tx_hash: txSignature, chain: "solana", payer_address: payerAddress };

    await expect(service.verifyPayment(proof, buildChallenge())).rejects.toThrow(
      PaymentVerificationFailedError,
    );
  });

  it("should throw PaymentVerificationFailedError for invalid signature format", async () => {
    const { Connection } = await import("@solana/web3.js");
    const mockConn = buildMockConnection(null);
    vi.mocked(Connection).mockImplementation(() => mockConn as unknown as import("@solana/web3.js").Connection);

    const service = createSolanaVerifyService({ rpcUrl: mockRpcUrl, tokenRegistry });
    const proof = { tx_hash: "short", chain: "solana", payer_address: payerAddress };

    await expect(service.verifyPayment(proof, buildChallenge())).rejects.toThrow(
      PaymentVerificationFailedError,
    );
    await expect(service.verifyPayment(proof, buildChallenge())).rejects.toThrow(
      "Invalid Solana transaction signature",
    );
  });

  it("should throw PaymentVerificationFailedError when transaction not found", async () => {
    const { Connection } = await import("@solana/web3.js");
    const mockConn = buildMockConnection(null);
    vi.mocked(Connection).mockImplementation(() => mockConn as unknown as import("@solana/web3.js").Connection);

    const service = createSolanaVerifyService({ rpcUrl: mockRpcUrl, tokenRegistry });
    const proof = { tx_hash: txSignature, chain: "solana", payer_address: payerAddress };

    await expect(service.verifyPayment(proof, buildChallenge())).rejects.toThrow(
      PaymentVerificationFailedError,
    );
    await expect(service.verifyPayment(proof, buildChallenge())).rejects.toThrow(
      "Solana transaction not found or not yet confirmed",
    );
  });

  it("should throw PaymentVerificationFailedError when transaction failed on-chain", async () => {
    const { Connection } = await import("@solana/web3.js");
    const mockConn = buildMockConnection(
      baseMockTx({ err: { InstructionError: [0, "Custom"] } }),
    );
    vi.mocked(Connection).mockImplementation(() => mockConn as unknown as import("@solana/web3.js").Connection);

    const service = createSolanaVerifyService({ rpcUrl: mockRpcUrl, tokenRegistry });
    const proof = { tx_hash: txSignature, chain: "solana", payer_address: payerAddress };

    await expect(service.verifyPayment(proof, buildChallenge())).rejects.toThrow(
      PaymentVerificationFailedError,
    );
    await expect(service.verifyPayment(proof, buildChallenge())).rejects.toThrow(
      "Solana transaction failed",
    );
  });

  it("should throw PaymentVerificationFailedError when payer does not match fee payer", async () => {
    const { Connection } = await import("@solana/web3.js");
    const wrongPayer = "WrongPayer1111111111111111111111111111111111";
    const mockConn = buildMockConnection({
      meta: { err: null },
      transaction: {
        message: {
          accountKeys: [{ pubkey: { toBase58: () => wrongPayer } }],
        },
      },
    });
    vi.mocked(Connection).mockImplementation(() => mockConn as unknown as import("@solana/web3.js").Connection);

    const service = createSolanaVerifyService({ rpcUrl: mockRpcUrl, tokenRegistry });
    const proof = { tx_hash: txSignature, chain: "solana", payer_address: payerAddress };

    await expect(service.verifyPayment(proof, buildChallenge())).rejects.toThrow(
      PaymentVerificationFailedError,
    );
    await expect(service.verifyPayment(proof, buildChallenge())).rejects.toThrow(
      "Payer address does not match transaction fee payer",
    );
  });

  it("should throw PaymentVerificationFailedError when no SPL Token transfer instruction found", async () => {
    const { Connection } = await import("@solana/web3.js");
    const mockConn = buildMockConnection(baseMockTx());
    vi.mocked(Connection).mockImplementation(() => mockConn as unknown as import("@solana/web3.js").Connection);

    const service = createSolanaVerifyService({ rpcUrl: mockRpcUrl, tokenRegistry });
    const proof = { tx_hash: txSignature, chain: "solana", payer_address: payerAddress };

    await expect(service.verifyPayment(proof, buildChallenge())).rejects.toThrow(
      PaymentVerificationFailedError,
    );
    await expect(service.verifyPayment(proof, buildChallenge())).rejects.toThrow(
      "No USDC transfer from payer to merchant found in transaction",
    );
  });

  it("should throw InsufficientPaymentError when USDC amount is too low", async () => {
    const { Connection } = await import("@solana/web3.js");
    const mockConn = buildMockConnection(
      baseMockTx({
        instructions: [
          {
            programId: SPL_TOKEN_PROGRAM_ID,
            parsed: {
              type: "transferChecked",
              info: {
                source: "TokenAccount1111111111111111111111111111",
                destination: "TokenAccount2222222222222222222222222222",
                mint: SOLANA_USDC_MINT,
                tokenAmount: { amount: "100" },
              },
            },
          },
        ],
        preTokenBalances: [
          { accountIndex: 1, mint: SOLANA_USDC_MINT, owner: payerAddress, uiTokenAmount: { amount: "1000000" } },
          { accountIndex: 2, mint: SOLANA_USDC_MINT, owner: merchantAddress, uiTokenAmount: { amount: "0" } },
        ],
        postTokenBalances: [
          { accountIndex: 1, mint: SOLANA_USDC_MINT, owner: payerAddress, uiTokenAmount: { amount: "999900" } },
          { accountIndex: 2, mint: SOLANA_USDC_MINT, owner: merchantAddress, uiTokenAmount: { amount: "100" } },
        ],
      }),
    );
    vi.mocked(Connection).mockImplementation(() => mockConn as unknown as import("@solana/web3.js").Connection);

    const service = createSolanaVerifyService({ rpcUrl: mockRpcUrl, tokenRegistry });
    const proof = { tx_hash: txSignature, chain: "solana", payer_address: payerAddress };

    await expect(service.verifyPayment(proof, buildChallenge("0.001"))).rejects.toThrow(
      InsufficientPaymentError,
    );
  });

  it("should throw PaymentVerificationFailedError when transfer is from wrong payer", async () => {
    const { Connection } = await import("@solana/web3.js");
    const otherPayer = "OtherPayer11111111111111111111111111111111";
    const mockConn = buildMockConnection(
      baseMockTx({
        instructions: [
          {
            programId: SPL_TOKEN_PROGRAM_ID,
            parsed: {
              type: "transferChecked",
              info: {
                source: "TokenAccount1111111111111111111111111111",
                destination: "TokenAccount2222222222222222222222222222",
                mint: SOLANA_USDC_MINT,
                tokenAmount: { amount: "1000000" },
              },
            },
          },
        ],
        preTokenBalances: [
          { accountIndex: 1, mint: SOLANA_USDC_MINT, owner: otherPayer, uiTokenAmount: { amount: "1000000" } },
          { accountIndex: 2, mint: SOLANA_USDC_MINT, owner: merchantAddress, uiTokenAmount: { amount: "0" } },
        ],
        postTokenBalances: [
          { accountIndex: 1, mint: SOLANA_USDC_MINT, owner: otherPayer, uiTokenAmount: { amount: "0" } },
          { accountIndex: 2, mint: SOLANA_USDC_MINT, owner: merchantAddress, uiTokenAmount: { amount: "1000000" } },
        ],
      }),
    );
    vi.mocked(Connection).mockImplementation(() => mockConn as unknown as import("@solana/web3.js").Connection);

    const service = createSolanaVerifyService({ rpcUrl: mockRpcUrl, tokenRegistry });
    const proof = { tx_hash: txSignature, chain: "solana", payer_address: payerAddress };

    await expect(service.verifyPayment(proof, buildChallenge())).rejects.toThrow(
      PaymentVerificationFailedError,
    );
    await expect(service.verifyPayment(proof, buildChallenge())).rejects.toThrow(
      "No USDC transfer from payer to merchant found in transaction",
    );
  });

  it("should return verified result for valid Solana USDC payment", async () => {
    const { Connection } = await import("@solana/web3.js");
    const mockConn = buildMockConnection(
      baseMockTx({
        instructions: [
          {
            programId: SPL_TOKEN_PROGRAM_ID,
            parsed: {
              type: "transferChecked",
              info: {
                source: "TokenAccount1111111111111111111111111111",
                destination: "TokenAccount2222222222222222222222222222",
                mint: SOLANA_USDC_MINT,
                tokenAmount: { amount: "1000000" },
              },
            },
          },
        ],
        preTokenBalances: [
          { accountIndex: 1, mint: SOLANA_USDC_MINT, owner: payerAddress, uiTokenAmount: { amount: "10000000" } },
          { accountIndex: 2, mint: SOLANA_USDC_MINT, owner: merchantAddress, uiTokenAmount: { amount: "0" } },
        ],
        postTokenBalances: [
          { accountIndex: 1, mint: SOLANA_USDC_MINT, owner: payerAddress, uiTokenAmount: { amount: "9000000" } },
          { accountIndex: 2, mint: SOLANA_USDC_MINT, owner: merchantAddress, uiTokenAmount: { amount: "1000000" } },
        ],
      }),
    );
    vi.mocked(Connection).mockImplementation(() => mockConn as unknown as import("@solana/web3.js").Connection);

    const service = createSolanaVerifyService({ rpcUrl: mockRpcUrl, tokenRegistry });
    const proof = { tx_hash: txSignature, chain: "solana", payer_address: payerAddress };

    const result = await service.verifyPayment(proof, buildChallenge("1.0"));
    expect(result.verified).toBe(true);
    expect(result.payer_address).toBe(payerAddress);
    expect(result.amount).toBe("1.0");
  });
});
