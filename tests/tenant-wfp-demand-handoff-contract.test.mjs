import test from "node:test";
import { verifyPost1523Credits } from "../scripts/qa/tenant-post1523-credit-verify.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HANDOFF_PATH, HANDOFF_DATE, MANUAL_DATE,
  requireDisposableHandoffEnv, assertDeniedHandoff,
  assertImmutableHandoffState, assertOwnedHandoffWrite,
} from "../scripts/qa/tenant-wfp-demand-handoff-contract.mjs";

const safe = {
  CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  APP_BASE_URL: "https://payroll.example.test",
  DEMO_MODE: "false", WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", REQUIRE_PRIVILEGED_MFA: "true",
  TENANT_TABLE_PROFILE: "default",
};
const actor = {
  marker: "TEST-ATTA", orgId: 10, ownerId: 20, ownerName: "TEST-ATTA owner",
  planId: 30, planName: "TEST-ATTA approved plan", jobId: 40,
  jobTitle: "TEST-ATTA role", siteId: 50, siteName: "TEST-ATTA site",
  shiftId: 60, shiftCode: "TEST-ATTA-SHIFT", positionIds: [70, 71],
};
const row = {
  id: 81, organizationId: actor.orgId, worksiteId: actor.siteId,
  jobProfileId: actor.jobId, shiftDefinitionId: actor.shiftId,
  sourcePlanId: actor.planId, workDate: HANDOFF_DATE,
  requiredHeadcount: 1, sourceType: "hcm_plan",
  sourcePositionIds: actor.positionIds,
  sourceHandoffKey: ["plan", actor.planId, "site", actor.siteId, "shift",
    actor.shiftId, "role", actor.jobId, "date", HANDOFF_DATE].join(":"),
  notes: "Authorized by workforce plan " + actor.planName,
  createdByUserId: actor.ownerId, createdBy: actor.ownerName,
};
const audit = {
  organizationId: actor.orgId, actor: actor.ownerName,
  action: "HCM workforce plan handed to WFM demand",
  resource: [actor.planName, actor.jobTitle, actor.siteName, actor.shiftCode].join(" · "),
  metadata: { planId: actor.planId, jobProfileId: actor.jobId,
    worksiteId: actor.siteId, shiftDefinitionId: actor.shiftId,
    requiredHeadcount: 1, positionIds: actor.positionIds, requirementIds: [row.id] },
};
const base = { staffingRequirements: [], auditEvents: [],
  positions: [{ id: 70, organizationId: 10 }],
  payrollRuns: [], timePunches: [], outbox: [] };
const receipt = {
  status: 201,
  json: {
    plan: { id: actor.planId, name: actor.planName },
    role: { jobProfileId: actor.jobId, title: actor.jobTitle,
      authorizedHeadcount: 2, positionIds: actor.positionIds },
    requirements: [{ ...row, handoffAction: "created" }],
  },
  text: JSON.stringify({ plan: { name: actor.planName }, requirements: [row] }),
};
const owned = () => ({ before: structuredClone(base),
  after: { ...structuredClone(base), staffingRequirements: [structuredClone(row)],
    auditEvents: [structuredClone(audit)] }, actor, response: structuredClone(receipt),
  action: "created", headcount: 1, foreignMarkers: ["TEST-VICTIM"] });

test("default disposable environment refuses network, production, money and missing MFA", () => {
  assert.doesNotThrow(() => requireDisposableHandoffEnv(safe));
  const bad = [
    { DATABASE_URL: "postgresql://postgres:postgres@production.example.com:5432/app_db" },
    { SECURITY_SMOKE_URL: "https://payroll.example.test" },
    { APP_BASE_URL: "https://prod.example.com" },
    { CI: "false" }, { GITHUB_ACTIONS: "false" }, { WORKER_ENABLED: "true" },
    { XENDIT_BILLING_ENABLED: "true" }, { PAYMONGO_DISBURSEMENTS_ENABLED: "true" },
    { HCM_ENTERPRISE_PLAN_GATE_ENABLED: "true" },
    { REQUIRE_PRIVILEGED_MFA: "false" },
    { PAYMONGO_SECRET_KEY: "live-key" }, { RESEND_API_KEY: "live-key" },
  ];
  for (const values of bad) assert.throws(() => requireDisposableHandoffEnv({ ...safe, ...values }),
    "Must refuse dangerous synthetic environment: " + JSON.stringify(values));
});

test("denial status and victim privacy must be real, not inferred from empty response", () => {
  assert.doesNotThrow(() => assertDeniedHandoff({ status: 403, text: "Forbidden" },
    403, ["TEST-VICTIM"], "foreign"));
  assert.throws(() => assertDeniedHandoff({ status: 200, text: "ok" },
    403, ["TEST-VICTIM"], "foreign"));
  assert.throws(() => assertDeniedHandoff({ status: 403, text: "TEST-VICTIM private" },
    403, ["TEST-VICTIM"], "foreign"));
  assert.throws(() => assertDeniedHandoff({ status: 403, text: null },
    403, ["TEST-VICTIM"], "foreign"));
});

test("real SQL receipt, actor identity and immutable unrelated state required for created handoff", () => {
  assert.equal(assertOwnedHandoffWrite(owned()), row.id);
  const missing = owned(); missing.after.staffingRequirements = [];
  assert.throws(() => assertOwnedHandoffWrite(missing));
  const wrongTenant = owned(); wrongTenant.after.staffingRequirements[0].organizationId = 999;
  assert.throws(() => assertOwnedHandoffWrite(wrongTenant));
  const wrongPlan = owned(); wrongPlan.after.staffingRequirements[0].sourcePlanId = 999;
  assert.throws(() => assertOwnedHandoffWrite(wrongPlan));
  const wrongSite = owned(); wrongSite.after.staffingRequirements[0].worksiteId = 999;
  assert.throws(() => assertOwnedHandoffWrite(wrongSite));
  const forgedRole = owned(); forgedRole.after.staffingRequirements[0].sourcePositionIds = [999];
  assert.throws(() => assertOwnedHandoffWrite(forgedRole));
  const noAudit = owned(); noAudit.after.auditEvents = [];
  assert.throws(() => assertOwnedHandoffWrite(noAudit));
  const forgedAudit = owned(); forgedAudit.after.auditEvents[0].actor = "attacker";
  assert.throws(() => assertOwnedHandoffWrite(forgedAudit));
  const foreignResource = owned(); foreignResource.after.auditEvents[0].resource =
    "TEST-VICTIM secret job";
  assert.throws(() => assertOwnedHandoffWrite(foreignResource));
  const overlongResource = owned(); overlongResource.actor = {
    ...actor, planName: actor.planName.repeat(20),
  };
  assert.throws(() => assertOwnedHandoffWrite(overlongResource));
  const crossPayroll = owned(); crossPayroll.after.payrollRuns.push({ id: 4 });
  assert.throws(() => assertOwnedHandoffWrite(crossPayroll));
  const foreignText = owned(); foreignText.response.text += " TEST-VICTIM";
  assert.throws(() => assertOwnedHandoffWrite(foreignText));
});

test("updated handoff must change same real row, not manufacture a second row or mutate old audit", () => {
  const input = owned();
  input.action = "updated"; input.headcount = 2;
  input.before.staffingRequirements = [structuredClone(row)];
  input.after.staffingRequirements[0].requiredHeadcount = 2;
  input.after.auditEvents[0].metadata.requiredHeadcount = 2;
  input.response.json.requirements[0].handoffAction = "updated";
  input.response.json.requirements[0].requiredHeadcount = 2;
  assert.equal(assertOwnedHandoffWrite(input), row.id);
  const noChange = structuredClone(input); noChange.before.staffingRequirements[0].requiredHeadcount = 2;
  assert.throws(() => assertOwnedHandoffWrite(noChange));
  const secondRow = structuredClone(input); secondRow.after.staffingRequirements.push({ ...row, id: 999 });
  assert.throws(() => assertOwnedHandoffWrite(secondRow));
});

test("all denied tenant writes must leave real protected rows and audit unchanged", () => {
  assert.doesNotThrow(() => assertImmutableHandoffState(base, structuredClone(base), "denied"));
  const altered = structuredClone(base); altered.auditEvents.push(audit);
  assert.throws(() => assertImmutableHandoffState(base, altered, "denied"));
});

test("source review: actual own create/update and foreign/forged tenant denials use real localhost HTTP", () => {
  const script = readFileSync("scripts/qa/tenant-wfp-demand-handoff-http.mjs", "utf8");
  const route = readFileSync("src/app/api/workforce-planning/demand-handoff/route.ts", "utf8");
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const method = manifest.allApiRouteFiles["src/app/api/workforce-planning/demand-handoff/route.ts"]
    .methods.find(row => row.name === "POST");
  assert.equal(HANDOFF_PATH, "/api/workforce-planning/demand-handoff");
  assert.equal(MANUAL_DATE, "2099-05-22");
  assert.equal(method?.status, "COVERED", "Only the separately reviewed full create/update proof is proposed");
  assert.equal(method?.testedBy?.file, "scripts/qa/tenant-wfp-demand-handoff-http.mjs");
  assert.equal(method?.testedBy?.productionCertified, false);
  assert.match(method?.testedBy?.independentReview, /^PENDING:/);
  assert.equal(verifyPost1523Credits(manifest), 3);
  assert.match(route, /eq\(workforcePlans\.organizationId, organizationId\)/);
  assert.match(route, /eq\(jobProfiles\.organizationId, organizationId\)/);
  assert.match(route, /eq\(worksites\.organizationId, organizationId\)/);
  assert.match(route, /eq\(shiftDefinitions\.organizationId, organizationId\)/);
  assert.match(route, /eq\(positions\.organizationId, organizationId\)/);
  assert.match(route, /eq\(staffingRequirements\.organizationId, organizationId\)/);
  assert.match(script, /requireDisposableHandoffEnv\(\)/);
  assert.ok(script.indexOf("requireDisposableHandoffEnv();") <
    script.indexOf('import("../../src/db/index.ts")'));
  assert.match(script, /for \(const label of \["ATTA", "ATTB", "VICTIM"\]\)/);
  assert.match(script, /for \(const attacker of \[a, b\]\)/);
  assert.match(script, /assert\.ok\(victim\[field\] > attacker\[field\]/);
  assert.match(script, /http\.standaloneRequest\(HANDOFF_PATH, \{ method: "POST"/);
  assert.match(script, /assertDeniedHandoff\(/);
  assert.match(script, /assertImmutableHandoffState\(/);
  assert.match(script, /assertOwnedHandoffWrite\(/);
  assert.match(script, /newCredits: 0/);
  assert.match(script, /synthetic audit resource exceeds the real PostgreSQL column/);
  assert.match(script, /process\.env\.TENANT_TABLE_PROFILE/);
  const workflow = readFileSync(".github/workflows/tenant-wfp-demand-handoff-http.yml", "utf8");
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-wfp-demand-handoff-http\.mjs/);
  assert.match(workflow, /XENDIT_BILLING_ENABLED=false/);
});
