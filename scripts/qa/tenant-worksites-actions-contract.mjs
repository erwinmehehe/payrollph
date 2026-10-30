/**
 * Worksites POST all-action proof: test-only contract. Fail-closed preflight and response/SQL assertions.
 * No provider calls, no payroll writes, no method credit from this file; the credit is a separate reviewed step.
 */
import assert from "node:assert/strict";

export const WORKSITES_ENDPOINT = "/api/workforce/worksites";
export const WORKSITE_ACTIONS = Object.freeze([
  "create_worksite", "update_worksite", "assign_employee", "set_arrangement",
  "authorize_site", "deny_site", "end_authorization",
  "configure_punch_photo", "configure_geofence", "disable_geofence",
]);

/** Refuses anything but GitHub Actions + production-mode localhost Next + disposable PostgreSQL. */
export function requireDisposableWorksiteActions(env = process.env) {
  const exact = {
    GITHUB_ACTIONS: "true",
    CI: "true",
    NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_TABLE_PROFILE: "allowlisted-reads",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    TRUSTED_APP_ORIGINS: "http://127.0.0.1:3000",
    DEMO_MODE: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    WFM_GEOFENCE_PILOT_ENABLED: "true",
    WFM_PUNCH_EVIDENCE_ENABLED: "true",
  };
  for (const [name, value] of Object.entries(exact)) {
    assert.equal(env[name], value, "WORKSITE_ACTIONS_REFUSED: exact disposable " + name + " required");
  }
  for (const name of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL", "STRIPE_SECRET_KEY"]) {
    assert.ok(!env[name], "WORKSITE_ACTIONS_REFUSED: external provider secret " + name);
  }
  assert.match(env.TENANT_TABLE_ALLOWLIST_FIXTURE ?? "",
    /^\/tmp\/payrollph-tenant-allowlist-[A-Za-z0-9]{6}\/fixture\.json$/,
    "WORKSITE_ACTIONS_REFUSED: private runner-owned fixture path required");
  // Both pilots must name exactly the same three just-inserted employers, victim included, so a denial can
  // only be a tenant decision and never a disabled pilot.
  const ids = env.WFM_GEOFENCE_PILOT_ORG_IDS ?? "";
  assert.match(ids, /^[1-9][0-9]{0,9},[1-9][0-9]{0,9},[1-9][0-9]{0,9}$/,
    "WORKSITE_ACTIONS_REFUSED: three exact fictional employer IDs required");
  assert.equal(env.WFM_PUNCH_EVIDENCE_ORG_IDS, ids, "WORKSITE_ACTIONS_REFUSED: inconsistent punch and geofence allowlists");
  const parsed = ids.split(",").map(Number);
  assert.ok(parsed.every((id) => Number.isSafeInteger(id) && id <= 2147483647) && new Set(parsed).size === 3 &&
    parsed[2] > parsed[0] && parsed[2] > parsed[1], "WORKSITE_ACTIONS_REFUSED: distinct higher-ID victim employer required");
  return parsed;
}

function visible(response) {
  assert.ok(response && typeof response.text === "string");
  return response.text + "\n" + [...(response.headers ?? [])].map(([name, value]) => name + ":" + value).join("\n");
}

/** A denial must carry a bounded error, no created object and no foreign marker. */
export function assertWorksiteDenied(response, statuses, markers = []) {
  const allowed = Array.isArray(statuses) ? statuses : [statuses];
  assert.ok(allowed.includes(response?.status),
    "wrong tenant or invalid-scope HTTP denial status: got " + response?.status + ", expected " + allowed.join("/"));
  assert.ok(response.json && typeof response.json.error === "string", "a denial returns a bounded error");
  assert.ok(response.text.length < 2000, "a denial may not leak a source row");
  for (const key of ["worksite", "assignment", "arrangement", "authorization", "ok"]) {
    assert.equal(response.json[key], undefined, "a denied write must not return a created " + key);
  }
  for (const marker of markers) {
    assert.ok(typeof marker === "string" && marker.length > 0);
    assert.ok(!visible(response).includes(marker), "foreign employer marker leaked");
  }
}

export function assertImmutableWorksiteSql(before, after, label) {
  assert.deepEqual(after, before, label + ": another employer's worksites, assignments, authorizations, arrangements, policies or audit changed");
}
