import type { TokenConfig } from "./chain-config.js";

export interface ITokenRegistry {
  register(chain: string, asset: string, config: TokenConfig): void;
  /** Lookup by symbol first, then fallback to contract address (case-insensitive). */
  get(chain: string, asset: string): TokenConfig | undefined;
  /** Explicit lookup by contract address only (case-insensitive). */
  getByAddress(chain: string, address: string): TokenConfig | undefined;
  isNativeAsset(chain: string, asset: string): boolean;
  listAssets(chain: string): string[];
}

export function createTokenRegistry(): ITokenRegistry {
  const store = new Map<string, Map<string, TokenConfig>>();
  /** Reverse index: chain → lowercase address → TokenConfig for address-based fallback lookup. */
  const addressIndex = new Map<string, Map<string, TokenConfig>>();

  function chainKey(chain: string): string {
    return chain.toLowerCase();
  }

  function assetKey(asset: string): string {
    return asset.toUpperCase();
  }

  function addrKey(addr: string): string {
    return addr.toLowerCase();
  }

  return {
    register(chain: string, asset: string, config: TokenConfig): void {
      const cKey = chainKey(chain);

      // Symbol-based index
      let assets = store.get(cKey);
      if (!assets) {
        assets = new Map<string, TokenConfig>();
        store.set(cKey, assets);
      }
      assets.set(assetKey(asset), config);

      // Address-based reverse index
      let addrs = addressIndex.get(cKey);
      if (!addrs) {
        addrs = new Map<string, TokenConfig>();
        addressIndex.set(cKey, addrs);
      }
      addrs.set(addrKey(config.address), config);
    },

    get(chain: string, asset: string): TokenConfig | undefined {
      const cKey = chainKey(chain);
      const assets = store.get(cKey);
      if (!assets) return undefined;

      // Try symbol lookup first
      const bySymbol = assets.get(assetKey(asset));
      if (bySymbol) return bySymbol;

      // Fallback: address lookup (client sends contract address, not symbol)
      const addrs = addressIndex.get(cKey);
      if (!addrs) return undefined;
      return addrs.get(addrKey(asset));
    },

    getByAddress(chain: string, address: string): TokenConfig | undefined {
      const addrs = addressIndex.get(chainKey(chain));
      if (!addrs) return undefined;
      return addrs.get(addrKey(address));
    },

    isNativeAsset(chain: string, asset: string): boolean {
      const config = this.get(chain, asset);
      return config?.type === "native";
    },

    listAssets(chain: string): string[] {
      const assets = store.get(chainKey(chain));
      if (!assets) return [];
      return Array.from(assets.keys());
    },
  };
}

/** Convenience helper: pre-populate a registry from static ChainConfig records. */
export function buildTokenRegistryFromChains(
  chains: Record<string, { tokens: Record<string, TokenConfig> }>,
): ITokenRegistry {
  const registry = createTokenRegistry();
  for (const [chainName, chainConfig] of Object.entries(chains)) {
    for (const [symbol, config] of Object.entries(chainConfig.tokens)) {
      registry.register(chainName, symbol, config);
    }
  }
  return registry;
}
