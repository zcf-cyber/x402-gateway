import { describe, it, expect } from "vitest";
import {
  createChainRegistry,
  buildPublicClientMap,
} from "../../src/x402/chain-registry.service.js";

describe("ChainRegistry", () => {
  it("should register and retrieve chains", () => {
    const registry = createChainRegistry();
    registry.register("base", {
      chain: { id: 8453, name: "Base" } as import("viem").Chain,
      usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      rpcUrl: "https://base-mainnet.g.alchemy.com/v2/test",
    });

    const config = registry.get("base");
    expect(config).toBeDefined();
    expect(config?.usdcAddress).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  });

  it("should be case-insensitive", () => {
    const registry = createChainRegistry();
    registry.register("Base", {
      chain: { id: 8453, name: "Base" } as import("viem").Chain,
      usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      rpcUrl: "https://base-mainnet.g.alchemy.com/v2/test",
    });

    expect(registry.get("base")).toBeDefined();
    expect(registry.get("BASE")).toBeDefined();
  });

  it("should list all registered chains", () => {
    const registry = createChainRegistry();
    registry.register("base", {
      chain: { id: 8453 } as import("viem").Chain,
      usdcAddress: "0x8335...",
      rpcUrl: "https://base-mainnet.g.alchemy.com/v2/test",
    });
    registry.register("ethereum", {
      chain: { id: 1 } as import("viem").Chain,
      usdcAddress: "0xA0b8...",
      rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/test",
    });

    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list).toContain("base");
    expect(list).toContain("ethereum");
  });

  it("buildPublicClientMap should create clients for all registered chains", () => {
    const registry = createChainRegistry();
    registry.register("base", {
      chain: { id: 8453 } as import("viem").Chain,
      usdcAddress: "0x8335...",
      rpcUrl: "https://base-mainnet.g.alchemy.com/v2/test",
    });

    const clients = buildPublicClientMap(registry);
    expect(clients.has("base")).toBe(true);
    expect(clients.has("ethereum")).toBe(false);
  });
});
