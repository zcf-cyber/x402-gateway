import type { TokenConfig } from "./chain-config.js";

export interface ITokenRegistry {
  register(chain: string, asset: string, config: TokenConfig): void;
  get(chain: string, asset: string): TokenConfig | undefined;
  isNativeAsset(chain: string, asset: string): boolean;
  listAssets(chain: string): string[];
}

export function createTokenRegistry(): ITokenRegistry {
  const store = new Map<string, Map<string, TokenConfig>>();

  function chainKey(chain: string): string {
    return chain.toLowerCase();
  }

  function assetKey(asset: string): string {
    return asset.toUpperCase();
  }

  return {
    register(chain: string, asset: string, config: TokenConfig): void {
      const cKey = chainKey(chain);
      let assets = store.get(cKey);
      if (!assets) {
        assets = new Map<string, TokenConfig>();
        store.set(cKey, assets);
      }
      assets.set(assetKey(asset), config);
    },

    get(chain: string, asset: string): TokenConfig | undefined {
      const assets = store.get(chainKey(chain));
      if (!assets) return undefined;
      return assets.get(assetKey(asset));
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
