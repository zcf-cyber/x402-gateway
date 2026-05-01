import {
  mainnet,
  base,
  arbitrum,
  optimism,
  polygon,
  avalanche,
  sepolia,
  baseSepolia,
} from "viem/chains";
import type { Chain, Address } from "viem";

export interface ChainConfig {
  chain: Chain;
  usdcAddress: Address;
}

export const MAINNET_CHAINS: Record<string, ChainConfig> = {
  ethereum: {
    chain: mainnet,
    usdcAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  },
  base: {
    chain: base,
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  arbitrum: {
    chain: arbitrum,
    usdcAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  },
  optimism: {
    chain: optimism,
    usdcAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  },
  polygon: {
    chain: polygon,
    usdcAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  },
  avalanche: {
    chain: avalanche,
    usdcAddress: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
  },
};

export const TESTNET_CHAINS: Record<string, ChainConfig> = {
  "ethereum-sepolia": {
    chain: sepolia,
    usdcAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  },
  "base-sepolia": {
    chain: baseSepolia,
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  },
};

export function getSupportedChains(
  network: "mainnet" | "testnet",
): Record<string, ChainConfig> {
  if (network === "testnet") {
    return { ...MAINNET_CHAINS, ...TESTNET_CHAINS };
  }
  return { ...MAINNET_CHAINS };
}
