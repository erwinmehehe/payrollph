import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("revokeSession changes only a session whose revoked_at is NULL", () => {
  const source = readFileSync("src/lib/auth.ts", "utf8");
  const method = source.match(/export async function revokeSession\(token: string\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(method, "the revokeSession helper must exist");
  assert.match(method, /\.set\(\{ revokedAt: new Date\(\) \}\)/,
    "revoking a live session must record its timestamp");
  assert.match(method, /\.where\(and\(\s*eq\(sessions\.tokenHash, sha256\(token\)\),\s*isNull\(sessions\.revokedAt\),?\s*\)\)/,
    "revocation must require both the supplied token and revoked_at IS NULL, preserving the original timestamp on replay");
});
