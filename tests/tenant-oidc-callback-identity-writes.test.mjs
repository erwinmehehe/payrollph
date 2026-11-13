/** Actual TypeScript callback with explicit dependency doubles, not HTTP/IdP acceptance. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const path = "src/app/api/auth/sso/callback/route.ts";
const source = process.env.OIDC_CALLBACK_TEST_SOURCE_REF
  ? execFileSync("git", ["show", process.env.OIDC_CALLBACK_TEST_SOURCE_REF + ":" + path], { encoding: "utf8" })
  : readFileSync(path, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: path,
}).outputText;

function harness(options = {}) {
  const table = name => new Proxy({ name }, { get: (target, key) => key === "name" ? name : { table: name, key } });
  const names = ["externalIdentities", "identityDomains", "identityProviders", "oidcLoginStates",
    "organizationSecurityPolicies", "userOrganizations", "users"];
  const schema = Object.fromEntries(names.map(name => [name, table(name)]));
  const rows = {
    externalIdentities: options.unlinked ? [] : [{ id: 41, organizationId: options.foreignLink ? 900 : 20,
      providerId: 31, userId: 51, subject: "subject-own", email: "own@example.invalid", lastLoginAt: "before" }],
    identityDomains: [{ id: 61, organizationId: 20, providerId: 31, domain: "example.invalid", verified: true }],
    identityProviders: [{ id: 31, organizationId: 20, protocol: "oidc", enabled: true,
      tokenEndpoint: "https://idp.example.invalid/token", clientId: "synthetic", clientSecretEncrypted: "synthetic",
      issuer: "https://idp.example.invalid", jwksUri: "https://idp.example.invalid/jwks", emailClaim: "email" }],
    oidcLoginStates: [{ id: 71, providerId: 31, stateHash: "hash-state", usedAt: null,
      expiresAt: new Date(Date.now() + 60000), nonce: "nonce", codeVerifier: "encrypted", redirectUri: "https://payroll.example.test/api/auth/sso/callback" }],
    organizationSecurityPolicies: [{ organizationId: 20, requireMfa: false }],
    userOrganizations: [{ id: 81, userId: 51, organizationId: 20, active: !options.revoked }],
    users: [{ id: 51, name: "Fictional Owner", email: "own@example.invalid", active: true }],
  };
  const calls = [], links = [], sessions = [], writes = [];
  const expression = kind => (...terms) => ({ kind, terms });
  function matches(row, condition) {
    const [column, value] = condition.terms;
    if (condition.kind === "and") return condition.terms.every(term => matches(row, term));
    if (condition.kind === "null") return row[column.key] === null;
    if (condition.kind === "gt") return row[column.key] > value;
    return row[column.key] === value;
  }
  const db = {
    select() { return { from(t) { return { where(condition) {
      calls.push("read:" + t.name);
      return { async limit(count) { return rows[t.name].filter(row => matches(row, condition)).slice(0, count); } };
    } }; } }; },
    update(t) { return { set(values) { return { where(condition) {
      const execute = () => {
        const selected = rows[t.name].filter(row => matches(row, condition));
        selected.forEach(row => Object.assign(row, values));
        if (t.name === "externalIdentities") writes.push("update");
        return selected;
      };
      return { returning: async () => execute(), then: (resolve, reject) => Promise.resolve().then(execute).then(resolve, reject) };
    } }; } }; },
    insert(t) { return { async values(value) { rows[t.name].push(value); writes.push("insert"); } }; },
  };
  const dependencies = {
    "drizzle-orm": { and: expression("and"), eq: expression("eq"), gt: expression("gt"), isNull: expression("null") },
    "next/headers": { cookies: async () => ({ get: () => ({ value: options.foreignBrowser ? "other" : "state" }), set() {} }) },
    "@/db": { db }, "@/db/schema": schema,
    "@/lib/auth": { createSession: async (...args) => { calls.push("session"); sessions.push(args); return { token: "synthetic", expiresAt: new Date() }; },
      SESSION_COOKIE: "linaw_session", sessionCookieOptions: () => ({}) },
    "@/lib/audit": { recordAuditEvent: async () => calls.push("audit") },
    "@/lib/enterprise-secret": { decryptEnterpriseSecret: () => "verifier" },
    "@/lib/oidc": { exchangeOidcCode: async () => ({ id_token: "dependency-double-only" }),
      verifyOidcIdToken: async () => ({ email: "own@example.invalid", subject: "subject-own", mfaSatisfied: !options.noMfa }) },
    "@/lib/rate-limit": { requestMeta: () => ({}) },
    "@/lib/enterprise-session": { effectiveSessionPolicyForUser: async () => { calls.push("policy"); return { requireMfa: Boolean(options.requireMfa) }; } },
    "@/lib/crypto": { sha256: () => "hash-state" },
    "@/lib/oidc-browser-state": { OIDC_BROWSER_STATE_COOKIE: "browser_state", OIDC_BROWSER_STATE_PATH: "/api/auth/sso/callback",
      oidcBrowserStateMatches: (a, b) => a === b },
    "@/lib/oidc-identity-binding": { persistVerifiedOidcIdentity: async value => {
      calls.push("persist"); links.push(value);
      if (options.foreignLink && value.existingIdentityId === null) throw new Error("Synthetic provider/subject unique conflict");
      if (options.writeError) throw new Error("Synthetic unique violation");
      return !options.liveAuthorityLost;
    } },
  };
  const handlerModule = { exports: {} };
  runInNewContext(compiled, { module: handlerModule, exports: handlerModule.exports, Response, URL,
    process: { env: { NODE_ENV: "production" } },
    require: name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } }, { timeout: 1000 });
  const run = () => handlerModule.exports.GET(new Request("https://payroll.example.test/api/auth/sso/callback?code=synthetic&state=state&organizationId=900&userId=999"));
  return { run, calls, links, sessions, writes, rows };
}

for (const unlinked of [false, true]) {
  test((unlinked ? "new" : "existing") + " identity persists only after membership and inherited MFA policy", async () => {
    const h = harness({ unlinked });
    assert.equal((await h.run()).status, 302);
    assert.equal(h.links.length, 1);
    assert.equal(h.sessions.length, 1);
    assert.ok(h.calls.indexOf("policy") < h.calls.indexOf("persist"));
    assert.ok(h.calls.indexOf("persist") < h.calls.indexOf("session"));
    assert.deepEqual(JSON.parse(JSON.stringify(h.links[0])), { organizationId: 20, providerId: 31, userId: 51,
      subject: "subject-own", email: "own@example.invalid", existingIdentityId: unlinked ? null : 41 });
    assert.equal(h.writes.length, 0, "Callback may not bypass the locked persistence helper");
  });
  test((unlinked ? "new" : "existing") + " identity remains unchanged when inherited MFA denies login", async () => {
    const h = harness({ unlinked, requireMfa: true, noMfa: true });
    const before = JSON.stringify(h.rows.externalIdentities);
    assert.equal((await h.run()).status, 403);
    assert.equal(JSON.stringify(h.rows.externalIdentities), before);
    assert.equal(h.writes.length + h.links.length + h.sessions.length, 0);
  });
}
test("revoked membership cannot refresh an existing identity before denying login", async () => {
  const h = harness({ revoked: true });
  const before = JSON.stringify(h.rows.externalIdentities);
  assert.equal((await h.run()).status, 403);
  assert.equal(JSON.stringify(h.rows.externalIdentities), before);
  assert.equal(h.writes.length + h.links.length + h.sessions.length, 0);
});
test("a mismatched employer identity row cannot fall back to an authenticated session", async () => {
  const h = harness({ foreignLink: true });
  assert.equal((await h.run()).status, 409);
  assert.equal(h.writes.length + h.sessions.length, 0);
});
test("authority lost at the locked write refuses before creating a session", async () => {
  const h = harness({ liveAuthorityLost: true });
  assert.equal((await h.run()).status, 403);
  assert.equal(h.sessions.length, 0);
});
test("a failed identity transaction cannot create an authentication session", async () => {
  const h = harness({ writeError: true });
  assert.equal((await h.run()).status, 409);
  assert.equal(h.sessions.length, 0);
});
test("the initiating browser gate still precedes database access", async () => {
  const h = harness({ foreignBrowser: true });
  assert.equal((await h.run()).status, 403);
  assert.equal(h.calls.length, 0);
});
