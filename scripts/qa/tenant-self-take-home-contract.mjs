/**
 * Exact-method, uncredited tenant isolation candidate:
 * GET /api/self/take-home-estimate.
 *
 * This module is pure. It must refuse any non-disposable target BEFORE the
 * HTTP runner imports application code or opens PostgreSQL. Never use live pay.
 */
import assert from "node:assert/strict";

export const METHOD = "GET self/take-home-estimate";
export const ENDPOINT = "/api/self/take-home-estimate";
export const ESTIMATE_KEYS = Object.freeze([
  "monthlyBasic", "taxableAllowances", "nonTaxableAllowances", "gross",
  "sss", "philHealth", "pagIbig", "voluntaryPagIbig",
  "taxableCompensation", "withholdingTax", "totalDeductions", "netPay",
]);

export function requireDisposableTakeHome(env = process.env, stage = "prove") {
  if (!["seed", "prove"].includes(stage)) {
    throw Error("TAKE_HOME_REFUSED: unknown proof stage");
  }
  let db, app;
  try {
    db = new URL(env.DATABASE_URL);
    app = new URL(env.SECURITY_SMOKE_URL);
  } catch {
    throw Error("TAKE_HOME_REFUSED: explicit disposable URLs required");
  }
  const providerSecrets = [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL", "STRIPE_SECRET_KEY",
  ];
  const safe =
    env.CI === "true" &&
    env.NODE_ENV === "production" &&
    env.TENANT_SECOND_PASS_MODE === "isolated-ci-only" &&
    env.TENANT_SELF_TAKE_HOME_MODE === "fictional-read-only" &&
    env.WORKER_ENABLED === "false" &&
    env.CENTRAL_SCHEDULER_ENABLED === "false" &&
    env.PAYMONGO_DISBURSEMENTS_ENABLED === "false" &&
    env.XENDIT_PAYOUTS_ENABLED === "false" &&
    env.XENDIT_BILLING_ENABLED === "false" &&
    env.PAYROLL_OVERPAYMENT_REVIEW_ENABLED === "false" &&
    env.HCM_OVERPAYMENT_PREVIEW_ENABLED === "false" &&
    typeof env.WORKER_TOKEN === "string" &&
    env.WORKER_TOKEN.startsWith("ci-worker-token-") &&
    app.href === "http://127.0.0.1:3000/" &&
    db.protocol === "postgresql:" &&
    db.hostname === "127.0.0.1" &&
    db.port === "5432" &&
    db.pathname === "/app_db" &&
    db.username === "postgres" &&
    db.password === "postgres" &&
    !db.search && !db.hash &&
    !providerSecrets.some(name => env[name]);
  if (!safe) {
    throw Error("TAKE_HOME_REFUSED: only isolated CI PG16 and localhost, with workers and providers disabled");
  }
}

function keys(object, expected, label) {
  assert.ok(object !== null && typeof object === "object" && !Array.isArray(object),
    label + " must be a JSON object");
  assert.deepEqual(Object.keys(object).sort(), [...expected].sort(),
    label + " must not expose identity, bank, profile or unrelated payroll fields");
}
function closeMoney(value, expected, label) {
  assert.ok(typeof value === "number" && Number.isFinite(value), label + " must be finite");
  assert.ok(Math.abs(value - expected) < 0.011, label + " must be centavo consistent");
}
function headerValue(headers, name) {
  if (headers && typeof headers.get === "function") return headers.get(name);
  return headers?.[name] ?? headers?.[name.toLowerCase()] ?? null;
}

export function assertOwnTakeHome(response, actor) {
  assert.equal(response.status, 200, "own signed-in employee must obtain real HTTP 200");
  keys(response.json, ["asOf", "baseline", "estimate", "note"], "response");
  const { asOf, baseline, estimate, note } = response.json;
  assert.match(asOf, /^\d{4}-\d{2}-\d{2}$/, "must return an actual calendar date");
  const ms = Date.parse(asOf + "T00:00:00Z");
  assert.ok(Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === asOf);
  keys(baseline, ["monthlyBasic", "payBasis", "mwe"], "employee baseline");
  assert.deepEqual(baseline, {
    monthlyBasic: actor.monthlyBasic, payBasis: actor.payBasis, mwe: actor.mwe,
  }, "this must be the actual employee's independent source profile");
  keys(estimate, ESTIMATE_KEYS, "take-home estimate");
  for (const key of ESTIMATE_KEYS) {
    assert.ok(typeof estimate[key] === "number" && Number.isFinite(estimate[key]),
      key + " must be a finite number");
  }
  closeMoney(estimate.monthlyBasic, actor.monthlyBasic, "estimated own monthly basic");
  for (const key of ["taxableAllowances", "nonTaxableAllowances", "voluntaryPagIbig"]) {
    assert.equal(estimate[key], 0, key + " is not part of this source-only baseline");
  }
  closeMoney(estimate.gross, actor.monthlyBasic, "gross");
  closeMoney(estimate.totalDeductions,
    estimate.sss + estimate.philHealth + estimate.pagIbig +
    estimate.voluntaryPagIbig + estimate.withholdingTax, "deductions");
  closeMoney(estimate.netPay, estimate.gross - estimate.totalDeductions, "net");
  assert.ok(typeof note === "string" && note.includes("released payslip"),
    "estimates must not masquerade as authoritative payroll");
  const cache = headerValue(response.headers, "cache-control") || "";
  assert.match(cache, /(?:^|[,\s])no-store(?:$|[,\s])/i, "sensitive responses must not be cached");
  assert.ok(!/(?:^|[,\s])(?:public|s-maxage\s*=)/i.test(cache),
    "sensitive responses must never have public/shared-cache directives");
  return response.json;
}

export function assertPrivateDenial(response, expectedStatus, forbiddenMarkers = []) {
  assert.equal(response.status, expectedStatus,
    "denial HTTP " + response.status + ": " + String(response.text).slice(0, 160));
  assert.ok(response.json && typeof response.json.error === "string");
  assert.ok(!Object.hasOwn(response.json, "baseline") &&
    !Object.hasOwn(response.json, "estimate"), "denial must not disclose pay");
  for (const marker of forbiddenMarkers) {
    assert.ok(!String(response.text).includes(marker),
      "denial must not expose a foreign worker/employer marker");
  }
}

export function assertUnchanged(before, after, label) {
  assert.deepEqual(after, before, label + " must leave all scoped source rows unchanged");
}
