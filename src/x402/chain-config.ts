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
  /** EIP-712 domain name (e.g., "USD Coin" for USDC). Required for EIP-3009 signature verification. */
  eip712Name: string;
  /** EIP-712 domain version (e.g., "2" for USDC). Required for EIP-3009 signature verification. */
  eip712Version: string;
}

export interface ChainConfig {
  chain: Chain;
  usdcAddress: Address;
  tokens: Record<string, TokenConfig>;
}

function token(
  symbol: string,
  decimals: number,
  address: Address,
  type: "erc20" | "native",
  eip712Name: string,
  eip712Version: string,
): TokenConfig {
  return { symbol, decimals, address, type, eip712Name, eip712Version };
}

function usdcToken(decimals: number, address: Address, eip712Name: string): TokenConfig {
  return token("USDC", decimals, address, "erc20", eip712Name, "2");
}

export const MAINNET_CHAINS: Record<string, ChainConfig> = {
  ethereum: {
    chain: mainnet,
    usdcAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    tokens: {
      USDC: usdcToken(6, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "USD Coin"),
    },
  },
  base: {
    chain: base,
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    tokens: {
      USDC: usdcToken(6, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "USD Coin"),
    },
  },
  arbitrum: {
    chain: arbitrum,
    usdcAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    tokens: {
      USDC: usdcToken(6, "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", "USD Coin"),
    },
  },
  optimism: {
    chain: optimism,
    usdcAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    tokens: {
      USDC: usdcToken(6, "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", "USD Coin"),
    },
  },
  polygon: {
    chain: polygon,
    usdcAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    tokens: {
      USDC: usdcToken(6, "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", "USD Coin"),
    },
  },
  avalanche: {
    chain: avalanche,
    usdcAddress: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    tokens: {
      USDC: usdcToken(6, "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", "USD Coin"),
    },
  },
};

export const TESTNET_CHAINS: Record<string, ChainConfig> = {
  "ethereum-sepolia": {
    chain: sepolia,
    usdcAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    tokens: {
      USDC: usdcToken(6, "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", "USD Coin"),
    },
  },
  "base-sepolia": {
    chain: baseSepolia,
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    tokens: {
      // eip712Name must match @x402/evm DEFAULT_STABLECOINS: name="USDC" for eip155:84532
      USDC: usdcToken(6, "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "USDC"),
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
