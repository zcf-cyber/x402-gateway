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

export interface TokenConfig {
  symbol: string;
  decimals: number;
  address: Address;
  type: "erc20" | "native";
}

export interface ChainConfig {
  chain: Chain;
  usdcAddress: Address;
  tokens: Record<string, TokenConfig>;
}

function token(symbol: string, decimals: number, address: Address, type: "erc20" | "native"): TokenConfig {
  return { symbol, decimals, address, type };
}

export const MAINNET_CHAINS: Record<string, ChainConfig> = {
  ethereum: {
    chain: mainnet,
    usdcAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    tokens: {
      USDC: token("USDC", 6, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "erc20"),
    },
  },
  base: {
    chain: base,
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    tokens: {
      USDC: token("USDC", 6, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "erc20"),
    },
  },
  arbitrum: {
    chain: arbitrum,
    usdcAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    tokens: {
      USDC: token("USDC", 6, "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", "erc20"),
    },
  },
  optimism: {
    chain: optimism,
    usdcAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    tokens: {
      USDC: token("USDC", 6, "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", "erc20"),
    },
  },
  polygon: {
    chain: polygon,
    usdcAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    tokens: {
      USDC: token("USDC", 6, "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", "erc20"),
    },
  },
  avalanche: {
    chain: avalanche,
    usdcAddress: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    tokens: {
      USDC: token("USDC", 6, "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", "erc20"),
    },
  },
};

export const TESTNET_CHAINS: Record<string, ChainConfig> = {
  "ethereum-sepolia": {
    chain: sepolia,
    usdcAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    tokens: {
      USDC: token("USDC", 6, "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", "erc20"),
    },
  },
  "base-sepolia": {
    chain: baseSepolia,
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    tokens: {
      USDC: token("USDC", 6, "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "erc20"),
    },
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

/** Alchemy subdomain slug per chain name (key used in getSupportedChains) */
export const ALCHEMY_SLUGS: Record<string, string> = {
  ethereum: "eth-mainnet",
  base: "base-mainnet",
  arbitrum: "arb-mainnet",
  optimism: "opt-mainnet",
  polygon: "polygon-mainnet",
  avalanche: "avax-mainnet",
  "ethereum-sepolia": "eth-sepolia",
  "base-sepolia": "base-sepolia",
};

/** Build a per-chain RPC URL map using a single Alchemy API key. */
export function buildAlchemyRpcUrls(
  apiKey: string,
  chains: Record<string, ChainConfig>,
): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const name of Object.keys(chains)) {
    const slug = ALCHEMY_SLUGS[name];
    if (slug) {
      urls[name] = `https://${slug}.g.alchemy.com/v2/${apiKey}`;
    }
  }
  return urls;
}
