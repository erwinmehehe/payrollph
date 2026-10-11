import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const API = "src/app/api";

/**
 * These POST handlers authenticate only signed server-to-server webhooks,
 * bearer API credentials, or deliberately return 503 for disabled SAML.
 * They must never consult browser cookies. New exemptions require explicit
 * test and authorization evidence, not a broad directory wildcard.
 */
const AUTHORIZED_NO_COOKIE_MUTATIONS: Record<string, string> = {
  "src/app/api/auth/saml/acs/[providerId]/route.ts": "SAML_RUNTIME_NOT_READY",
  "src/app/api/hcm/work-items/escalate/route.ts": "timingSafeEqual",
  "src/app/api/scim/v2/Users/route.ts": "authenticateScim",
  "src/app/api/scim/v2/Users/[id]/route.ts": "authenticateScim",
  "src/app/api/v1/employees/route.ts": "authenticateApiKey",
  "src/app/api/v1/employees/[id]/route.ts": "authenticateApiKey",
  "src/app/api/webhooks/paymongo/transfers/route.ts": "verifyPaymongoWebhookSignature",
  "src/app/api/webhooks/resend/route.ts": "verifyResendWebhookSignature",
  "src/app/api/webhooks/xendit/subscriptions/route.ts": "constantTimeSecretEqual",
};

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : entry.name === "route.ts" ? [path.replaceAll("\\", "/")] : [];
  });
}

test("all routes are discovered automatically and browser mutations have same-origin guard", () => {
  const routes = walk(API);
  assert.ok(routes.length >= 220, "API route sweep unexpectedly became incomplete");
  const missing: string[] = [];
  const sessions: string[] = [];
  for (const path of routes) {
    const source = readFileSync(path, "utf8");
    const mutation = /export\s+(?:async\s+)?(?:function|const)\s+(?:POST|PUT|PATCH|DELETE)\b/.test(source);
    if (!mutation) continue;
    if (source.includes("enforceSameOriginMutation")) {
      sessions.push(path);
      continue;
    }
    const proof = AUTHORIZED_NO_COOKIE_MUTATIONS[path];
    if (!proof || !source.includes(proof)) {
      missing.push(path);
      continue;
    }
    // Explicitly no cookie-based fallback on these exemption paths.
    assert.ok(!source.includes("getSessionUser("), `Exempt endpoint ${path} cannot use cookies without CSRF`);
  }
  assert.deepEqual(missing, [], "Mutation routes missing same-origin guard or reviewed server-to-server exemption");
  assert.ok(sessions.length >= 100, "Expected ordinary browser mutation routes to use CSRF guard");
});

test("exemption register points only to actually existing mutation routes", () => {
  const routes = new Set(walk(API));
  for (const [path, proof] of Object.entries(AUTHORIZED_NO_COOKIE_MUTATIONS)) {
    assert.ok(routes.has(path), path);
    const source = readFileSync(path, "utf8");
    assert.match(source, /export\s+(?:async\s+)?(?:function|const)\s+(?:POST|PUT|PATCH|DELETE)\b/, path);
    assert.ok(source.includes(proof), path);
  }
});
