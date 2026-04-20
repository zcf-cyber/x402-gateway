/**
 * Blockchain Mock - Simulates EVM RPC responses for testing
 *
 * This module provides mock implementations of blockchain RPC calls
 * used by the x402 payment verification system.
 */

import type { PaymentProof, VerificationResult } from "../../src/x402/types.js";

/** Mock transaction receipt structure */
export interface MockTransactionReceipt {
  transactionHash: string;
  blockNumber: bigint;
  from: string;
  to: string;
  status: "success" | "reverted";
  logs: Array<{
    address: string;
    topics: string[];
    data: string;
  }>;
}

/** Mock block structure */
export interface MockBlock {
  number: bigint;
  timestamp: bigint;
  hash: string;
}

/**
 * Create a mock blockchain client for testing.
 */
export function createMockBlockchainClient(options?: {
  shouldFail?: boolean;
  blockNumber?: bigint;
  blockTimestamp?: bigint;
  confirmations?: number;
}) {
  const currentBlock = options?.blockNumber ?? 1000n;
  const currentTimestamp =
    options?.blockTimestamp ?? BigInt(Math.floor(Date.now() / 1000));
  const confirmations = options?.confirmations ?? 6;

  return {
    /**
     * Get the current block number.
     */
    getBlockNumber: async (): Promise<bigint> => {
      if (options?.shouldFail) {
        throw new Error("Blockchain RPC error: getBlockNumber failed");
      }
      return currentBlock;
    },

    /**
     * Get block by number.
     */
    getBlock: async (blockNumber: bigint): Promise<MockBlock> => {
      if (options?.shouldFail) {
        throw new Error("Blockchain RPC error: getBlock failed");
      }
      return {
        number: blockNumber,
        timestamp: currentTimestamp - (currentBlock - blockNumber) * 12n,
        hash: "0x" + "b".repeat(64),
      };
    },

    /**
     * Get transaction receipt.
     */
    getTransactionReceipt: async (
      txHash: string,
    ): Promise<MockTransactionReceipt | null> => {
      if (options?.shouldFail) {
        throw new Error("Blockchain RPC error: getTransactionReceipt failed");
      }

      // Simulate transaction not found for random hashes
      if (txHash === "0x" + "0".repeat(64)) {
        return null;
      }

      return {
        transactionHash: txHash,
        blockNumber: currentBlock - BigInt(confirmations),
        from: "0x1234567890123456789012345678901234567890",
        to: "0x0000000000000000000000000000000000000001",
        status: "success",
        logs: [
          {
            address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
            topics: [
              "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", // Transfer event
              "0x0000000000000000000000001234567890123456789012345678901234567890", // from
              "0x0000000000000000000000000000000000000000000000000000000000000001", // to
            ],
            data: "0x00000000000000000000000000000000000000000000000000000000000f4240", // 1000000 (1 USDC with 6 decimals)
          },
        ],
      };
    },

    /**
     * Get transaction count (nonce) for an address.
     */
    getTransactionCount: async (_address: string): Promise<number> => {
      if (options?.shouldFail) {
        throw new Error("Blockchain RPC error: getTransactionCount failed");
      }
      // Return a deterministic nonce based on address
      return parseInt(_address.slice(-8), 16) % 100;
    },

    /**
     * Get balance of an address.
     */
    getBalance: async (_address: string): Promise<bigint> => {
      if (options?.shouldFail) {
        throw new Error("Blockchain RPC error: getBalance failed");
      }
      // Return a mock balance
      return 1000000000000000000n; // 1 ETH
    },

    /**
     * Simulate call (for checking contract state).
     */
    call: async ({
      to: _to,
      data: _data,
    }: {
      to: string;
      data: string;
    }): Promise<string> => {
      if (options?.shouldFail) {
        throw new Error("Blockchain RPC error: call failed");
      }
      // Return mock data based on the call
      // This would typically be an ERC20 balanceOf or allowance call
      return "0x00000000000000000000000000000000000000000000000000000000000f4240"; // 1000000
    },
  };
}

/**
 * Create a mock USDC contract interface.
 */
export function createMockUSDCContract(options?: {
  balance?: bigint;
  decimals?: number;
}) {
  const decimals = options?.decimals ?? 6;
  const balance = options?.balance ?? 1000000000n; // 1000 USDC

  return {
    decimals: async (): Promise<number> => decimals,

    balanceOf: async (_address: string): Promise<bigint> => balance,

    allowance: async (_owner: string, _spender: string): Promise<bigint> =>
      1000000000n, // 1000 USDC allowance

    parseTransferLog: (log: {
      data: string;
      topics: string[];
    }): {
      from: string;
      to: string;
      value: bigint;
    } => {
      // Parse the transfer log data
      const data = log.data.replace("0x", "");
      const value = BigInt("0x" + data.slice(-64));

      return {
        from: "0x" + log.topics[1].replace("0x", "").slice(-40),
        to: "0x" + log.topics[2].replace("0x", "").slice(-40),
        value,
      };
    },
  };
}

/**
 * Create a mock verification result for testing.
 */
export function createMockVerificationResult(
  proof: PaymentProof,
  amount: string,
): VerificationResult {
  return {
    verified: true,
    payer_address: proof.payer_address,
    amount: amount,
  };
}

/**
 * Mock blockchain configuration for different test scenarios.
 */
export const MockBlockchainConfig = {
  /** Fast confirmation (2 blocks) */
  fast: {
    blockNumber: 100n,
    blockTimestamp: BigInt(Math.floor(Date.now() / 1000)),
    confirmations: 2,
  },
  /** Standard confirmation (6 blocks) */
  standard: {
    blockNumber: 1000n,
    blockTimestamp: BigInt(Math.floor(Date.now() / 1000)),
    confirmations: 6,
  },
  /** Slow confirmation (12 blocks) */
  slow: {
    blockNumber: 10000n,
    blockTimestamp: BigInt(Math.floor(Date.now() / 1000)),
    confirmations: 12,
  },
} as const;

/**
 * Simulate blockchain delay for realistic testing.
 */
export async function simulateBlockchainDelay(
  minMs = 50,
  maxMs = 200,
): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  await new Promise((resolve) => setTimeout(resolve, delay));
}
