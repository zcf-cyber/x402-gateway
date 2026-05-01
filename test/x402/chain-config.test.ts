import { describe, it, expect } from "vitest";
import {
  getSupportedChains,
  MAINNET_CHAINS,
  TESTNET_CHAINS,
  buildAlchemyRpcUrls,
  ALCHEMY_SLUGS,
} from "../../src/x402/chain-config.js";

describe("chain-config", () => {
  describe("getSupportedChains", () => {
    it("mainnet should return 6 chains without testnets", () => {
      const chains = getSupportedChains("mainnet");
      const keys = Object.keys(chains);
      expect(keys).toHaveLength(6);
      expect(keys).toContain("ethereum");
      expect(keys).toContain("base");
      expect(keys).toContain("arbitrum");
      expect(keys).toContain("optimism");
      expect(keys).toContain("polygon");
      expect(keys).toContain("avalanche");
      expect(keys).not.toContain("ethereum-sepolia");
      expect(keys).not.toContain("base-sepolia");
    });

    it("testnet should return 8 chains including testnets", () => {
      const chains = getSupportedChains("testnet");
      const keys = Object.keys(chains);
      expect(keys).toHaveLength(8);
      expect(keys).toContain("ethereum");
      expect(keys).toContain("base");
      expect(keys).toContain("arbitrum");
      expect(keys).toContain("optimism");
      expect(keys).toContain("polygon");
      expect(keys).toContain("avalanche");
      expect(keys).toContain("ethereum-sepolia");
      expect(keys).toContain("base-sepolia");
    });

    it("each config should have a chain and usdcAddress", () => {
      for (const [name, config] of Object.entries(MAINNET_CHAINS)) {
        expect(config.chain, `${name} chain missing`).toBeDefined();
        expect(config.usdcAddress, `${name} usdcAddress missing`).toMatch(
          /^0x[a-fA-F0-9]{40}$/,
        );
      }
      for (const [name, config] of Object.entries(TESTNET_CHAINS)) {
        expect(config.chain, `${name} chain missing`).toBeDefined();
        expect(config.usdcAddress, `${name} usdcAddress missing`).toMatch(
          /^0x[a-fA-F0-9]{40}$/,
        );
      }
    });
  });

  describe("buildAlchemyRpcUrls", () => {
    it("should generate Alchemy URLs for all supported chains", () => {
      const chains = getSupportedChains("mainnet");
      const urls = buildAlchemyRpcUrls("test-key", chains);
      expect(urls["ethereum"]).toBe("https://eth-mainnet.g.alchemy.com/v2/test-key");
      expect(urls["base"]).toBe("https://base-mainnet.g.alchemy.com/v2/test-key");
      expect(urls["arbitrum"]).toBe("https://arb-mainnet.g.alchemy.com/v2/test-key");
      expect(urls["optimism"]).toBe("https://opt-mainnet.g.alchemy.com/v2/test-key");
      expect(urls["polygon"]).toBe("https://polygon-mainnet.g.alchemy.com/v2/test-key");
      expect(urls["avalanche"]).toBe("https://avax-mainnet.g.alchemy.com/v2/test-key");
    });

    it("should include testnet chains when testnet network is passed", () => {
      const chains = getSupportedChains("testnet");
      const urls = buildAlchemyRpcUrls("test-key", chains);
      expect(urls["ethereum-sepolia"]).toBe("https://eth-sepolia.g.alchemy.com/v2/test-key");
      expect(urls["base-sepolia"]).toBe("https://base-sepolia.g.alchemy.com/v2/test-key");
    });
  });

  describe("ALCHEMY_SLUGS", () => {
    it("should have a slug for every supported chain", () => {
      for (const name of Object.keys(MAINNET_CHAINS)) {
        expect(ALCHEMY_SLUGS[name], `missing slug for ${name}`).toBeDefined();
      }
      for (const name of Object.keys(TESTNET_CHAINS)) {
        expect(ALCHEMY_SLUGS[name], `missing slug for ${name}`).toBeDefined();
      }
    });
  });
});
