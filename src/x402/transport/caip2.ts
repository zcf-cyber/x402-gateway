// ---------------------------------------------------------------------------
// x402 v2 Transport Layer — CAIP-2 Chain Identifier Conversion
//
// Maps between internal chain names (e.g., "base") and CAIP-2 identifiers
// (e.g., "eip155:8453") used in x402 v2 protocol headers.
//
// CAIP-2 reference: https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md
// Chain IDs source: https://chainlist.org
// ---------------------------------------------------------------------------

import type { Caip2Id } from "./types.js";

/** Map of internal chain name → CAIP-2 identifier. */
const CHAIN_TO_CAIP2: Record<string, Caip2Id> = {
  ethereum: "eip155:1",
  base: "eip155:8453",
  arbitrum: "eip155:42161",
  optimism: "eip155:10",
  polygon: "eip155:137",
  avalanche: "eip155:43114",
  "ethereum-sepolia": "eip155:11155111",
  "base-sepolia": "eip155:84532",
  solana: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
};

/** Reverse map: CAIP-2 identifier → internal chain name. */
const CAIP2_TO_CHAIN: Record<string, string> = {};
for (const [chain, caip2] of Object.entries(CHAIN_TO_CAIP2)) {
  CAIP2_TO_CHAIN[caip2] = chain;
}

/**
 * Convert an internal chain name to a CAIP-2 identifier.
 *
 * @param chainName - Internal chain name (e.g., "base", "ethereum")
 * @returns CAIP-2 identifier (e.g., "eip155:8453")
 * @throws If the chain name is not recognized
 */
export function chainToCaip2(chainName: string): Caip2Id {
  const normalized = chainName.toLowerCase();
  const caip2 = CHAIN_TO_CAIP2[normalized];
  if (!caip2) {
    throw new Error(
      `Unknown chain name "${chainName}". ` +
      `Known chains: ${Object.keys(CHAIN_TO_CAIP2).join(", ")}`,
    );
  }
  return caip2;
}

/**
 * Convert a CAIP-2 identifier to an internal chain name.
 *
 * @param caip2 - CAIP-2 identifier (e.g., "eip155:8453")
 * @returns Internal chain name (e.g., "base")
 * @throws If the CAIP-2 identifier is not recognized
 */
export function caip2ToChain(caip2: Caip2Id): string {
  const chain = CAIP2_TO_CHAIN[caip2];
  if (!chain) {
    throw new Error(
      `Unknown CAIP-2 identifier "${caip2}". ` +
      `Known identifiers: ${Object.keys(CAIP2_TO_CHAIN).join(", ")}`,
    );
  }
  return chain;
}

/**
 * Check if a CAIP-2 identifier is recognized.
 *
 * @param caip2 - CAIP-2 identifier
 * @returns true if recognized
 */
export function isKnownCaip2(caip2: string): caip2 is Caip2Id {
  return caip2 in CAIP2_TO_CHAIN;
}
