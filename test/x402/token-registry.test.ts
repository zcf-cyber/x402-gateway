import { describe, it, expect } from "vitest";
import {
  createTokenRegistry,
  buildTokenRegistryFromChains,
} from "../../src/x402/token-registry.service.js";
import type { TokenConfig } from "../../src/x402/chain-config.js";

const usdcConfig: TokenConfig = {
  symbol: "USDC",
  decimals: 6,
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  type: "erc20",
  eip712Name: "USD Coin",
  eip712Version: "2",
};

const baseUsdcConfig: TokenConfig = {
  symbol: "USDC",
  decimals: 6,
  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  type: "erc20",
  eip712Name: "USD Coin",
  eip712Version: "2",
};

const ethConfig: TokenConfig = {
  symbol: "ETH",
  decimals: 18,
  address: "0x0000000000000000000000000000000000000000",
  type: "native",
  eip712Name: "Ether",
  eip712Version: "1",
};

describe("TokenRegistry", () => {
  describe("register & get", () => {
    it("should register and retrieve a token config", () => {
      const registry = createTokenRegistry();
      registry.register("ethereum", "USDC", usdcConfig);

      const config = registry.get("ethereum", "USDC");
      expect(config).toEqual(usdcConfig);
    });

    it("should be case-insensitive for chain names", () => {
      const registry = createTokenRegistry();
      registry.register("Ethereum", "USDC", usdcConfig);

      expect(registry.get("ethereum", "USDC")).toEqual(usdcConfig);
      expect(registry.get("ETHEREUM", "USDC")).toEqual(usdcConfig);
    });

    it("should be case-insensitive for asset symbols", () => {
      const registry = createTokenRegistry();
      registry.register("ethereum", "usdc", usdcConfig);

      expect(registry.get("ethereum", "USDC")).toEqual(usdcConfig);
      expect(registry.get("ethereum", "Usdc")).toEqual(usdcConfig);
    });

    it("should return undefined for unregistered chain", () => {
      const registry = createTokenRegistry();
      registry.register("ethereum", "USDC", usdcConfig);

      expect(registry.get("base", "USDC")).toBeUndefined();
    });

    it("should return undefined for unregistered asset on existing chain", () => {
      const registry = createTokenRegistry();
      registry.register("ethereum", "USDC", usdcConfig);

      expect(registry.get("ethereum", "USDT")).toBeUndefined();
    });
  });

  describe("isNativeAsset", () => {
    it("should return true for native tokens", () => {
      const registry = createTokenRegistry();
      registry.register("ethereum", "ETH", ethConfig);

      expect(registry.isNativeAsset("ethereum", "ETH")).toBe(true);
      expect(registry.isNativeAsset("ethereum", "eth")).toBe(true);
    });

    it("should return false for erc20 tokens", () => {
      const registry = createTokenRegistry();
      registry.register("ethereum", "USDC", usdcConfig);

      expect(registry.isNativeAsset("ethereum", "USDC")).toBe(false);
    });

    it("should return false for unknown asset", () => {
      const registry = createTokenRegistry();
      registry.register("ethereum", "USDC", usdcConfig);

      expect(registry.isNativeAsset("ethereum", "UNKNOWN")).toBe(false);
    });

    it("should return false for unknown chain", () => {
      const registry = createTokenRegistry();
      registry.register("ethereum", "USDC", usdcConfig);

      expect(registry.isNativeAsset("solana", "USDC")).toBe(false);
    });
  });

  describe("listAssets", () => {
    it("should list all registered assets for a chain", () => {
      const registry = createTokenRegistry();
      registry.register("ethereum", "USDC", usdcConfig);
      registry.register("ethereum", "ETH", ethConfig);

      const assets = registry.listAssets("ethereum");
      expect(assets).toHaveLength(2);
      expect(assets).toContain("USDC");
      expect(assets).toContain("ETH");
    });

    it("should return empty array for unknown chain", () => {
      const registry = createTokenRegistry();
      expect(registry.listAssets("solana")).toEqual([]);
    });

    it("should not leak assets across chains", () => {
      const registry = createTokenRegistry();
      registry.register("ethereum", "USDC", usdcConfig);
      registry.register("base", "ETH", ethConfig);

      expect(registry.listAssets("ethereum")).toEqual(["USDC"]);
      expect(registry.listAssets("base")).toEqual(["ETH"]);
    });
  });

  describe("address-based fallback lookup", () => {
    it("should find token by contract address via get()", () => {
      const registry = createTokenRegistry();
      registry.register("ethereum", "USDC", usdcConfig);

      // Look up by contract address (lowercase)
      const byLowerAddr = registry.get(
        "ethereum",
        "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      );
      expect(byLowerAddr).toBeDefined();
      expect(byLowerAddr?.symbol).toBe("USDC");

      // Look up by contract address (checksummed)
      const byChecksumAddr = registry.get(
        "ethereum",
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      );
      expect(byChecksumAddr).toBeDefined();
      expect(byChecksumAddr?.symbol).toBe("USDC");
    });

    it("should prefer symbol lookup over address when both exist", () => {
      const registry = createTokenRegistry();
      // Register USDC on ethereum
      registry.register("ethereum", "USDC", usdcConfig);
      // Register a different token with symbol that matches another token's address
      registry.register("ethereum", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", {
        ...usdcConfig,
        symbol: "FAKE",
        address: "0x0000000000000000000000000000000000000abc" as `0x${string}`,
      });

      // Symbol "0xa0b..." should return the FAKE token (exact symbol match wins)
      const bySymbol = registry.get(
        "ethereum",
        "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      );
      expect(bySymbol?.symbol).toBe("FAKE");
    });

    it("getByAddress should only match by contract address", () => {
      const registry = createTokenRegistry();
      registry.register("ethereum", "USDC", usdcConfig);

      // getByAddress should work with any casing
      const found = registry.getByAddress(
        "ethereum",
        "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      );
      expect(found).toBeDefined();
      expect(found?.symbol).toBe("USDC");

      // getByAddress should not match by symbol
      const notFound = registry.getByAddress("ethereum", "USDC");
      expect(notFound).toBeUndefined();
    });

    it("getByAddress should work across chains independently", () => {
      const registry = createTokenRegistry();
      registry.register("ethereum", "USDC", usdcConfig);
      registry.register("base", "USDC", baseUsdcConfig);

      // Ethereum address should find ethereum USDC
      const ethFound = registry.getByAddress(
        "ethereum",
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      );
      expect(ethFound?.address).toBe("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");

      // Base address should find base USDC
      const baseFound = registry.getByAddress(
        "base",
        "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      );
      expect(baseFound?.address).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    });

    it("get() should return undefined for unknown address", () => {
      const registry = createTokenRegistry();
      registry.register("ethereum", "USDC", usdcConfig);

      expect(registry.get("ethereum", "0xdeadbeef")).toBeUndefined();
    });

    it("get() should handle base-sepolia testnet addresses", () => {
      const registry = createTokenRegistry();
      const sepoliaUsdc: TokenConfig = {
        symbol: "USDC",
        decimals: 6,
        address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        type: "erc20",
        eip712Name: "USD Coin",
        eip712Version: "2",
      };
      registry.register("base-sepolia", "USDC", sepoliaUsdc);

      // Symbol lookup still works
      expect(registry.get("base-sepolia", "USDC")?.address).toBe(
        "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      );

      // Address fallback lookup works
      const byAddress = registry.get(
        "base-sepolia",
        "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      );
      expect(byAddress).toBeDefined();
      expect(byAddress?.decimals).toBe(6);
      expect(byAddress?.eip712Name).toBe("USD Coin");
    });
  });

  describe("buildTokenRegistryFromChains", () => {
    it("should populate registry from chain config records", () => {
      const chains: Record<string, { tokens: Record<string, TokenConfig> }> = {
        ethereum: {
          tokens: {
            USDC: usdcConfig,
            ETH: ethConfig,
          },
        },
        base: {
          tokens: {
            USDC: baseUsdcConfig,
          },
        },
      };

      const registry = buildTokenRegistryFromChains(chains);

      expect(registry.get("ethereum", "USDC")).toEqual(usdcConfig);
      expect(registry.get("ethereum", "ETH")).toEqual(ethConfig);
      expect(registry.get("base", "USDC")?.address).toBe(
        "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      );
    });

    it("should produce empty registry for empty chains", () => {
      const registry = buildTokenRegistryFromChains({});
      expect(registry.listAssets("ethereum")).toEqual([]);
    });

    it("should support Solana when registered after EVM chains", () => {
      const registry = buildTokenRegistryFromChains({
        base: {
          tokens: {
            USDC: {
              symbol: "USDC",
              decimals: 6,
              address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              type: "erc20",
            },
          },
        },
      });

      registry.register("solana", "USDC", {
        symbol: "USDC",
        decimals: 6,
        address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as `0x${string}`,
        type: "erc20",
      });

      expect(registry.get("solana", "USDC")).toBeDefined();
      expect(registry.get("solana", "USDC")?.decimals).toBe(6);
      expect(registry.get("solana", "USDC")?.symbol).toBe("USDC");
      expect(registry.isNativeAsset("solana", "USDC")).toBe(false);
    });
  });
});
