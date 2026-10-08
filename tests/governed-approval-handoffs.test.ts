import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  fingerprintGovernedHandoffSource,
  frozenGovernedHandoffEvidence,
  governedHandoffSourceKey,
  isGovernedHandoffType,
  parseGovernedSourceEvidence,
} from "../src/lib/governed-approval-handoffs";

const read = (path: string) => readFileSync(path, "utf8");

const sample = {
  version: "governed-source-handoff-v1",
  sourceType: "wfm_roster_claim_review",
  sourceId: 18,
  sourceHash: fingerprintGovernedHandoffSource({
    claimId: 18, status: "pending", employeeId: 3, shiftDate: "2026-10-09",
  }),
  initiatedByUserId: 7,
  employeeId: 3,
  orgUnitId: 2,
};

test("human handoff source types are strictly enumerated and may never cover money movement", () => {
  assert.equal(isGovernedHandoffType("wfm_roster_claim_review"), true);
  assert.equal(isGovernedHandoffType("hcm_separation_readiness"), true);
  for (const untrusted of ["payroll_release", "clear_payroll_hold", "approve_final_pay", "", null]) {
    assert.equal(isGovernedHandoffType(untrusted), false);
  }
});

test("source key binds id and full SHA256 fingerprint rather than only an unversioned row ID", () => {
  assert.equal(governedHandoffSourceKey(18, sample.sourceHash), `18:${sample.sourceHash}`);
  assert.throws(() => governedHandoffSourceKey(0, sample.sourceHash));
  assert.throws(() => governedHandoffSourceKey(18, "not-a-real-hash"));
  assert.notEqual(
    fingerprintGovernedHandoffSource({ claimId: 18, status: "pending" }),
    fingerprintGovernedHandoffSource({ claimId: 18, status: "approved" }),
  );
});

test("frozen approval evidence is valid only with exact typed source and worker identity", () => {
  assert.deepEqual(parseGovernedSourceEvidence(sample), sample);
  assert.deepEqual(frozenGovernedHandoffEvidence({ sourceEvidence: sample }), sample);
  assert.equal(frozenGovernedHandoffEvidence({}), null);
  assert.equal(parseGovernedSourceEvidence({ ...sample, sourceHash: "forged" }), null);
  assert.equal(parseGovernedSourceEvidence({ ...sample, sourceType: "payroll_release" }), null);
  assert.equal(parseGovernedSourceEvidence({ ...sample, initiatedByUserId: null }), null);
});

test("roster and separation sources reload authoritative tenant-owned employee and source records", () => {
  const lib = read("src/lib/governed-approval-handoffs.ts");
  for (const predicate of [
    "eq(openShiftClaims.organizationId, organizationId)",
    "eq(openShifts.organizationId, organizationId)",
    "eq(employees.organizationId, organizationId)",
    "eq(separationRecords.organizationId, organizationId)",
    'claim.status === "pending"',
    'shift.status === "open"',
    'worker.status === "Active"',
    'separation.status === "draft"',
  ]) assert.ok(lib.includes(predicate), predicate);
  assert.ok(lib.includes("claimUpdatedAt"));
  assert.ok(lib.includes("openShiftUpdatedAt"));
  assert.ok(lib.includes("computationHash"));
  assert.ok(lib.includes("sourceHash !== source.sourceHash"));
  assert.ok(lib.includes("latest.status !== \"approved\""));
});

test("handoff routing requires MFA, active tenant-owned approval policy, org scope and audit evidence", () => {
  const api = read("src/app/api/governed-handoffs/route.ts");
  for (const predicate of [
    "enforceSameOriginMutation(request)",
    "publicDemoMutationDenied",
    "requireSensitiveActionMfa(user)",
    "enforceSensitiveActionRateLimit",
    "WORKFORCE_MANAGER_ROLES",
    "PEOPLE_PAYROLL_ROLES",
    "assertScope(auth.access!, source.orgUnitId)",
    'eq(approvalChainPolicies.purpose, "automation")',
    'eq(approvalChainPolicies.active, true)',
    "createApprovalFromConfiguredChain({",
    "sourceEvidence,",
    "governedHandoffSourceKey(sourceId, source.sourceHash)",
    "recordAuditEvent({",
    "sourceMutation: false",
    "payrollOrRosterMutation: false",
  ]) assert.ok(api.includes(predicate), predicate);
  assert.equal(api.includes("db.update(openShiftClaims)"), false);
  assert.equal(api.includes("db.update(separationRecords)"), false);
  assert.equal(api.includes("db.update(payrollRuns)"), false);
});

test("approval-chain policy/version and source fingerprint are frozen, not retyped from UI", () => {
  const chain = read("src/lib/approval-chains.ts");
  assert.ok(chain.includes("sourceEvidence?: GovernedHandoffEvidence"));
  assert.ok(chain.includes("frozenGovernedHandoffEvidence(existing.routingSnapshot)"));
  assert.ok(chain.includes("existing.policyCode !== policy.code"));
  assert.ok(chain.includes("sourceEvidence: input.sourceEvidence"));
  assert.ok(chain.includes("stepsSnapshot: routedSteps"));
  assert.ok(chain.includes("policyVersion: policy.version"));
});

test("approval inbox denies a review requester's self-approval and stale/out-of-scope source", () => {
  const api = read("src/app/api/approvals/[id]/route.ts");
  assert.ok(api.includes("isGovernedHandoffType(handoff.sourceType)"));
  assert.ok(api.includes("frozenGovernedHandoffEvidence(handoff.routingSnapshot)"));
  assert.ok(api.includes("evidence.initiatedByUserId === sessionUser.id"));
  assert.ok(api.includes("loadGovernedHandoffSource({"));
  assert.ok(api.includes("liveSource.sourceHash !== evidence.sourceHash"));
  assert.ok(api.includes("assertOrganizationUnitAccess("));
  assert.ok(api.includes("Roster or separation source changed after submission"));
  assert.ok(api.includes("const decision = await canDecide("));
  assert.ok(api.includes("await authorizedDynamicGroupMember("));
});

test("source-specific roster approval becomes binding only once a human handoff exists", () => {
  const coverage = read("src/app/api/workforce/coverage/route.ts");
  const lib = read("src/lib/governed-approval-handoffs.ts");
  assert.ok(coverage.includes('if (action === "decide_claim")'));
  assert.ok(coverage.includes("currentRosterApprovalHandoffGate(organizationId, claimId)"));
  assert.ok(coverage.includes("if (!handoffGate.permitted)"));
  assert.ok(lib.includes("if (!latest) return { permitted: true, reason: null, approvalChainId: null }"));
  assert.ok(lib.includes("latest.status !== \"approved\""));
  assert.ok(coverage.includes("employeeSiteEligibility({"));
  assert.ok(coverage.includes("scheduleGuardrailBlocksMutation"));
  assert.ok(coverage.includes("markTimesheetsStaleForEmployeeDate"));
  assert.ok(coverage.includes('if (decision === "rejected")'));
});

test("WFM and Separation UI offer an explicit human review request and show stale status", () => {
  const coverage = read("src/components/workspace/workforce-coverage-panel.tsx");
  const separation = read("src/components/separation-panel.tsx");
  for (const [ui, source] of [
    [coverage, "wfm_roster_claim_review"],
    [separation, "hcm_separation_readiness"],
  ]) {
    assert.ok(ui.includes('fetch("/api/governed-handoffs"'));
    assert.ok(ui.includes(source));
    assert.ok(ui.includes("reviewChainCode"));
    assert.ok(ui.includes("sourceCurrent"));
    assert.ok(ui.includes("stale"));
  }
  assert.ok(separation.includes("Existing clearance and final-pay decisions remain separate."));
  assert.ok(coverage.includes("Request human review"));
  assert.ok(separation.includes("Request human readiness review"));
  assert.equal(separation.includes("approveFinalPayFromReview"), false);
});
