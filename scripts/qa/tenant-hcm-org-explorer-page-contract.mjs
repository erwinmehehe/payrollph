/**
 * Source-sealed HCM Organization Explorer page + read API tenant proof.
 * Fictional PG16/localhost only; ZERO method/page credits; NOT ACCEPTED.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const ORIGIN = "http://127.0.0.1:3000";
export const PAGE = "/hcm/org-explorer";
export const GRAPH = "/api/hcm/org-explorer";
export const HISTORY = "/api/hcm/position-history";

export const SOURCE_PINS = Object.freeze({
  "src/app/hcm/org-explorer/page.tsx": "89df291ced721e908d1c3023b8ec8c94919f479c",
  "src/app/api/hcm/org-explorer/route.ts": "09d8ee08b74f3e8235ae6a4b06537ccd20121a72",
  "src/app/api/hcm/position-history/route.ts": "0eb927272ee9dc2b68ad57a1012d17c7b2e53653",
  "src/lib/hcm-org-explorer-access.ts": "5a1b261812e4f0576a1c2559e2d479837abdb8e7",
  "src/lib/hcm-org-explorer-server.ts": "7565fc1f8f17e1655479f4a82603d7876164181d",
  "src/lib/hcm-org-explorer-projection.ts": "b345695fbe8b5eb81af4ceef73224dd53b57f314",
  "src/lib/hcm-enterprise-plan-server.ts": "b436a61f091871e02bb662393429667cadb71b35",
  "src/lib/access.ts": "08d3481dbd20279a4a8aef64f0932f79bec48444",
  "src/lib/auth.ts": "b13275e0e09b629ddb679c55e7898da44c72ad20",
  "src/components/hcm-org-explorer.tsx": "9aa5fda589eef840c9eb8a6eb7ade007047f0871"
});

function gitSha(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return createHash("sha1").update(Buffer.from("blob " + b.length + "\0")).update(b).digest("hex");
}

export function verifySources(read = readFileSync) {
  for (const [path, sha] of Object.entries(SOURCE_PINS)) {
    assert.equal(gitSha(read(path)), sha,
      "ORG_EXPLORER_PROOF_REFUSED: changed reviewed source " + path);
  }
  const page = String(read("src/app/hcm/org-explorer/page.tsx"));
  const graph = String(read("src/app/api/hcm/org-explorer/route.ts"));
  const history = String(read("src/app/api/hcm/position-history/route.ts"));
  const loader = String(read("src/lib/hcm-org-explorer-server.ts"));
  for (const needle of [
    "hcmOrgExplorerPositiveId(", "hcmOrgExplorerEnabledForEmployer(",
    "denyHcmOrgExplorer(user.id, organizationId)", "getAccess(user.id, organizationId)"
  ]) assert.ok(page.includes(needle),
    "ORG_EXPLORER_PROOF_REFUSED: SSR boundary removed " + needle);
  for (const source of [graph, history]) {
    for (const needle of ["getSessionUser()", "hcmOrgExplorerEnabledForEmployer(organizationId)",
      "denyHcmOrgExplorer(user.id, organizationId)", "denyOptInEnterpriseHcmPlan(organizationId)"]) {
      assert.ok(source.includes(needle),
        "ORG_EXPLORER_PROOF_REFUSED: API access boundary removed " + needle);
    }
  }
  for (const needle of [
    "eq(orgUnits.organizationId, organizationId)",
    "eq(positions.organizationId, organizationId)",
    "eq(positionAssignments.organizationId, organizationId)",
    "eq(positionAssignments.positionId, positionId)",
    "eq(employees.organizationId, organizationId)",
    "eq(positions.id, positionId)"
  ]) assert.ok(loader.includes(needle),
    "ORG_EXPLORER_PROOF_REFUSED: employer or object predicate removed " + needle);
  return true;
}

export function requireFictionalEnvironment(env = process.env) {
  const exact = {
    CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
    TENANT_ORG_EXPLORER_PROOF: "fictional-pg16-only",
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN,
    SECURITY_SMOKE_URL: ORIGIN,
    HCM_ORG_EXPLORER_ENABLED: "true",
    HCM_ORG_EXPLORER_ORG_IDS: "8,9,10",
    HCM_ENTERPRISE_PLAN_GATE_ENABLED: "false",
    DEMO_MODE: "false", REQUIRE_PRIVILEGED_MFA: "true",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false"
  };
  for (const [key, value] of Object.entries(exact)) {
    assert.equal(env[key], value, "ORG_EXPLORER_PROOF_REFUSED: unsafe or missing " + key);
  }
  for (const key of [
    "PAYMONGO_SECRET_KEY", "PAYMONGO_WEBHOOK_SECRET", "XENDIT_SECRET_KEY",
    "XENDIT_PAYOUT_SECRET_KEY", "XENDIT_CALLBACK_TOKEN", "STRIPE_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL", "SMTP_PASSWORD",
    "OPENAI_API_KEY", "CRON_SECRET", "WORKER_TOKEN", "VERCEL",
    "MALWARE_SCAN_URL", "MALWARE_SCAN_TOKEN"
  ]) assert.ok(!env[key], "ORG_EXPLORER_PROOF_REFUSED: external credential " + key);
  return true;
}

export function assertNoTenantLeak(response, employers, label, actor = null) {
  assert.equal(typeof response?.text, "string", label + ": actual HTTP response required");
  const body = response.text.replace(/\\u([0-9a-fA-F]{4})/g,
    (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  const headers = response.headers ? Array.from(response.headers.entries()).join(" ") : "";
  for (const company of employers) {
    if (company === actor) continue;
    assert.ok(!body.includes(company.marker) && !headers.includes(company.marker),
      label + ": foreign employer marker exposed");
    for (const secret of company.secrets ?? [])
      assert.ok(!body.includes(secret) && !headers.includes(secret),
        label + ": foreign private data exposed");
  }
  for (const secret of actor?.secrets ?? [])
    assert.ok(!body.includes(secret), label + ": own private field exposed");
}

export function assertOwnPage(res, actor, employers) {
  assert.equal(res.status, 200, "Owned Organization Explorer SSR must be HTTP 200");
  assert.ok(res.text.includes("Organizations") && res.text.includes("Positions") &&
    res.text.includes("organizationId=" + actor.org.id),
    "Owned SSR must render its organization-specific navigation, not an error shell");
  assertNoTenantLeak(res, employers, "owned Organization Explorer SSR", actor);
}

export function assertOwnGraph(res, actor, employers) {
  assert.equal(res.status, 200, "Owned organization source must be HTTP 200");
  assert.ok(res.headers?.get("cache-control")?.includes("no-store"), "Graph must be no-store");
  assert.equal(res.json?.tenantId, actor.org.id, "Graph employer must be the selected employer");
  assert.ok(Array.isArray(res.json?.units) &&
    res.json.units.some(unit => unit.id === actor.unit.id),
    "Owned nonempty graph must return a persisted org unit");
  assert.ok(Array.isArray(res.json?.positions) &&
    res.json.positions.some(position => position.id === actor.position.id),
    "Owned nonempty graph must return a persisted employer position");
  assertNoTenantLeak(res, employers, "owned graph", actor);
}

export function assertOwnHistory(res, actor, employers) {
  assert.equal(res.status, 200, "Owned position history must be HTTP 200");
  assert.ok(res.headers?.get("cache-control")?.includes("no-store"),
    "Position history must be no-store");
  assert.equal(res.json?.tenantId, actor.org.id);
  assert.equal(res.json?.positionId, actor.position.id);
  assert.ok(res.json?.history?.preview?.items?.some(row =>
    row.id === actor.assignment.id && row.employeeId === actor.worker.id),
    "Position history must contain a real employer-bound worker assignment");
  assertNoTenantLeak(res, employers, "owned history", actor);
}

export function assertDenied(res, status, employers, label) {
  assert.equal(res.status, status, label + ": expected denial HTTP status");
  assertNoTenantLeak(res, employers, label);
  assert.ok(!res.json?.tenantId && !res.json?.history && !res.json?.positions,
    label + ": denied read contained employer data");
}

export function assertSqlUnchanged(before, after, label) {
  assert.deepEqual(after, before, label + ": read-only HTTP changed employer data or audit");
}