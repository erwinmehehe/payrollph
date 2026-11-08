import assert from "node:assert/strict";

/** WPS-01 is a new, isolated evidence family. Never share a manifest credit. */
export const WPS01_METHOD = "POST workforce-planning/scenarios";
export const WPS01_ROUTE = "src/app/api/workforce-planning/scenarios/route.ts";
export const WPS01_SOURCE_BLOB = "2b1ab188bf9a58d5235e94e00617ecbfd4f2e6a0";

export function requireDisposableWps01(env = process.env) {
  let app, db;
  try {
    app = new URL(env.SECURITY_SMOKE_URL ?? "");
    db = new URL(env.DATABASE_URL ?? "");
  } catch {
    throw new Error("WPS01_REFUSED: explicit disposable app and DB required");
  }
  const off = [
    "PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED",
    "XENDIT_BILLING_ENABLED", "WORKER_ENABLED", "CENTRAL_SCHEDULER_ENABLED",
  ];
  const absent = [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL", "STRIPE_SECRET_KEY",
  ];
  const permitted = env.GITHUB_ACTIONS === "true"
    && env.CI === "true"
    && env.TENANT_WPS01_MODE === "fictional-pg16-http"
    && env.TENANT_SECOND_PASS_MODE === "isolated-ci-only"
    && env.NODE_ENV === "production"
    && env.DEMO_MODE === "false"
    && app.href === "http://127.0.0.1:3000/"
    && db.href === "postgresql://postgres:postgres@127.0.0.1:5432/app_db"
    && env.APP_BASE_URL === "https://payroll.example.test"
    && off.every(key => env[key] === "false")
    && absent.every(key => !env[key]);
  if (!permitted) {
    throw new Error("WPS01_REFUSED: fresh fictional GitHub PG16/localhost, no external provider, no worker, no money");
  }
  return true;
}

export function assertWps01Denied(response, expectedStatus, forbidden = []) {
  assert.equal(response?.status, expectedStatus, "wrong real-HTTP denial status");
  assert.ok(response?.json && typeof response.json.error === "string",
    "a real JSON error is required (not a fake response or HTML)");
  const text = response.text + "\n" + [...(response.headers ?? [])]
    .map(([key, value]) => key + ": " + value).join("\n");
  for (const marker of forbidden) {
    assert.ok(typeof marker === "string" && marker.length > 0, "missing real victim marker");
    assert.ok(!text.includes(marker), "a denial leaked foreign employer data");
  }
  assert.doesNotMatch(text, /(?:from|select|insert)\s+"?[a-z_]+"?\s|PostgresError|DrizzleQueryError|relation "[^"]+"/i,
    "a denial disclosed private SQL implementation details");
  return response.json;
}

export function assertWps01Created(response, row, employer, plan, expectedVersion) {
  assert.equal(response?.status, 201, "owned HTTP scenario creation did not succeed");
  assert.ok(row && Number.isSafeInteger(row.id) && row.id > 0, "real persisted scenario required");
  assert.equal(row.organizationId, employer.org.id, "foreign scenario was inserted");
  assert.equal(row.createdByUserId, employer.owner.id, "wrong signed-in owner");
  assert.equal(row.planId, plan.id, "linked plan belongs to the wrong employer");
  assert.equal(row.version, expectedVersion, "version or insert drift");
  assert.equal(row.status, "draft", "scenario creation must not submit or approve anything");
  assert.equal(response.json?.scenario?.id, row.id, "HTTP response does not prove saved row");
  assert.equal(response.json?.scenario?.organizationId, employer.org.id,
    "HTTP response chose the wrong employer");
  assert.match(row.snapshotHash, /^[a-f0-9]{64}$/, "forecast snapshot is not hashed");
  return row;
}

export function assertWps01Unchanged(before, after, label) {
  assert.deepEqual(after, before, label + ": denial changed actual employer, payroll, scenario or audit records");
  return true;
}
