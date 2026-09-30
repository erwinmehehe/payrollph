import { randomToken, sha256 } from "@/lib/crypto";

export function mintApiKey() {
  const raw = randomToken(32);
  const key = `sk_live_${raw}`;
  return { key, prefix: key.slice(0, 12), keyHash: sha256(key) };
}

export function requireScope(scopes: string[], needed: string) {
  // Wildcard scopes are intentionally unsupported: otherwise a historical key
  // would silently gain access to every scope added in the future.
  return scopes.includes(needed);
}
