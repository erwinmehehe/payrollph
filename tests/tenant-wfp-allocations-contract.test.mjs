import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  requireDisposablePlanningEnv, assertNoStateChange, assertOwnedPlanningRead,
  assertOwnAllocationCreated, assertOwnManagerDraftCreated,
} from "../scripts/qa/tenant-wfp-allocations-contract.mjs";

const env = {
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  APP_BASE_URL: "https://payroll.example.test",
  DEMO_MODE: "false", WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
};
const employer = {
  marker: "TTBL-ATTA-FAKE", orgId: 11, planId: 21,
  planName: "TTBL-ATTA-FAKE guarded workforce capacity plan",
  ownerId: 31, ownerName: "TTBL-ATTA-FAKE owner",
  newUnitId: 42, newUnitName: "TTBL-ATTA-FAKE separate planning department",
  headcount: 4, budget: 21000, planBudget: 100000,
  notes: "TTBL-ATTA-FAKE allowed fictional allocation",
  requestHeadcount: 2, requestBudget: 6100,
  rationale: "TTBL-ATTA-FAKE capacity request with fictional demand evidence",
};
const at = new Date("2026-10-28T01:00:00.000Z");
const initialAllocation = {
  id: 51, organizationId: 11, planId: 21, orgUnitId: 41,
  headcountCeiling: 2, annualBudgetCeiling: "12000.00",
};
const base = {
  organization: [{ id: 11 }], entities: [{ id: 12 }],
  units: [{ id: 41, name: "TTBL-ATTA-FAKE" }, { id: 42, name: employer.newUnitName }],
  staff: [{ id: 13 }], payProfiles: [{ id: 14 }],
  plans: [{ id: employer.planId }], allocations: [initialAllocation],
  submissions: [], scenarios: [], payroll: [], punches: [], audits: [],
};
const ownRead = {
  status: 200,
  json: { access: { companyWide: true, canManageAllocations: true },
    allocations: [{ ...initialAllocation, orgUnitName: "TTBL-ATTA-FAKE unit" }],
    submissions: [] },
};
function addAllocation() {
  const after = structuredClone(base);
  const allocation = {
    id: 52, organizationId: 11, planId: employer.planId,
    orgUnitId: employer.newUnitId,
    headcountCeiling: employer.headcount,
    annualBudgetCeiling: "21000.00", notes: employer.notes,
    createdByUserId: employer.ownerId,
    updatedByUserId: employer.ownerId,
  };
  after.allocations.push(allocation);
  after.audits.push({ id: 101, organizationId: 11,
    actor: employer.ownerName, action: "Workforce plan allocation saved",
    resource: employer.planName + " · " + employer.newUnitName,
    metadata: { allocationId: 52, planId: 21, orgUnitId: 42,
      headcountCeiling: 4, annualBudgetCeiling: 21000 } });
  return { after, response: { status: 201, json: { allocation } } };
}
function addDraft(before) {
  const after = structuredClone(before);
  const submission = {
    id: 61, organizationId: 11, planId: employer.planId,
    orgUnitId: employer.newUnitId, allocationId: 52,
    requestedHeadcount: employer.requestHeadcount,
    requestedAnnualBudget: "6100.00",
    rationale: employer.rationale, version: 1, status: "draft",
    createdByUserId: employer.ownerId,
    allocationSnapshot: {
      allocationId: 52, orgUnitId: employer.newUnitId,
      headcountCeiling: employer.headcount,
      annualBudgetCeiling: employer.budget, planBudget: employer.planBudget,
      allocationUpdatedAt: at.toISOString(),
    },
  };
  after.submissions.push(submission);
  after.audits.push({ id: 102, organizationId: 11, actor: employer.ownerName,
    action: "Workforce manager request drafted",
    resource: employer.planName + " · org unit #42 · v1",
    metadata: { submissionId: 61, allocationId: 52, planId: 21,
      orgUnitId: 42, requestedHeadcount: 2, requestedAnnualBudget: 6100 } });
  return { after, response: { status: 201, json: { submission } } };
}
test("preflight refuses non-disposable DB/server, production providers and unsafe flag values", () => {
  assert.doesNotThrow(() => requireDisposablePlanningEnv(env));
  for (const [key, value] of Object.entries(env)) {
    const wrong = value === "false" ? "true" : "false";
    assert.throws(() => requireDisposablePlanningEnv({ ...env, [key]: wrong }),
      /WFP_ALLOCATION_REFUSED/, "flipped " + key);
    assert.throws(() => requireDisposablePlanningEnv({ ...env, [key]: undefined }),
      /WFP_ALLOCATION_REFUSED/, "missing " + key);
  }
  for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
    "RESEND_API_KEY", "STRIPE_SECRET_KEY", "SMTP_PASSWORD"]) {
    assert.throws(() => requireDisposablePlanningEnv({ ...env, [key]: "live-credential" }),
      /WFP_ALLOCATION_REFUSED/, key);
  }
  assert.throws(() => requireDisposablePlanningEnv({
    ...env, HCM_ENTERPRISE_PLAN_GATE_ENABLED: "true",
  }), /WFP_ALLOCATION_REFUSED/);
});

test("populated own GET rejects empty rows and another company's real allocation", () => {
  assert.doesNotThrow(() => assertOwnedPlanningRead(ownRead, employer, base));
  assert.throws(() => assertOwnedPlanningRead(ownRead, { ...employer, orgId: 999 }, base));
  assert.throws(() => assertOwnedPlanningRead(ownRead, { ...employer, planId: 999 }, base));
  assert.throws(() => assertOwnedPlanningRead(
    { ...ownRead, json: { ...ownRead.json, allocations: [] } }, employer, base));
  assert.throws(() => assertOwnedPlanningRead({
    ...ownRead, json: { ...ownRead.json,
      allocations: [{ ...initialAllocation, organizationId: 999, orgUnitName: "FOREIGN" }] },
  }, employer, base));
});

test("POST allocation proof requires a real stored row, correct owner and exact audit", () => {
  const { after, response } = addAllocation();
  assert.equal(assertOwnAllocationCreated(base, after, employer, response), 52);
  assert.throws(() => assertOwnAllocationCreated(base, base, employer, response),
    "a false successful response without an insert must not count");
  const changedActor = structuredClone(after);
  changedActor.allocations[1].createdByUserId = 999;
  assert.throws(() => assertOwnAllocationCreated(base, changedActor, employer, response));
  const changedAudit = structuredClone(after);
  changedAudit.audits = [];
  assert.throws(() => assertOwnAllocationCreated(base, changedAudit, employer, response));
  const changedPayroll = structuredClone(after);
  changedPayroll.payroll.push({ id: 500 });
  assert.throws(() => assertOwnAllocationCreated(base, changedPayroll, employer, response));
});

test("POST manager draft proof requires persisted allocation and real actor-bound audit", () => {
  const savedAllocation = addAllocation().after;
  const { after, response } = addDraft(savedAllocation);
  assert.equal(assertOwnManagerDraftCreated(
    savedAllocation, after, employer, 52, response), 61);
  assert.throws(() => assertOwnManagerDraftCreated(
    savedAllocation, savedAllocation, employer, 52, response));
  const changedActor = structuredClone(after);
  changedActor.submissions[0].createdByUserId = 999;
  assert.throws(() => assertOwnManagerDraftCreated(
    savedAllocation, changedActor, employer, 52, response));
  const wrongLinkedAllocation = structuredClone(after);
  wrongLinkedAllocation.submissions[0].allocationSnapshot.allocationId = 999;
  assert.throws(() => assertOwnManagerDraftCreated(
    savedAllocation, wrongLinkedAllocation, employer, 52, response));
  const badAudit = structuredClone(after);
  badAudit.audits.at(-1).metadata.allocationId = 999;
  assert.throws(() => assertOwnManagerDraftCreated(
    savedAllocation, badAudit, employer, 52, response));
});

test("negative requests cannot mutate protected tenant/business state", () => {
  assert.doesNotThrow(() => assertNoStateChange(base, structuredClone(base), "foreign"));
  const changed = structuredClone(base);
  changed.units[0].name = "VICTIM";
  assert.throws(() => assertNoStateChange(base, changed, "foreign"));
});

test("source and coverage contract leave method GAP without shared catalog changes", () => {
  const route = readFileSync("src/app/api/workforce-planning/allocations/route.ts", "utf8");
  const script = readFileSync("scripts/qa/tenant-wfp-allocations-http.mjs", "utf8");
  assert.match(route, /export async function POST/);
  assert.match(route, /if \(entityType === "allocation"\)/);
  assert.match(route, /if \(entityType === "submission"\)/);
  assert.match(route, /eq\(workforcePlans\.organizationId, organizationId\)/);
  assert.match(route, /eq\(orgUnits\.organizationId, organizationId\)/);
  assert.match(route, /eq\(workforcePlanAllocations\.organizationId, organizationId\)/);
  assert.ok(script.indexOf("requireDisposablePlanningEnv();") <
    script.indexOf('import("../../src/db/index.ts")'),
    "fail closed before application imports");
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const method = Object.values(manifest.allApiRouteFiles)
    .find(entry => entry.route === "workforce-planning/allocations")
    ?.methods.find(entry => entry.name === "POST");
  assert.equal(method?.status, "GAP", "evidence is provisional and must not credit the method");
  assert.match(script, /newCredits: 0/);
});


test("manager-decision PATCH retains tenant predicates through locked reads and both writes", () => {
  const route = readFileSync("src/app/api/workforce-planning/allocations/route.ts", "utf8");
  const post = route.slice(route.indexOf("export async function POST"),
    route.indexOf("export async function PATCH"));
  const patch = route.slice(route.indexOf("export async function PATCH"));
  assert.match(post, /eq\(workforcePlanManagerSubmissions\.organizationId, organizationId\)/,
    "manager-draft version lookup cannot cross employers");
  assert.match(post, /eq\(workforcePlanAllocations\.organizationId, organizationId\)/,
    "manager draft must lock the own-employer allocation");
  assert.match(patch, /eq\(workforcePlanAllocations\.organizationId, submission\.organizationId\)/,
    "linked allocation lookup must remain in the manager request's employer");
  assert.match(patch, /eq\(workforcePlans\.organizationId, submission\.organizationId\)/,
    "linked workforce plan lookup must be employer-scoped");
  assert.ok((patch.match(/eq\(workforcePlanManagerSubmissions\.organizationId, submission\.organizationId\)/g) ?? []).length >= 4,
    "both decisions, submission and accepted-request supersede must be employer-scoped");
  assert.match(patch, /eq\(workforcePlanManagerSubmissions\.allocationId, submission\.allocationId\)/,
    "manager decisions must retain the authorized allocation relationship");
  assert.match(patch, /\)\)\.for\("update"\)\.limit\(1\)/,
    "decision/creation locks must be held while scoped rows are checked");
  const runner = readFileSync("scripts/qa/tenant-wfp-allocations-http.mjs", "utf8");
  assert.match(runner, /for \(const actor of \[a, b\]\)/);
  assert.match(runner, /patch\(actor, victim\.draftId, action, \{ orgId: actor\.orgId \}\)/,
    "the real foreign request must reject a forged own-tenant selector");
  assert.match(runner, /assertNoStateChange\(expected\.get\(e\.orgId\), await snapshot\(e\.orgId\)/,
    "real PostgreSQL snapshots must remain unchanged following denials");
  assert.match(runner, /assertDecisionTransition\(beforeSubmit, afterSubmit/);
  assert.match(runner, /assertDecisionTransition\(beforeDecide, afterDecide/);
  assert.match(runner, /independentCheckerRoles: true/);
  assert.match(runner, /newCredits: 0/);
});
