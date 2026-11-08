import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("logout revokes only the presented live session without restamping it on replay", () => {
  const source = readFileSync("src/lib/revoke-presented-session.ts", "utf8");
  const route = readFileSync("src/app/api/auth/logout/route.ts", "utf8");
  const method = source.match(/export async function revokePresentedSessionOnce\(token: string\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(method, "logout-specific revoke helper must exist");
  assert.match(method, /\.set\(\{ revokedAt: new Date\(\) \}\)/);
  assert.match(method, /\.where\(and\(\s*eq\(sessions\.tokenHash, sha256\(token\)\),\s*isNull\(sessions\.revokedAt\),?\s*\)\)/,
    "conditional UPDATE must atomically bind the presented token and a previously unrevoked session");
  assert.match(route, /if \(token\) await revokePresentedSessionOnce\(token\);/);
  assert.ok(route.indexOf("enforceSameOriginMutation(request)") < route.indexOf("await revokePresentedSessionOnce(token)"),
    "cross-site logout must be rejected before any revoke update");
  assert.match(route, /jar\.set\(SESSION_COOKIE, "", sessionCookieOptions\(new Date\(0\)\)\)/);
  assert.match(route, /return Response\.json\(\{ ok: true \}\)/);
  assert.doesNotMatch(route, /revokeSession\(token\)/,
    "the shared legacy helper must not be used by the logout route");
});
