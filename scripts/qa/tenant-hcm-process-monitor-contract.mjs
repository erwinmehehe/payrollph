/**
 * HCM process-monitor SSR candidate: source-pinned, read-only, zero credits.
 * The test runner refuses anything except fictional PG16 on localhost before
 * importing a DB/app module or making HTTP requests.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const ORIGIN = "http://127.0.0.1:3000";
export const PAGE = "/hcm/process-monitor";
export const SOURCE_PINS = Object.freeze({
  "src/app/hcm/process-monitor/page.tsx": "977ae3415144cfa509e709c9a9422d93b6a9f97a",
  "src/lib/hcm-process-monitor-server.ts": "0d2d001e36fa40379f554d376a9ebd8a98221dcd",
  "src/lib/hcm-process-monitor.ts": "fe16b35e185eeea946770c7187ae1f66ca51cc6e",
  "src/app/api/hcm/process-monitor/route.ts": "743f4950560e755e4fcc4e7fb1b5b7f6b100c761",
  "src/lib/access.ts": "08d3481dbd20279a4a8aef64f0932f79bec48444",
  "scripts/qa/tenant-table-http.mjs": "31894982d768e34c1653be7c4335194f60233c6e",
});

export function gitBlobSha(bytes) {
  const value = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash("sha1").update(Buffer.from("blob " + value.length + "\0"))
    .update(value).digest("hex");
}

export function requireDisposableMonitorEnv(env = process.env) {
  const required = {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
    TENANT_MONITOR_PAGE_PROOF: "fictional-pg16-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN,
    SECURITY_SMOKE_URL: ORIGIN, DEMO_MODE: "false",
    REQUIRE_PRIVILEGED_MFA: "true",
    HCM_PROCESS_MONITOR_ENABLED: "true",
    HCM_PROCESS_MONITOR_ORG_IDS: "1,2,3",
    MULTI_ENTITY_ENABLED: "false",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  };
  for (const [key, value] of Object.entries(required))
    assert.equal(env[key], value, "TENANT_MONITOR_REFUSED: unsafe " + key);
  for (const key of [
    "PAYMONGO_SECRET_KEY", "PAYMONGO_WEBHOOK_SECRET",
    "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
    "STRIPE_SECRET_KEY", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN",
    "SMTP_URL", "SMTP_PASSWORD", "WORKER_TOKEN", "CRON_SECRET", "OPENAI_API_KEY",
  ]) assert.ok(!env[key], "TENANT_MONITOR_REFUSED: provider credential " + key);
  return true;
}

/** Current-source enforcement. A changed loader/API no longer borrows the receipt. */
export function verifyMonitorSource() {
  for (const [file, sha] of Object.entries(SOURCE_PINS))
    assert.equal(gitBlobSha(readFileSync(file)), sha,
      "TENANT_MONITOR_REFUSED: source changed " + file);
  const page = readFileSync("src/app/hcm/process-monitor/page.tsx", "utf8");
  const session = page.indexOf("await getSessionUser()");
  const role = page.indexOf("await assertOrganizationRole(");
  const scope = page.indexOf("canReadHcmProcessMonitor(access)");
  const plan = page.indexOf("await denyOptInEnterpriseHcmPlan(");
  const lookup = page.indexOf("const [ownedProcess] = await db.select");
  const checkOrg = page.indexOf("eq(hcmBusinessProcessInstances.organizationId, organizationId)");
  const checkId = page.indexOf("eq(hcmBusinessProcessInstances.id, selectedProcessId)");
  const denial = page.indexOf("if (!ownedProcess) notFound()");
  const loader = page.indexOf("source = await loadHcmProcessMonitor(");
  const render = page.indexOf("const view = source;");
  assert.ok(session >= 0 && role > session && scope > role && plan > scope &&
    lookup > plan && checkOrg > lookup && checkId > checkOrg &&
    denial > checkId && loader > denial && render > loader,
    "TENANT_MONITOR_REFUSED: role/owner/process authorization before SSR");
  for (const value of [
    "if (Object.values(query).some(Array.isArray)) notFound();",
    "canonicalHcmId(one(query.organizationId))",
    "monitorEnabledForEmployer(organizationId)",
    "if (!validMonitorFilter(filterText) || cursor === null ||",
    'eq(hcmBusinessProcessInstances.organizationId, organizationId)',
    "eq(hcmBusinessProcessInstances.id, selectedProcessId)",
    "if (!ownedProcess) notFound()",
    'selectedProcessId !== null && source?.detail.state === "not_found"',
  ]) assert.ok(page.includes(value), "TENANT_MONITOR_REFUSED: missing boundary " + value);
  assert.ok(!page.slice(lookup, loader).includes("catch"),
    "TENANT_MONITOR_REFUSED: authorization fault must not fall back");
  const sql = readFileSync("src/lib/hcm-process-monitor-server.ts", "utf8");
  for (const token of [
    "eq(hcmBusinessProcessInstances.organizationId, organizationId)",
    "eq(hcmBusinessProcessInstanceSteps.organizationId, organizationId)",
    "eq(hcmBusinessProcessInstanceSteps.instanceId, selectedProcessId)",
    "eq(hcmBusinessProcessInstances.id, selectedProcessId)",
    "MONITOR_PAGE_SIZE + 1", "MONITOR_STEP_LIMIT + 1",
  ]) assert.ok(sql.includes(token), "TENANT_MONITOR_REFUSED: loader source drift");
  assert.ok(!sql.includes("db.update(") && !sql.includes("db.insert(") &&
    !sql.includes("db.delete("), "TENANT_MONITOR_REFUSED: writes not permitted");
  return true;
}

export function normalizeSsrText(html) {
  return html.replace(/<!--\s*-->/g, "").replaceAll("&amp;", "&");
}
export function noForeignProcess(html, subjects, label, { allowRequestIdReflection = false } = {}) {
  const visible = normalizeSsrText(html);
  for (const subject of subjects) {
    // A caller knows the numeric process ID they put in the requested URL.
    // Next.js may serialize that URL into its generic 404 response; numeric
    // selector reflection alone does not imply a private process disclosure.
    // On successful own-employer pages, however, foreign process links are forbidden.
    const confidential = [subject.marker, subject.org.name, subject.process?.sourceKey];
    if (!allowRequestIdReflection && subject.process?.id)
      confidential.push("processId=" + subject.process.id);
    for (const value of confidential) {
      if (value) assert.ok(!visible.includes(String(value)),
        label + ": foreign process/employer marker disclosed: " + String(value));
    }
  }
}
export function assertOwnMonitorPage(response, actor, subjects, { selected = true } = {}) {
  assert.equal(response.status, 200, "Owned monitor page must return HTTP 200");
  assert.match(response.headers.get("content-type") || "", /text\/html/i);
  const text = normalizeSsrText(response.text);
  assert.ok(text.includes("Business Process Monitor"), "Not the real monitor page");
  assert.ok(text.includes("Recorded workflows"), "Not the populated list");
  assert.ok(text.includes("Employer #" + actor.org.id), "Employer ID not bound");
  assert.ok(text.includes("processId=" + actor.process.id), "Own process missing from real list");
  assert.ok(!text.includes("Workflow source unavailable"), "Source outage cannot pass as own success");
  if (selected) {
    assert.ok(text.includes("Step timeline"), "Selected timeline not rendered");
    assert.ok(text.includes("Step 1"), "Real seeded step not visible");
    assert.ok(text.includes("Approval"), "Real step type not visible");
  }
  noForeignProcess(text, subjects.filter(s => s.org.id !== actor.org.id), "own");
}
export function assertDeniedMonitorPage(response, subjects, label) {
  assert.equal(response.status, 404, label + ": hard 404 required");
  assert.ok(!response.text.includes("Business Process Monitor"),
    label + ": private monitor shell mounted on denial");
  assert.ok(!response.text.includes("Recorded workflows"),
    label + ": private workflow list mounted on denial");
  // Never render any linked private workflow on a denied page. The rejected
  // request's own processId query string can appear in Next router metadata.
  assert.doesNotMatch(normalizeSsrText(response.text), /<a\b[^>]*\bhref=["'][^"']*processId=/i,
    label + ": denied response rendered a process link");
  noForeignProcess(response.text, subjects, label, { allowRequestIdReflection: true });
}
