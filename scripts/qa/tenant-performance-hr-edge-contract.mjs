import assert from "node:assert/strict";

export const METHODS = Object.freeze({
  "POST performance/continuous": ["one_on_one", "feedback"],
  "POST performance/development-plans": ["plan", "milestone"],
});

/** No DB, app import or HTTP request may occur before this gate. */
export function requireDisposablePerformanceHr(env = process.env) {
  const fail = (why) => { throw new Error("PERFORMANCE_HR_EDGE_REFUSED: " + why); };
  let app, database;
  try {
    app = new URL(env.SECURITY_SMOKE_URL ?? "");
    database = new URL(env.DATABASE_URL ?? "");
  } catch { fail("explicit local URLs required"); }
  const checks = [
    [env.CI === "true" && env.GITHUB_ACTIONS === "true", "GitHub CI only"],
    [env.TENANT_SECOND_PASS_MODE === "isolated-ci-only", "tenant proof mode required"],
    [env.TENANT_PERFORMANCE_HR_EDGE_MODE === "fictional-disposable-only", "dedicated opt-in required"],
    [env.NODE_ENV === undefined, "runner must unset NODE_ENV (server stays production-mode)"],
    [app.protocol === "http:" && app.hostname === "127.0.0.1" &&
      app.port === "3000" && app.pathname === "/" && !app.search && !app.hash &&
      !app.username && !app.password, "loopback app on port 3000 only"],
    [database.protocol === "postgresql:" && database.hostname === "127.0.0.1" &&
      database.port === "5432" && database.pathname === "/app_db" &&
      database.username === "postgres" && database.password === "postgres" &&
      !database.search && !database.hash, "disposable PG16 app_db only"],
    [env.DEMO_MODE === "false", "no public demo mode"],
    [env.WORKER_ENABLED === "false" && env.CENTRAL_SCHEDULER_ENABLED === "false", "background workers forbidden"],
    [env.PAYMONGO_DISBURSEMENTS_ENABLED === "false" &&
      env.XENDIT_PAYOUTS_ENABLED === "false" && env.XENDIT_BILLING_ENABLED === "false", "money/provider flags forbidden"],
  ];
  for (const [ok, message] of checks) if (!ok) fail(message);
  for (const key of [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_API_KEY",
    "RESEND_API_KEY", "SMTP_URL", "NEON_DATABASE_URL", "DATABASE_URL_UNPOOLED",
  ]) if (env[key]) fail(key + " must be absent");
}

export function assertDenied(result, expected, forbiddenMarkers = []) {
  assert.equal(result.status, expected, "incorrect refusal status " + String(result.text).slice(0, 160));
  const values = String(result.text) + "\n" +
    [...(result.headers?.entries?.() ?? [])].map(([key, value]) => key + ":" + value).join("\n");
  for (const marker of forbiddenMarkers) assert.ok(!values.includes(marker), "foreign marker in denied HTTP response");
  return result;
}

export function assertEquivalentNotFound(realForeign, absentId, forbiddenMarkers = []) {
  assertDenied(realForeign, 404, forbiddenMarkers);
  assertDenied(absentId, 404, forbiddenMarkers);
  assert.equal(realForeign.text, absentId.text, "foreign and absent IDs must be indistinguishable");
}

export function assertNewOwnedRow(before, after, result, expected) {
  assert.equal(result.status, 201, "actual successful POST must return 201");
  assert.ok(result.json && typeof result.json === "object", "real JSON response required");
  assert.ok(Number.isSafeInteger(result.json.id) && result.json.id > 0, "persisted real ID required");
  assert.equal(after.length, before.length + 1, "exactly one new owned row required");
  const newRows = after.filter(row => !before.some(old => old.id === row.id));
  assert.equal(newRows.length, 1, "new row must not reuse a prior ID");
  const row = newRows[0];
  assert.equal(row.id, result.json.id, "HTTP response must identify persisted row");
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(row[key], value, "incorrect persisted " + key);
    assert.deepEqual(result.json[key], value, "incorrect response " + key);
  }
  assert.deepEqual(after.filter(x => x.id !== row.id), before, "unrelated same-tenant rows must be unchanged");
  return row;
}
