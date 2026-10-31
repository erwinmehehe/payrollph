/**
 * HCM SLA scheduler POST: actual token-gated HTTP and fictional PostgreSQL 16.
 * Global worker authorization is not a tenant session. With the correct
 * worker token, the sweep intentionally processes due cases from all employers,
 * but cases/events/email recipients/dedupe keys must remain employer-scoped.
 *
 * Zero method credits, no production cron, payroll money or provider calls.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";

const APP = "http://127.0.0.1:3000";
function requireDisposable() {
  for (const [key, expected] of [
    ["CI", "true"], ["GITHUB_ACTIONS", "true"],
    ["TENANT_SECOND_PASS_MODE", "isolated-ci-only"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/app_db"],
    ["PAYMONGO_DISBURSEMENTS_ENABLED", "false"],
    ["XENDIT_PAYOUTS_ENABLED", "false"],
    ["WORKER_ENABLED", "false"],
    ["CENTRAL_SCHEDULER_ENABLED", "false"],
  ]) assert.equal(process.env[key], expected, key + " requires disposable CI-only guard");
  assert.ok((process.env.HCM_SLA_CRON_SECRET ?? "").length >= 32,
    "Ephemeral scheduler token must be configured in synthetic CI");
  assert.equal(process.env.OPENAI_API_KEY ?? "", "");
  assert.ok(!process.env.PAYMONGO_SECRET_KEY && !process.env.XENDIT_SECRET_KEY,
    "Never run this candidate with payout provider credentials");
}
requireDisposable();
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
let assertions = 0;
function check(condition, message) { assert.ok(condition, message); assertions++; }
async function one(query, values = []) {
  const result = await client.query(query, values);
  assert.equal(result.rows.length, 1, "Synthetic fixture needs exactly one row");
  return result.rows[0];
}
async function snapshot(table, orgId) {
  // A strict table allowlist prevents accidentally introspecting live-sensitive
  // or unrelated tables if this proof is repurposed.
  assert.ok(["automation_operational_cases", "hcm_work_item_events",
    "outbox", "audit_events", "payroll_runs"].includes(table));
  return (await client.query("SELECT * FROM " + table +
    " WHERE organization_id=$1 ORDER BY id", [orgId])).rows;
}
async function request(headers = {}) {
  const response = await fetch(APP + "/api/hcm/work-items/escalate", {
    method: "POST", headers, cache: "no-store", redirect: "manual",
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}
function expect(response, status, label) {
  assert.equal(response.status, status, label);
  assertions++;
  return response;
}

try {
  await client.connect();
  const { standaloneMakeSession } = await import("./tenant-table-http.mjs");
  const subjects = [];
  for (const tag of ["ATTA", "ATTB", "VICTIM"]) {
    const org = await one(
      "INSERT INTO organizations(name,legal_name) VALUES($1,$2) RETURNING id",
      ["Synthetic SLA " + tag, "Fictional SLA " + tag]);
    const user = await one(
      "INSERT INTO users(name,email,role,password_hash) VALUES($1,$2,'owner','fictional-only') RETURNING id",
      ["Fictional " + tag + " HR owner", "sla-" + tag.toLowerCase() + "@example.invalid"]);
    await client.query(
      "INSERT INTO user_organizations(user_id,organization_id,role,active) VALUES($1,$2,'owner',true)",
      [user.id, org.id]);
    const session = await standaloneMakeSession(user.id);
    const due = await one(
      "INSERT INTO automation_operational_cases(organization_id,case_type,source_type,source_id,owner_team,title,detail,status,sla_due_at,sla_escalate_at) VALUES($1,'coverage_recovery','synthetic_ci_only',$2,'HR Operations',$3,'Fictional worker SLA due','open',now()-interval '3 days',now()-interval '1 hour') RETURNING id,organization_id",
      [org.id, org.id, "SLA-CASE-" + tag]);
    subjects.push({ tag, orgId: org.id, userId: user.id,
      email: "sla-" + tag.toLowerCase() + "@example.invalid",
      caseId: due.id, cookie: session.cookie });
  }
  check(subjects[2].caseId > subjects[0].caseId &&
    subjects[2].orgId > subjects[1].orgId,
    "Victim must be a real higher-ID case and employer");

  const future = await one(
    "INSERT INTO automation_operational_cases(organization_id,case_type,source_type,source_id,owner_team,title,detail,status,sla_due_at,sla_escalate_at) VALUES($1,'coverage_recovery','synthetic_ci_only',$2,'HR Operations','Fictional future case','Not yet due','open',now()+interval '3 days',now()+interval '4 days') RETURNING id",
    [subjects[2].orgId, 9000]);
  const casesBefore = new Map();
  const auditBefore = new Map();
  const payrollBefore = new Map();
  for (const org of subjects) {
    casesBefore.set(org.orgId, await snapshot("automation_operational_cases", org.orgId));
    auditBefore.set(org.orgId, await snapshot("audit_events", org.orgId));
    payrollBefore.set(org.orgId, await snapshot("payroll_runs", org.orgId));
  }

  // This is a real, DB-backed, authenticated tenant cookie, not an invented
  // cookie string. It must never authorize global cross-employer scheduling.
  const account = await fetch(APP + "/api/account", {
    headers: { cookie: subjects[0].cookie }, cache: "no-store",
  });
  check(account.status === 200, "Tenant browser session must be real and active");
  expect(await request({ cookie: subjects[0].cookie }), 401,
    "Authenticated tenant cookie alone cannot trigger global SLA sweep");
  expect(await request({ authorization: "Bearer " + randomBytes(32).toString("hex") }), 401,
    "Forged scheduler bearer token cannot trigger global sweep");
  expect(await request({ authorization: "Bearer " + process.env.HCM_SLA_CRON_SECRET + "x" }), 401,
    "Invalid token length must fail without timing-safe bypass");
  for (const org of subjects) {
    assert.deepEqual(await snapshot("automation_operational_cases", org.orgId),
      casesBefore.get(org.orgId), "Unauthorized requests cannot mutate any employer case");
    assert.deepEqual(await snapshot("audit_events", org.orgId),
      auditBefore.get(org.orgId), "Unauthorized requests cannot mutate any employer audit");
    check((await snapshot("hcm_work_item_events", org.orgId)).length === 0,
      "Unauthorized requests cannot record SLA event");
    check((await snapshot("outbox", org.orgId)).length === 0,
      "Unauthorized requests cannot queue any employer email");
  }

  const valid = expect(await request({
    authorization: "Bearer " + process.env.HCM_SLA_CRON_SECRET,
  }), 200, "A valid scheduler bearer can process due fictional cases");
  check(valid.data?.escalated === 3 && valid.data?.remainingMayExist === false,
    "Exactly one due case per employer should be escalated");

  for (const org of subjects) {
    const cases = await snapshot("automation_operational_cases", org.orgId);
    const due = cases.find(row => row.id === org.caseId);
    check(due?.escalation_level === 1 && due.escalated_at !== null,
      "Each due case escalates only inside its own employer");
    const events = await snapshot("hcm_work_item_events", org.orgId);
    check(events.length === 1 && events[0].case_id === org.caseId &&
      events[0].organization_id === org.orgId && events[0].event_type === "sla_escalated",
      "Event organization and persisted case must match");
    const emails = await snapshot("outbox", org.orgId);
    check(emails.length === 1 && emails[0].organization_id === org.orgId &&
      emails[0].recipient === org.email && emails[0].purpose === "hcm_sla_escalation",
      "The employer's notice must go only to its own company-wide HR recipient");
    check(emails[0].dedupe_key.startsWith("hcm-sla:" + org.orgId + ":" + org.caseId + ":"),
      "Notification dedupe must carry employer and case identity");
    check(!emails[0].body.includes("SLA-CASE-VICTIM") &&
      !emails[0].body.includes("Fictional worker"),
      "Notification must omit private case title and worker details");
    assert.deepEqual(await snapshot("audit_events", org.orgId), auditBefore.get(org.orgId),
      "SLA worker must not rewrite immutable employer audit history");
    assert.deepEqual(await snapshot("payroll_runs", org.orgId), payrollBefore.get(org.orgId),
      "SLA worker must not touch payroll");
  }

  const victimCases = await snapshot("automation_operational_cases", subjects[2].orgId);
  check(victimCases.some(row => row.id === future.id &&
    row.escalated_at === null && row.escalation_level === 0),
    "Not-yet-due victim case must remain untouched");
  const second = expect(await request({
    authorization: "Bearer " + process.env.HCM_SLA_CRON_SECRET,
  }), 200, "Repeated valid scheduler request must be idempotent");
  check(second.data?.escalated === 0, "Second run cannot repeat escalation");
  for (const org of subjects) {
    check((await snapshot("hcm_work_item_events", org.orgId)).length === 1,
      "Repeated call must not add duplicate events");
    check((await snapshot("outbox", org.orgId)).length === 1,
      "Repeated call must not queue duplicate notifications");
  }
  console.log(JSON.stringify({
    kind: "hcm-sla-global-worker-tenant-boundary-PG16",
    authenticatedTenantCookieDenied: true, forgedTokenDenied: true,
    syntheticEmployers: 3, ownDueCasesProcessed: 3, foreignEmailsObserved: 0,
    repeatedRunEscalations: 0, payrollMutations: 0,
    methodCredits: 0, independentSecurityAcceptance: false,
    assertions,
  }));
} finally {
  await client.end().catch(() => {});
}
