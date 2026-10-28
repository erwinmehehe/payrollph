/**
 * Pure fail-closed gate for fictional tenant-isolation evidence only.
 * GET and POST /api/self/schedule-receipts stay GAP; zero coverage credits.
 */
import assert from "node:assert/strict";

export const METHODS = Object.freeze(["GET self/schedule-receipts", "POST self/schedule-receipts"]);
export const ENDPOINT = "/api/self/schedule-receipts";

export function requireDisposableScheduleReceipt(env = process.env) {
  const refused = "SCHEDULE_RECEIPT_TENANT_REFUSED";
  let app, database;
  try {
    app = new URL(env.SECURITY_SMOKE_URL ?? "");
    database = new URL(env.DATABASE_URL ?? "");
  } catch { throw Error(refused + ": explicit endpoints required"); }
  const forbidden = [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL", "STRIPE_SECRET_KEY",
  ];
  const safe = env.GITHUB_ACTIONS === "true" && env.CI === "true" &&
    env.NODE_ENV === "production" && env.DEMO_MODE === "false" &&
    env.TENANT_SECOND_PASS_MODE === "isolated-ci-only" &&
    env.TENANT_RECEIPT_MODE === "fictional-only" &&
    env.DATABASE_URL === "postgresql://postgres:postgres@127.0.0.1:5432/app_db" &&
    env.SECURITY_SMOKE_URL === "http://127.0.0.1:3000" &&
    app.href === "http://127.0.0.1:3000/" &&
    database.href === "postgresql://postgres:postgres@127.0.0.1:5432/app_db" &&
    env.WFM_SCHEDULE_RECEIPTS_ENABLED === "true" &&
    env.WFM_SCHEDULE_RECEIPTS_ALLOWED_ORGANIZATION_IDS === "1,2,3" &&
    env.WORKER_ENABLED === "false" && env.CENTRAL_SCHEDULER_ENABLED === "false" &&
    env.PAYMONGO_DISBURSEMENTS_ENABLED === "false" &&
    env.XENDIT_PAYOUTS_ENABLED === "false" &&
    env.XENDIT_BILLING_ENABLED === "false" &&
    env.HCM_OVERPAYMENT_PREVIEW_ENABLED === "false" &&
    env.PAYROLL_OVERPAYMENT_REVIEW_ENABLED === "false" &&
    String(env.WORKER_TOKEN ?? "").startsWith("ci-worker-token-") &&
    !forbidden.some(name => Boolean(env[name]));
  if (!safe) throw Error(refused + ": disposable GitHub Actions PG16 localhost only; no providers or money");
}

export function assertNoPrivateResponse(response, markers = []) {
  assert.ok(response && typeof response.text === "string");
  for (const marker of markers) {
    if (marker) assert.ok(!response.text.includes(marker),
      "HTTP response must never disclose other-employee or other-tenant markers");
  }
}

/**
 * Next.js may normalize "private, no-store" into "no-store, max-age=0" for
 * dynamic route responses. Both prohibit storage, but public/shared-cache
 * directives, stale response reuse or a positive TTL must remain failures.
 * Check complete directives, not a substring such as "no-storex".
 */
export function assertPrivateNoStore(headers) {
  assert.ok(headers && typeof headers.get === "function", "HTTP cache headers required");
  const raw = headers.get("cache-control");
  assert.ok(typeof raw === "string" && raw.trim(), "private employee response must set Cache-Control");
  const directives = raw.toLowerCase().split(",").map(part => part.trim()).filter(Boolean);
  assert.ok(directives.includes("no-store"), "private employee response must prohibit storage");
  assert.ok(!directives.some(directive => directive === "public" || directive === "immutable"
    || /^s-maxage(?:=|$)/.test(directive) || /^stale-(?:while-revalidate|if-error)(?:=|$)/.test(directive)),
  "private employee response cannot enable shared or stale caching");
  assert.ok(directives.every(directive => !/^max-age(?:=|$)/.test(directive)
    || directive === "max-age=0"),
  "private employee response cannot advertise a positive cache lifetime");
}

export function assertOwnSchedule(response, employer, expectedState = "pending", markers = []) {
  assert.equal(response.status, 200, employer.label + " own GET must succeed");
  assert.ok(response.json && typeof response.json === "object");
  assert.deepEqual(Object.keys(response.json).sort(), ["boundary", "days"]);
  assert.equal(response.json.days.length, 7);
  assertPrivateNoStore(response.headers);
  assert.ok((response.headers.get("vary") ?? "").includes("Cookie"));
  const day = response.json.days[0];
  assert.equal(day.date, employer.date);
  assert.equal(day.state, expectedState);
  assert.equal(day.snapshot?.source, "override");
  assert.equal(day.snapshot?.segments?.length, 1);
  assert.equal(day.snapshot.segments[0].shiftDefinitionId, employer.shift.id);
  assert.equal(day.snapshot.segments[0].shiftName, employer.shiftName);
  assert.match(day.snapshotHash, /^[a-f0-9]{64}$/);
  assertNoPrivateResponse(response, markers);
  return day;
}

export function assertPrivateDenial(response, status, markers = []) {
  assert.equal(response.status, status, "unexpected denied status: " + response.text.slice(0, 180));
  assert.equal(typeof response.json?.error, "string");
  assert.ok(!("days" in response.json) && !("snapshotHash" in response.json) &&
    !("created" in response.json), "a denial must not include schedule or receipt contents");
  assertNoPrivateResponse(response, markers);
}

export function assertUnchanged(before, after, message) {
  assert.deepEqual(after, before, message + ": protected SQL employer rows, audit, and payroll must not change");
}
