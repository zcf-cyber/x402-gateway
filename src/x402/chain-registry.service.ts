import { createPublicClient, http } from "viem";
import type { Chain, Address } from "viem";

export interface RegisteredChain {
  chain: Chain;
  usdcAddress: Address;
  rpcUrl: string;
}

export interface IChainRegistry {
  register(name: string, config: RegisteredChain): void;
  get(name: string): RegisteredChain | undefined;
  list(): string[];
}

export function createChainRegistry(): IChainRegistry {
  const chains = new Map<string, RegisteredChain>();

  return {
    register(name: string, config: RegisteredChain): void {
      chains.set(name.toLowerCase(), config);
    },
    get(name: string): RegisteredChain | undefined {
      return chains.get(name.toLowerCase());
    },
    list(): string[] {
      return Array.from(chains.keys());
    },
  };
}

/** Convenience helper: pre-build publicClient Map from a registry. */
export function buildPublicClientMap(
  registry: IChainRegistry,
): Map<string, ReturnType<typeof createPublicClient>> {
  const clients = new Map<string, ReturnType<typeof createPublicClient>>();
  for (const name of registry.list()) {
    const config = registry.get(name)!;
    clients.set(name, createPublicClient({
      chain: config.chain,
      transport: http(config.rpcUrl),
    }));
  }
  return clients;
}
