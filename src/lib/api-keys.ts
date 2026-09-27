import { randomToken, sha256 } from "@/lib/crypto";

export function mintApiKey() {
  const raw = randomToken(24);
  const key = `sk_live_${raw}`;
  return { key, prefix: key.slice(0, 12), keyHash: sha256(key) };
}

export function requireScope(scopes: string[], needed: string) {
  return scopes.includes("*") || scopes.includes(needed);
}
