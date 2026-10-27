import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { requireDisposableIdentityAccount, requireIdentityNoStore, proveMe, proveAccount } from "../scripts/qa/tenant-identity-account-proof.mjs";

const safe = {
  CI: "true", TENANT_SECOND_PASS_MODE: "isolated-ci-only", NODE_ENV: "production", DEMO_MODE: "false",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  PAYMONGO_SECRET_KEY: "", XENDIT_SECRET_KEY: "", RESEND_API_KEY: "",
};
const actor = {
  id: 21, name: "Fictional A", email: "fictional-a@example.invalid",
  role: "owner", totpEnabled: true, employeeId: null, sessionId: 71,
};
const me = () => ({ user: {
  id: actor.id, name: actor.name, email: actor.email, role: actor.role,
  totpEnabled: actor.totpEnabled, employeeId: null,
} });
const account = () => ({
  profile: { id: actor.id, name: actor.name, email: actor.email, role: actor.role,
    createdAt: "2026-10-27T00:00:00.000Z" },
  security: { passwordAuth: true, totpEnabled: true, backupCodes: 0,
    accountLockedUntil: null, sessionDays: 14 },
  sessions: [{ id: actor.sessionId, userId: actor.id,
    createdAt: "2026-10-27T00:00:00.000Z", expiresAt: "2026-11-01T00:00:00.000Z",
    revokedAt: null, lastSeenAt: "2026-10-27T00:00:00.000Z",
    userAgent: null, ip: null, label: "Unknown device",
    current: true, active: true, expiresSoon: false }],
  summary: { total: 1, active: 1, otherActive: 0, expired: 0, revoked: 0 },
});
test("refuse non-disposable and provider-capable HTTP test environments", () => {
  assert.equal(requireDisposableIdentityAccount(safe), true);
  for (const [key, value] of [
    ["CI", "false"], ["TENANT_SECOND_PASS_MODE", "local"],
    ["NODE_ENV", "development"], ["DEMO_MODE", "true"],
    ["SECURITY_SMOKE_URL", "https://payroll.example.test"],
    ["SECURITY_SMOKE_URL", "http://localhost:3000"],
    ["SECURITY_SMOKE_URL", "http://127.0.0.1.evil:3000"],
    ["DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/app_db"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/customer"],
    ["DATABASE_URL", "postgresql://other:secret@127.0.0.1:5432/app_db"],
    ["PAYMONGO_DISBURSEMENTS_ENABLED", "true"], ["XENDIT_PAYOUTS_ENABLED", "true"],
    ["PAYMONGO_SECRET_KEY", "secret"], ["XENDIT_SECRET_KEY", "secret"], ["RESEND_API_KEY", "secret"],
  ]) assert.throws(() => requireDisposableIdentityAccount({ ...safe, [key]: value }),
    /IDENTITY_PROOF_REFUSED/, key);
  assert.throws(() => requireDisposableIdentityAccount({ ...safe, DATABASE_URL: undefined }),
    /IDENTITY_PROOF_REFUSED/);
});
test("auth/me must be a discriminating exact six-field cookie user response", () => {
  assert.equal(proveMe(me(), actor, ["foreign-user"]), true);
  const mutations = [
    x => { x.user.id = 99; }, x => { x.user.email = "peer@example.invalid"; },
    x => { x.user.role = "admin"; }, x => { x.user.tokenHash = "private"; },
    x => { x.user.totpEnabled = false; }, x => { x.debug = "private"; },
    x => { x.user = null; },
  ];
  for (const mutate of mutations) {
    const body = me(); mutate(body);
    assert.throws(() => proveMe(body, actor));
  }
  assert.throws(() => proveMe(me(), { ...actor, id: 99 }));
  assert.throws(() => proveMe(me(), actor, ["Fictional A"]));
});
test("account must contain only the cookie user's own current session and no secrets", () => {
  assert.equal(proveAccount(account(), actor, ["foreign-user"]), true);
  const mutations = [
    x => { x.profile.id = 99; }, x => { x.profile.email = "peer@example.invalid"; },
    x => { x.profile.passwordHash = "secret"; }, x => { x.security.totpSecret = "secret"; },
    x => { x.sessions = []; }, x => { x.sessions[0].userId = 99; },
    x => { x.sessions[0].id = 80; }, x => { x.sessions[0].current = false; },
    x => { x.sessions[0].tokenHash = "secret"; }, x => { x.summary.total = 2; },
    x => { x.summary.active = 0; }, x => { x.summary.revoked = 1; },
    x => { x.debug = "foreign"; },
  ];
  for (const mutate of mutations) {
    const body = account(); mutate(body);
    assert.throws(() => proveAccount(body, actor));
  }
  assert.throws(() => proveAccount(account(), { ...actor, id: 99 }));
  assert.throws(() => proveAccount(account(), actor, ["Fictional A"]));
});
test("authenticated account views must be HTTP no-store, not just no-cache", () => {
  for (const value of ["private, no-store", "no-store, max-age=0",
    "NO-STORE, MAX-AGE=0"]) {
    assert.equal(requireIdentityNoStore(new Headers({ "cache-control": value })), true);
  }
  for (const value of [undefined, "private", "no-cache", "public, no-store",
    "no-store, max-age=60", "no-store, s-maxage=0", "no-store, immutable"]) {
    assert.throws(() => requireIdentityNoStore(new Headers(
      value === undefined ? undefined : { "cache-control": value })),
    /IDENTITY_CACHE_UNSAFE/);
  }
});
test("the two runtime APIs select the session principal and safe session projection", () => {
  const identity = readFileSync("src/app/api/auth/me/route.ts", "utf8");
  const account = readFileSync("src/app/api/account/route.ts", "utf8");
  assert.match(identity, /getSessionUser\(\)/);
  assert.match(identity, /publicUser\(user\)/);
  assert.match(account, /getSessionUser\(\)/);
  assert.match(account, /eq\(users\.id, user\.id\)/);
  assert.match(account, /eq\(sessions\.userId, user\.id\)/);
  assert.match(account, /db\.select\(safeSessionSelect\)/);
  assert.doesNotMatch(account, /organizationId\s*=\s*Number\(.*searchParams/);
  assert.doesNotMatch(identity, /organizationId\s*=\s*Number\(.*searchParams/);
});
test("standalone workflow uses real local PG16 HTTP and real victim/peer sources", () => {
  const wf = readFileSync(".github/workflows/tenant-identity-account-http.yml", "utf8");
  const runner = readFileSync("scripts/qa/tenant-identity-account-http.mjs", "utf8");
  assert.match(wf, /image: postgres:16/);
  assert.match(wf, /npm run db:push/);
  assert.match(wf, /apply-isolated-baseline\.mjs/);
  assert.match(wf, /npm run build/);
  assert.match(wf, /node --import tsx scripts\/qa\/tenant-identity-account-http\.mjs/);
  assert.match(runner, /requireDisposableIdentityAccount\(\)/);
  assert.match(runner, /seedEmployer\("VICTIM"/);
  assert.match(runner, /Fictional Peer/);
  assert.match(runner, /const victimBefore = await snapshot/);
  assert.match(runner, /const victimAfter = await snapshot/);
  assert.match(runner, /const peerAfter = await snapshot/);
  assert.match(runner, /assert\.deepEqual\(victimAfter, victimBefore/);
  assert.match(runner, /assert\.deepEqual\(peerAfter, peerBefore/);
  assert.match(runner, /forgedSelectorsCannotSwitchPrincipal: true/);
  assert.match(runner, /credited: 0, accepted: false/);
});
