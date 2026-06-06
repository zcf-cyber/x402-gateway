import { createHash } from "crypto";

/**
 * Compute a deterministic request hash from a request body.
 * Sorts keys alphabetically, serializes to stable JSON, then SHA-256.
 * Used for both challenge generation and payment payload validation.
 */
export function computeRequestHash(body: Record<string, unknown>): string {
  const sortedKeys = Object.keys(body).sort();
  const objWithSortedKeys: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    objWithSortedKeys[key] = body[key];
  }
  const sortedBody = JSON.stringify(objWithSortedKeys, null, 2);
  const hash = createHash("sha256").update(sortedBody).digest("hex");
  return `rh_${hash}`;
}
