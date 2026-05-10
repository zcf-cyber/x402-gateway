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
};

const ethConfig: TokenConfig = {
  symbol: "ETH",
  decimals: 18,
  address: "0x0000000000000000000000000000000000000000",
  type: "native",
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
            USDC: {
              ...usdcConfig,
              address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            },
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
