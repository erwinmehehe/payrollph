import assert from "node:assert/strict";

/** CI-only proof against fresh local PG16 and localhost Next; never customer systems. */
export function requireDisposableIdentityAccount(env = process.env) {
  let app, db;
  try { app = new URL(env.SECURITY_SMOKE_URL ?? ""); db = new URL(env.DATABASE_URL ?? ""); }
  catch { throw new Error("IDENTITY_PROOF_REFUSED: explicit local URLs required"); }
  const allowed = env.CI === "true" &&
    env.TENANT_SECOND_PASS_MODE === "isolated-ci-only" &&
    env.NODE_ENV === "production" && env.DEMO_MODE === "false" &&
    app.href === "http://127.0.0.1:3000/" &&
    db.protocol === "postgresql:" && db.hostname === "127.0.0.1" &&
    db.port === "5432" && db.pathname === "/app_db" &&
    db.username === "postgres" && db.password === "postgres" &&
    env.PAYMONGO_DISBURSEMENTS_ENABLED === "false" &&
    env.XENDIT_PAYOUTS_ENABLED === "false" &&
    !env.PAYMONGO_SECRET_KEY && !env.XENDIT_SECRET_KEY && !env.RESEND_API_KEY;
  if (!allowed) throw new Error("IDENTITY_PROOF_REFUSED: disposable empty PG16/localhost and no providers required");
  return true;
}
export function requireIdentityNoStore(headers) {
  const raw = headers?.get?.("cache-control");
  const parts = typeof raw === "string" ? raw.toLowerCase().split(",").map(s => s.trim()) : [];
  const unsafe = parts.some(s => s === "public" || s === "immutable" ||
    /^s-maxage(?:\s*=|$)/.test(s) ||
    (/^max-age(?:\s*=|$)/.test(s) && !/^max-age\s*=\s*0$/.test(s)));
  if (!parts.includes("no-store") || unsafe) throw new Error("IDENTITY_CACHE_UNSAFE");
  return true;
}
function exactObject(value, fields, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), label + " must be object");
  assert.deepEqual(Object.keys(value).sort(), [...fields].sort(), label + " unexpected fields");
}
function noForeign(value, markers) {
  const text = JSON.stringify(value).toLowerCase();
  for (const m of markers) assert.ok(!text.includes(m.toLowerCase()), "Foreign identity marker leaked");
}
/** GET auth/me: signed-in data is exact; anonymous intentionally has user:null. */
export function proveMe(body, expected, forbidden = []) {
  exactObject(body, ["user"], "identity");
  exactObject(body.user, ["id", "name", "email", "role", "totpEnabled", "employeeId"], "public user");
  for (const field of ["id", "name", "email", "role", "totpEnabled", "employeeId"]) {
    assert.equal(body.user[field], expected[field], "signed-in identity mismatch " + field);
  }
  noForeign(body, forbidden);
  return true;
}
/** GET account: only cookie user's own safe session projection, no hashes. */
export function proveAccount(body, expected, forbidden = []) {
  exactObject(body, ["profile", "security", "sessions", "summary"], "account");
  exactObject(body.profile, ["id", "name", "email", "role", "createdAt"], "account profile");
  for (const field of ["id", "name", "email", "role"]) {
    assert.equal(body.profile[field], expected[field], "account principal mismatch " + field);
  }
  assert.ok(Number.isFinite(Date.parse(body.profile.createdAt)), "real createdAt required");
  exactObject(body.security, ["passwordAuth", "totpEnabled", "backupCodes", "accountLockedUntil", "sessionDays"], "security");
  assert.equal(body.security.passwordAuth, true);
  assert.equal(body.security.totpEnabled, expected.totpEnabled);
  assert.ok(Number.isSafeInteger(body.security.backupCodes) && body.security.backupCodes >= 0);
  assert.equal(body.security.sessionDays, 14);
  assert.ok(Array.isArray(body.sessions) && body.sessions.length > 0, "nonempty own current session required");
  const ids = new Set();
  for (const row of body.sessions) {
    exactObject(row, [
      "id", "userId", "createdAt", "expiresAt", "revokedAt",
      "lastSeenAt", "userAgent", "ip", "label", "current", "active", "expiresSoon",
    ], "safe session");
    assert.equal(row.userId, expected.id, "other employer/peer user session leaked");
    assert.ok(Number.isSafeInteger(row.id) && row.id > 0 && !ids.has(row.id), "invalid/duplicate session");
    ids.add(row.id);
    for (const name of ["current", "active", "expiresSoon"]) {
      assert.equal(typeof row[name], "boolean");
    }
  }
  assert.ok(ids.has(expected.sessionId), "actual persisted cookie session missing");
  assert.equal(body.sessions.filter(s => s.current).length, 1, "exactly one current session");
  assert.equal(body.sessions.find(s => s.current)?.id, expected.sessionId);
  exactObject(body.summary, ["total", "active", "otherActive", "expired", "revoked"], "summary");
  assert.equal(body.summary.total, body.sessions.length);
  assert.equal(body.summary.active, body.sessions.filter(s => s.active).length);
  assert.equal(body.summary.otherActive, body.sessions.filter(s => s.active && !s.current).length);
  assert.equal(body.summary.expired, body.sessions.filter(s => !s.active && !s.revokedAt).length);
  assert.equal(body.summary.revoked, body.sessions.filter(s => Boolean(s.revokedAt)).length);
  noForeign(body, forbidden);
  return true;
}
