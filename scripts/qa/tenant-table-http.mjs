/**
 * TABLE-DRIVEN TENANT ISOLATION PROOF for employer-scoped methods whose only employer selector is
 * `organizationId`. One row per method; every row runs for TWO independent attacker employers:
 *   1. own employer request succeeds AND the row's `prove` shows the body is that employer's data;
 *   2. the same session naming the real victim employer is denied with the exact status;
 *   3. no victim marker appears in either response, and victim rows are unchanged afterwards.
 * Fixture-only, fictional PostgreSQL rows on the disposable 127.0.0.1 app_db; production-mode
 * localhost HTTP. No provider, payout, filing or production system is contacted.
 *
 * Standalone: TENANT_SECOND_PASS_MODE=isolated-ci-only CI=true node --import tsx scripts/qa/tenant-table-http.mjs
 * Discovery (never credits anything): add TENANT_TABLE_DISCOVER=1 to print what each route returns.
 * Profiles: TENANT_TABLE_PROFILE=default|multi-entity selects rows whose server flags are compatible.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "../../src/db";
import {
  apiKeys, applicantPrivacyEvidence, approvalChainPolicies, approvalDelegations, attendanceCorrectionRequests, auditEvents, dataRequests, disciplinaryCases, dynamicWorkerGroups,
  earnedWageRequests, employeeLoans, employeePayoutChangeRequests, jobApplicants, jobRequisitions, shiftDefinitions, timePunches,
  hcmEmploymentTermDecisions, hcmEmploymentTerms, leaveConversions, workerEffectiveChanges, biometricDevices, employeePayProfiles, employees, engagementSurveys,
  hcmBusinessProcessDefinitions, hcmLifecyclePolicies, hcmLifecyclePolicyEvents, hcmSkills, importBatches,
  integrationConnectors, invoices, laborInspectionDrills, leaveRequests, legalEntities, organizations, orgUnits, outbox,
  performanceCycles, scheduleSwapRequests, sessions, userLegalEntityGrants, userOrganizations, users, workforcePlanAllocations,
  workforcePlanBaselines, workforcePlanPositionExecutions, workforcePlanningScenarios, workforcePlans,
  workforceScheduleGuardrailPolicies, worksites,
} from "../../src/db/schema";
import { essIdentifierRequests } from "../../src/lib/ess-profile-schema";
import { organizationModuleSettings } from "../../src/lib/tenant-module-storage";

const hex64 = () => randomBytes(32).toString("hex");
/** A further fictional worker of the same employer (own marker plus suffix). */
async function addWorker(e, suffix, { payProfile = true } = {}) {
  const [worker] = await db.insert(employees).values({ organizationId: e.org.id, legalEntityId: e.entity.id, orgUnitId: e.unit.id,
    employeeNo: e.marker + "-" + suffix, firstName: "Table", lastName: e.marker + "-" + suffix, title: "Fictional", avatarInitials: "TT",
    basicRate: "20000.00", startDate: "2026-01-05" }).returning();
  if (payProfile) {
    await db.insert(employeePayProfiles).values({ organizationId: e.org.id, employeeId: worker.id, payBasis: "monthly",
      rateAmount: "20000.00", standardWorkDaysPerMonth: "22", standardHoursPerDay: "8" });
  }
  return worker;
}
const activeWorkers = async (orgId) => Number((await db.select({ n: count() }).from(employees)
  .where(and(eq(employees.organizationId, orgId), eq(employees.status, "Active"))))[0].n);
const auditCount = async (orgId) => Number((await db.select({ n: count() }).from(auditEvents)
  .where(eq(auditEvents.organizationId, orgId)))[0].n);
/** Multi-entity scopes a non-group role to its granted legal employer: grant the owner its own one. */
const grantOwnEntity = (e) => db.insert(userLegalEntityGrants)
  .values({ organizationId: e.org.id, userId: e.owner.id, legalEntityId: e.entity.id }).onConflictDoNothing();
async function seedPlan(e, purpose) {
  const [plan] = await db.insert(workforcePlans).values({ organizationId: e.org.id, name: e.marker + " " + purpose,
    startDate: "2026-01-01", endDate: "2026-12-31" }).returning();
  return plan;
}

/** Body checks shared by rows: each proves the response belongs to the legitimate employer. */
const proofs = {
  echoesOrganization: (field = "organizationId") => (r, c) =>
    assert.equal(Number(field.split(".").reduce((v, k) => v?.[k], r.json)), c.org.id, field + " must identify the legitimate employer"),
  listsOwnRow: (listPath, rowField, ctxField) => (r, c) => {
    const rows = listPath.split(".").reduce((v, k) => v?.[k], r.json);
    assert.ok(Array.isArray(rows), listPath + " must be a real list");
    assert.ok(rows.some((row) => Number(row?.[rowField]) === Number(c[ctxField])), listPath + " must contain the seeded own " + ctxField);
  },
  /** `path.to.list` holds a row whose `field` carries this employer's seeded marker. */
  listsOwnMarker: (listPath, field) => (r, c) => {
    const rows = listPath.split(".").reduce((v, k) => v?.[k], r.json);
    assert.ok(Array.isArray(rows) && rows.length > 0, listPath + " must be a populated list");
    assert.ok(rows.some((row) => String(row?.[field] ?? "").includes(c.marker)), listPath + "[]." + field + " must carry the own employer marker");
  },
  /** `listPath[]` rows hold, at the dotted `fieldPath`, a value carrying this employer's marker. */
  listsOwnMarkerAt: (listPath, fieldPath) => (r, c) => {
    const rows = listPath.split(".").reduce((v, k) => v?.[k], r.json);
    assert.ok(Array.isArray(rows) && rows.length > 0, listPath + " must be a populated list");
    assert.ok(rows.some((row) => String(fieldPath.split(".").reduce((v, k) => v?.[k], row) ?? "").includes(c.marker)),
      listPath + "[]." + fieldPath + " must carry the own employer marker");
  },
  /** The value at `path` carries this employer's seeded marker. */
  valueHasOwnMarker: (path) => (r, c) =>
    assert.ok(String(path.split(".").reduce((v, k) => v?.[k], r.json) ?? "").includes(c.marker), path + " must carry the own employer marker"),
  isObjectWithKeys: (...keys) => (r) => {
    assert.ok(r.json && typeof r.json === "object", "a JSON object is required");
    for (const key of keys) assert.ok(key in r.json, "response must carry " + key);
  },
  all: (...checks) => async (r, c) => { for (const check of checks) await check(r, c); },
  /** The value at `path` is this employer's own fixture id (`ctxField`, e.g. entityId). */
  echoesOwn: (path, ctxField) => (r, c) =>
    assert.equal(Number(path.split(".").reduce((v, k) => v?.[k], r.json)), c[ctxField], path + " must be the own " + ctxField),
  /** The value at `path` equals what this employer's row seed stored (distinct per employer). */
  equalsOwnSeed: (path) => (r, c) =>
    assert.deepEqual(path.split(".").reduce((v, k) => v?.[k], r.json), c.seeded, path + " must equal the own employer's seeded value"),
};
export { proofs };

/**
 * Rows. `key` is exactly "<METHOD> <manifest route>". `flags` are server env flags that must be
 * "true" in the job running this row. `prove(response, ctx)` must show own-employer data.
 * A row without `prove` is discovery-only and can never be credited.
 */
export const TENANT_TABLE = Object.freeze([
  { key: "GET benefits/hmo", prove: proofs.listsOwnMarker("employees", "name") },
  { key: "GET benefits", prove: proofs.listsOwnMarker("employees", "name") },
  { key: "GET billing", flags: ["XENDIT_BILLING_ENABLED"],
    prove: proofs.all(proofs.echoesOrganization("organization.id"), proofs.valueHasOwnMarker("organization.legalName")) },
  { key: "GET compliance/remittance-actions",
    prove: proofs.all(proofs.echoesOrganization(), proofs.listsOwnMarker("assignees", "name")) },
  { key: "GET hcm/lifecycle-readiness",
    prove: proofs.all(proofs.echoesOrganization(), proofs.listsOwnMarker("rows", "employeeNo")) },
  { key: "GET invitations", prove: proofs.listsOwnMarker("members", "name") },
  { key: "GET it-operations", prove: proofs.listsOwnMarker("employees", "lastName") },
  { key: "GET payroll-overpayment-preview", flags: ["HCM_OVERPAYMENT_PREVIEW_ENABLED"],
    prove: proofs.listsOwnMarker("employees", "employeeNo") },
  { key: "GET payroll/overpayment-preflight", flags: ["PAYROLL_OVERPAYMENT_REVIEW_ENABLED"],
    prove: proofs.listsOwnMarker("employees", "employeeNo") },
  { key: "GET performance/calibration", prove: proofs.listsOwnMarker("employees", "lastName") },
  { key: "GET performance/continuous",
    prove: proofs.all(proofs.echoesOrganization("access.organizationId"), proofs.listsOwnMarker("employees", "lastName")) },
  { key: "GET performance/development-plans", prove: proofs.listsOwnMarker("employees", "lastName") },
  { key: "GET performance",
    prove: proofs.all(proofs.echoesOrganization("access.organizationId"), proofs.listsOwnMarker("employees", "lastName"), proofs.listsOwnMarker("orgUnits", "name")) },
  { key: "GET performance/talent-continuity", prove: proofs.listsOwnMarker("employees", "label") },
  { key: "GET provisioning", prove: proofs.listsOwnMarker("employees", "name") },
  { key: "GET spend", prove: proofs.listsOwnMarker("employees", "lastName") },
  { key: "GET workforce-planning",
    prove: proofs.all(proofs.listsOwnMarker("orgUnits", "name"), proofs.listsOwnMarker("legalEntities", "code")) },
  { key: "GET workforce/labor-costing", prove: proofs.listsOwnMarker("legalEntities", "legalName") },
  { key: "GET workforce/overtime", prove: proofs.listsOwnMarker("managers", "name") },
  // Seeded rows: each employer (victim included) gets its own route-specific fictional row.
  { key: "GET billing/subscription",
    seed: (e) => db.insert(invoices).values({ organizationId: e.org.id, number: e.marker, amountCents: 100 * e.rank }),
    prove: proofs.listsOwnMarker("invoices", "number") },
  { key: "GET biometrics/sync",
    seed: (e) => db.insert(biometricDevices).values({ organizationId: e.org.id, deviceModel: "Fictional K40", serialNumber: e.marker, branchName: e.marker }),
    prove: proofs.listsOwnMarker("devices", "branchName") },
  { key: "GET compliance/audit-chain",
    // A different number of audit events per employer; the chain report must count exactly the own employer's.
    seed: async (e) => {
      for (let i = 0; i < e.rank + 2; i++) {
        await db.insert(auditEvents).values({ organizationId: e.org.id, actor: e.marker, action: "tenant_table.seed", resource: e.marker });
      }
    },
    prove: async (r, c) => {
      const own = await auditCount(c.orgId);
      assert.notEqual(own, await auditCount(c.victim.org.id), "seeded audit counts must differ between employers");
      assert.equal(r.json?.verified, true, "own audit chain must verify");
      assert.equal(r.json.chainedEvents + r.json.pendingSealEvents, own, "the chain report must count the own employer's events");
    } },
  { key: "GET compliance/labor-inspection/drills",
    seed: (e) => db.insert(laborInspectionDrills).values({ organizationId: e.org.id, status: "needs-work", rangeLabel: e.marker,
      evidencePackSha256: hex64(), evidencePackVersion: "fictional-v1", snapshotSha256: hex64(), generatedBy: e.marker }),
    prove: proofs.listsOwnMarker("drills", "rangeLabel") },
  { key: "GET compliance/labor-inspection",
    // A worker without a pay profile yields a high finding naming that worker.
    seed: (e) => addWorker(e, "NOPAY", { payProfile: false }),
    prove: proofs.listsOwnMarker("findings", "employeeNo") },
  { key: "GET compliance/policy-review",
    // A different active headcount per employer; the rest-day control must report the own headcount.
    seed: async (e) => { for (let i = 0; i < e.rank; i++) await addWorker(e, "PR" + i); },
    prove: async (r, c) => {
      const own = await activeWorkers(c.orgId);
      assert.notEqual(own, await activeWorkers(c.victim.org.id), "seeded headcounts must differ between employers");
      const rest = r.json?.findings?.find((finding) => finding.key === "WEEKLY_REST_CONTROL");
      assert.ok(String(rest?.detail ?? "").startsWith(own + " active employee(s)"), "rest-day control must count the own employer's workers");
    } },
  { key: "GET developer",
    seed: (e) => db.insert(apiKeys).values({ organizationId: e.org.id, name: e.marker, prefix: "ttbl", keyHash: hex64() }),
    prove: proofs.listsOwnMarker("apiKeys", "name") },
  { key: "GET employee-identifier-requests",
    seed: (e) => db.insert(essIdentifierRequests).values({ organizationId: e.org.id, employeeId: e.worker.id, kind: "tin",
      proposedEncrypted: "fictional-unencrypted", requestedByUserId: e.owner.id }),
    prove: proofs.listsOwnMarker("requests", "employeeNo") },
  { key: "GET hcm/business-processes/definitions",
    seed: (e) => db.insert(hcmBusinessProcessDefinitions).values({ organizationId: e.org.id, code: e.marker, name: e.marker,
      processType: "change_job", effectiveFrom: "2026-01-01" }),
    prove: proofs.listsOwnMarker("definitions", "name") },
  { key: "GET hcm/engagement-surveys", flags: ["ENGAGEMENT_SURVEY_ENABLED"],
    seed: (e) => db.insert(engagementSurveys).values({ organizationId: e.org.id, question: e.marker }),
    prove: proofs.listsOwnMarker("surveys", "question") },
  { key: "GET hcm/lifecycle-policy",
    seed: async (e) => {
      const [policy] = await db.insert(hcmLifecyclePolicies).values({ organizationId: e.org.id }).returning();
      await db.insert(hcmLifecyclePolicyEvents).values({ organizationId: e.org.id, policyId: policy.id, eventType: "updated",
        actorName: e.marker, toVersion: 1, afterSnapshot: {} });
    },
    prove: proofs.listsOwnMarker("history", "actorName") },
  { key: "GET integration-connectors",
    seed: (e) => db.insert(integrationConnectors).values({ organizationId: e.org.id, provider: "slack", name: e.marker,
      credentialCiphertext: "fictional-not-a-credential", config: { defaultChannelId: "C0TTBL0001", allowedChannelIds: ["C0TTBL0001"] } }),
    prove: proofs.listsOwnMarker("connectors", "name") },
  { key: "GET leave",
    seed: (e) => db.insert(leaveRequests).values({ organizationId: e.org.id, employeeId: e.worker.id, leaveType: "vacation",
      startDate: "2026-03-02", endDate: "2026-03-02", days: "1.0" }),
    prove: proofs.listsOwnMarker("requests", "employeeName") },
  { key: "GET migrations",
    seed: (e) => db.insert(importBatches).values({ organizationId: e.org.id, fileName: e.marker + ".csv", createdBy: e.marker }),
    prove: proofs.listsOwnMarker("batches", "fileName") },
  { key: "GET outbox",
    seed: (e) => db.insert(outbox).values({ organizationId: e.org.id, recipient: e.marker.toLowerCase() + "@example.invalid",
      subject: e.marker, body: "Fictional tenant-table message; never delivered.", purpose: "tenant-table" }),
    prove: proofs.listsOwnMarker("messages", "subject") },
  { key: "GET performance/competencies",
    seed: (e) => db.insert(hcmSkills).values({ organizationId: e.org.id, code: e.marker, name: e.marker }),
    prove: proofs.listsOwnMarker("skills", "name") },
  { key: "GET performance/follow-through-governance",
    seed: (e) => db.insert(performanceCycles).values({ organizationId: e.org.id, name: e.marker, startDate: "2026-01-01", endDate: "2026-06-30" }),
    prove: proofs.listsOwnMarker("cycles", "name") },
  { key: "GET tenant-modules", flags: ["CORE_MODULE_NAVIGATION_ENABLED"],
    // Navigation preference only (mode stays "all"); a distinct module list per employer.
    seed: async (e) => {
      const modules = { ATTA: ["workforce"], ATTB: ["workforce", "planning"], VICTIM: ["spend", "it", "automation", "enterprise"] }[e.label];
      await db.update(organizationModuleSettings).set({ enabledModules: modules }).where(eq(organizationModuleSettings.id, e.org.id));
      return modules;
    },
    prove: proofs.equalsOwnSeed("enabledModules") },
  { key: "GET workforce-planning/allocations",
    seed: async (e) => {
      const plan = await seedPlan(e, "allocation plan");
      await db.insert(workforcePlanAllocations).values({ organizationId: e.org.id, planId: plan.id, orgUnitId: e.unit.id });
    },
    prove: proofs.listsOwnMarker("allocations", "orgUnitName") },
  { key: "GET workforce-planning/position-executions",
    seed: async (e) => {
      const plan = await seedPlan(e, "execution plan");
      const [scenario] = await db.insert(workforcePlanningScenarios).values({ organizationId: e.org.id, planId: plan.id, name: e.marker + " exec",
        startDate: "2026-01-01", endDate: "2026-12-31", snapshotHash: hex64(), createdByUserId: e.owner.id }).returning();
      const [baseline] = await db.insert(workforcePlanBaselines).values({ organizationId: e.org.id, planId: plan.id, scenarioId: scenario.id,
        snapshotHash: hex64(), publishedByUserId: e.owner.id, publishedBy: e.marker }).returning();
      await db.insert(workforcePlanPositionExecutions).values({ organizationId: e.org.id, planId: plan.id, baselineId: baseline.id,
        baselineSnapshotHash: baseline.snapshotHash, executionHash: hex64(), createdByUserId: e.owner.id, createdBy: e.marker });
    },
    prove: proofs.listsOwnMarker("executions", "createdBy") },
  { key: "GET workforce-planning/scenarios",
    seed: (e) => db.insert(workforcePlanningScenarios).values({ organizationId: e.org.id, name: e.marker, startDate: "2026-01-01",
      endDate: "2026-12-31", snapshotHash: hex64(), createdByUserId: e.owner.id }),
    prove: proofs.listsOwnMarker("scenarios", "name") },
  { key: "GET workforce/schedule-guardrails",
    // A distinct configured rest minimum per employer.
    seed: async (e) => {
      const minimumRestMinutes = 600 + 10 * e.rank;
      await db.insert(workforceScheduleGuardrailPolicies).values({ organizationId: e.org.id, minimumRestMinutes, updatedBy: e.marker });
      return minimumRestMinutes;
    },
    prove: proofs.equalsOwnSeed("policy.minimumRestMinutes") },
  { key: "GET workforce/schedule-swaps",
    seed: async (e) => {
      const counterparty = await addWorker(e, "SWAP");
      await db.insert(scheduleSwapRequests).values({ organizationId: e.org.id, requesterEmployeeId: e.worker.id,
        counterpartyEmployeeId: counterparty.id, requesterWorkDate: "2026-03-03", counterpartyWorkDate: "2026-03-04",
        requesterScheduleSnapshot: {}, counterpartyScheduleSnapshot: {}, reason: e.marker, requestedBy: e.marker, requestedByUserId: e.owner.id });
    },
    prove: proofs.listsOwnMarker("swaps", "reason") },
  { key: "GET workforce/worksites",
    seed: (e) => db.insert(worksites).values({ organizationId: e.org.id, code: e.marker, name: e.marker }),
    prove: proofs.listsOwnMarker("worksites", "name") },
  // Group B: GETs with extra query parameters. Optional filters stay off unless the row sets `query`.
  { key: "GET automation-studio", prove: proofs.listsOwnMarker("orgUnits", "name") },
  { key: "GET compliance/contribution-issues", prove: proofs.valueHasOwnMarker("legalEntity.code") },
  { key: "GET hcm/people-operations-inbox", prove: proofs.listsOwnMarker("rows", "employeeNo") },
  { key: "GET hcm/work-items", prove: proofs.listsOwnMarker("owners", "name") },
  { key: "GET treasury-controls", prove: proofs.listsOwnMarker("candidates", "name") },
  { key: "GET compliance/data-requests",
    seed: (e) => db.insert(dataRequests).values({ organizationId: e.org.id, subjectEmail: e.marker + "@example.invalid",
      requestType: "access", dueAt: new Date(Date.now() + 30 * 86_400_000) }),
    prove: proofs.listsOwnMarker("requests", "subjectEmail") },
  { key: "GET delegations",
    seed: (e) => db.insert(approvalDelegations).values({ organizationId: e.org.id, fromApprover: e.marker, toApprover: e.marker + "-TO",
      startsOn: "2026-01-01", endsOn: "2026-12-31" }),
    prove: proofs.listsOwnMarker("delegations", "fromApprover") },
  { key: "GET discipline",
    seed: (e) => db.insert(disciplinaryCases).values({ organizationId: e.org.id, employeeId: e.worker.id, caseNumber: e.marker,
      offense: e.marker, incidentDate: "2026-02-02" }),
    prove: proofs.listsOwnMarker("cases", "caseNumber") },
  { key: "GET dynamic-worker-groups",
    seed: (e) => db.insert(dynamicWorkerGroups).values({ organizationId: e.org.id, code: e.marker, name: e.marker }),
    prove: proofs.listsOwnMarker("groups", "name") },
  { key: "GET earned-wage", query: (c) => "employeeId=" + c.workerId,
    seed: (e) => db.insert(earnedWageRequests).values({ organizationId: e.org.id, employeeId: e.worker.id, requestedAmount: "100.00" }),
    prove: proofs.all(proofs.listsOwnRow("requests", "employeeId", "workerId"), proofs.echoesOwn("eligibility.employeeId", "workerId")) },
  { key: "GET hcm/capabilities",
    seed: (e) => db.insert(hcmSkills).values({ organizationId: e.org.id, code: e.marker + "-CAP", name: e.marker }),
    prove: proofs.listsOwnMarker("skills", "name") },
  { key: "GET hcm/effective-changes",
    seed: async (e) => db.insert(workerEffectiveChanges).values({ organizationId: e.org.id, employeeId: (await addWorker(e, "EFF")).id,
      effectiveDate: "2026-06-01", reason: e.marker, requestedBy: e.marker }),
    prove: proofs.listsOwnMarker("changes", "reason") },
  { key: "GET hcm/employment-terms",
    seed: async (e) => db.insert(hcmEmploymentTerms).values({ organizationId: e.org.id, employeeId: (await addWorker(e, "TRM")).id,
      employmentType: "regular", termKind: "regular", effectiveFrom: "2026-01-05", reason: e.marker, requestedBy: e.marker }),
    prove: proofs.listsOwnMarker("terms", "reason") },
  { key: "GET hcm/employment-term-decisions",
    seed: async (e) => {
      const worker = await addWorker(e, "DEC");
      const [term] = await db.insert(hcmEmploymentTerms).values({ organizationId: e.org.id, employeeId: worker.id,
        employmentType: "probationary", termKind: "probationary", effectiveFrom: "2026-01-05", reason: e.marker + " term", requestedBy: e.marker }).returning();
      await db.insert(hcmEmploymentTermDecisions).values({ organizationId: e.org.id, employeeId: worker.id, employmentTermId: term.id,
        decisionKind: "continue_current", effectiveDate: "2026-07-05", reason: e.marker, requestedBy: e.marker });
    },
    prove: proofs.listsOwnMarker("decisions", "reason") },
  { key: "GET leave/conversion",
    seed: (e) => db.insert(leaveConversions).values({ organizationId: e.org.id, employeeId: e.worker.id, leaveType: "vacation",
      daysConverted: "1.0", dailyRate: "900.00", cashAmount: "900.00" }),
    prove: proofs.listsOwnRow("conversions", "employeeId", "workerId") },
  { key: "GET loans",
    seed: (e) => db.insert(employeeLoans).values({ organizationId: e.org.id, employeeId: e.worker.id, loanType: "Fictional loan", referenceNo: e.marker,
      principal: "10000.00", monthlyAmortization: "1000.00", cutoffDeduction: "500.00", remainingBalance: "9000.00" }),
    prove: proofs.listsOwnMarker("loans", "referenceNo") },
  { key: "GET performance/analytics", query: (c) => "cycleId=" + c.seeded.id,
    seed: async (e) => (await db.insert(performanceCycles).values({ organizationId: e.org.id, name: e.marker + " analytics",
      startDate: "2026-01-01", endDate: "2026-12-31", status: "active" }).returning())[0],
    prove: proofs.valueHasOwnMarker("cycle.name") },
  { key: "GET web-bundy",
    seed: (e) => db.insert(timePunches).values({ organizationId: e.org.id, employeeId: e.worker.id,
      workDate: new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10) }),
    prove: proofs.listsOwnMarker("punches", "employeeName") },
  { key: "GET recruitment",
    seed: async (e) => {
      const [requisition] = await db.insert(jobRequisitions).values({ organizationId: e.org.id, title: e.marker, department: e.marker }).returning();
      await db.insert(jobApplicants).values({ requisitionId: requisition.id, organizationId: e.org.id, fullName: e.marker, email: e.marker + "@example.invalid" });
    },
    prove: proofs.all(proofs.listsOwnMarker("requisitions", "title"), proofs.listsOwnMarker("applicants", "fullName")) },
  { key: "GET workforce/attendance-corrections",
    seed: async (e) => {
      const [punch] = await db.insert(timePunches).values({ organizationId: e.org.id, employeeId: e.worker.id, workDate: "2026-03-02" }).returning();
      await db.insert(attendanceCorrectionRequests).values({ organizationId: e.org.id, employeeId: e.worker.id, punchId: punch.id, workDate: "2026-03-02",
        originalPunchSnapshot: {}, proposedPunchSnapshot: {}, reason: e.marker, requestedBy: e.marker });
    },
    prove: proofs.listsOwnMarker("requests", "reason") },
  { key: "GET workforce-planning/baselines",
    seed: async (e) => {
      const plan = await seedPlan(e, "baseline plan");
      const [scenario] = await db.insert(workforcePlanningScenarios).values({ organizationId: e.org.id, planId: plan.id, name: e.marker + " baseline",
        startDate: "2026-01-01", endDate: "2026-12-31", snapshotHash: hex64(), createdByUserId: e.owner.id }).returning();
      await db.insert(workforcePlanBaselines).values({ organizationId: e.org.id, planId: plan.id, scenarioId: scenario.id,
        snapshotHash: hex64(), publishedByUserId: e.owner.id, publishedBy: e.marker });
    },
    prove: proofs.listsOwnMarker("baselines", "publishedBy") },
  { key: "GET workforce/live-floor",
    // A different employee head count per employer: the floor must count exactly the own employer's workers.
    seed: async (e) => { for (let i = 0; i < e.rank; i++) await addWorker(e, "LF" + i); },
    prove: async (r, c) => {
      const own = Number((await db.select({ n: count() }).from(employees).where(eq(employees.organizationId, c.orgId)))[0].n);
      assert.notEqual(own, Number((await db.select({ n: count() }).from(employees).where(eq(employees.organizationId, c.victim.org.id)))[0].n),
        "seeded head counts must differ between employers");
      assert.equal(r.json?.totalEmployees, own, "the live floor must count the own employer's workers");
    } },
  { key: "GET workforce/schedules",
    seed: (e) => db.insert(shiftDefinitions).values({ organizationId: e.org.id, code: e.marker.slice(0, 32), name: e.marker, startTime: "09:00", endTime: "18:00" }),
    prove: proofs.listsOwnMarker("shifts", "name") },
  { key: "GET payout-destination-changes",
    seed: (e) => db.insert(employeePayoutChangeRequests).values({ organizationId: e.org.id, employeeId: e.worker.id, reason: e.marker,
      originalSnapshot: {}, originalStateSha256: hex64(), requestedByUserId: e.owner.id, requestedByName: e.marker }),
    prove: proofs.listsOwnMarker("requests", "reason") },
  { key: "GET workforce/timesheets", query: () => "periodStart=2026-03-01&periodEnd=2026-03-15", prove: proofs.listsOwnMarker("employees", "name") },
  { key: "GET workforce/team-roster", query: () => "startDate=2026-03-02", prove: proofs.listsOwnMarkerAt("rows", "employee.name") },
  { key: "GET workforce/coverage", query: () => "startDate=2026-03-02&endDate=2026-03-08", prove: proofs.listsOwnMarker("employees", "name") },
  { key: "GET compliance/payroll-month-close", query: () => "applicableMonth=2026-03", prove: proofs.valueHasOwnMarker("legalEntity.code") },
  { key: "GET bir/annual-employer", query: (c) => "taxYear=2026&legalEntityId=" + c.entityId,
    prove: proofs.all(proofs.valueHasOwnMarker("employer.code"), proofs.echoesOwn("reconciliation.legalEntityId", "entityId")) },
  { key: "GET hcm/worker-profile", query: (c) => "employeeId=" + c.workerId,
    prove: proofs.all(proofs.valueHasOwnMarker("employee.employeeNo"), proofs.echoesOwn("employee.id", "workerId")) },
  { key: "GET workforce-planning/forecast",
    query: () => "startDate=2026-03-01&endDate=2026-03-31&demandGrowthPercent=0&vacancyFillPercent=100&employerLoadPercent=0&annualAttritionPercent=0&attritionBackfillPercent=100",
    // A different active head count per employer: the forecast must start from exactly the own employer's workers.
    seed: async (e) => { for (let i = 0; i < e.rank; i++) await addWorker(e, "FC" + i); },
    prove: async (r, c) => {
      const own = await activeWorkers(c.orgId);
      assert.notEqual(own, await activeWorkers(c.victim.org.id), "seeded head counts must differ between employers");
      assert.equal(r.json?.forecast?.summary?.activeHeadcount, own, "the forecast must start from the own employer's active workers");
    } },
  // flagged-reads profile: HCM reads that are 404 unless their own release flag is on.
  { key: "GET hcm/my-team", profile: "flagged-reads", flags: ["HCM_MY_TEAM_ENABLED"], prove: proofs.listsOwnMarker("items", "name") },
  { key: "GET hcm/worker-360", profile: "flagged-reads", flags: ["HCM_WORKER_360_ENABLED"], query: (c) => "employeeId=" + c.workerId,
    prove: proofs.all(proofs.valueHasOwnMarker("worker.name"), proofs.echoesOwn("worker.id", "workerId")) },
  { key: "GET recruitment/privacy", profile: "flagged-reads", flags: ["APPLICANT_PRIVACY_CONTROLS_ENABLED"], query: (c) => "applicantId=" + c.seeded.id,
    seed: async (e) => {
      const [requisition] = await db.insert(jobRequisitions).values({ organizationId: e.org.id, title: e.marker + " privacy", department: e.marker }).returning();
      const [applicant] = await db.insert(jobApplicants).values({ requisitionId: requisition.id, organizationId: e.org.id,
        fullName: e.marker + " applicant", email: e.marker + "-privacy@example.invalid" }).returning();
      await db.insert(applicantPrivacyEvidence).values({ organizationId: e.org.id, applicantId: applicant.id, legalBasis: "consent",
        privacyNoticeVersion: "fictional-v1", consentCapturedAt: new Date(), sourceEvidenceReference: e.marker });
      return applicant;
    },
    prove: proofs.all(proofs.valueHasOwnMarker("applicant.fullName"), proofs.echoesOwn("applicant.organizationId", "orgId")) },
  { key: "GET governed-handoffs", query: () => "sourceType=hcm_separation_readiness",
    seed: (e) => db.insert(approvalChainPolicies).values({ organizationId: e.org.id, code: e.marker.slice(0, 64), name: e.marker, purpose: "automation" }),
    prove: proofs.listsOwnMarker("approvalChains", "name") },
  // Multi-entity profile (its own server: the flag changes entity holds elsewhere).
  { key: "GET multi-entity/context", profile: "multi-entity", flags: ["MULTI_ENTITY_ENABLED"], seed: grantOwnEntity,
    prove: proofs.all(proofs.echoesOrganization(), proofs.echoesOwn("legalEntityId", "entityId"), proofs.listsOwnMarker("entities", "legalName")) },
  { key: "GET multi-entity/settings", profile: "multi-entity", flags: ["MULTI_ENTITY_ENABLED"], seed: grantOwnEntity,
    prove: proofs.listsOwnMarker("entities", "legalName") },
  { key: "GET multi-entity/transfers", profile: "multi-entity", flags: ["MULTI_ENTITY_ENABLED"], seed: grantOwnEntity,
    prove: proofs.listsOwnMarker("destinations", "legalName") },
]);

const BASE = process.env.SECURITY_SMOKE_URL ?? "";

export function requireTenantTableDisposable(env = process.env) {
  let app, database;
  try { app = new URL(env.SECURITY_SMOKE_URL ?? ""); database = new URL(env.DATABASE_URL ?? ""); }
  catch { throw new Error("TENANT_TABLE_REFUSED: explicit localhost server and database URLs are required"); }
  if (env.CI !== "true" || env.TENANT_SECOND_PASS_MODE !== "isolated-ci-only" ||
      app.protocol !== "http:" || app.hostname !== "127.0.0.1" ||
      database.hostname !== "127.0.0.1" || database.pathname !== "/app_db" ||
      env.PAYMONGO_DISBURSEMENTS_ENABLED === "true" || env.XENDIT_PAYOUTS_ENABLED === "true") {
    throw new Error("TENANT_TABLE_REFUSED: disposable localhost app_db and server only");
  }
}

async function standaloneRequest(path, { method = "GET", cookie, body } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (method !== "GET") Object.assign(headers, { origin: BASE, "sec-fetch-site": "same-origin" });
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(new URL(path, BASE), {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", cache: "no-store",
  });
  const text = await response.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, text, json, headers: response.headers };
}
function standaloneExpectStatus(response, status, label) {
  assert.equal(response.status, status, label + " got " + response.status + " " + response.text.slice(0, 200));
  return response;
}
async function standaloneMakeSession(userId) {
  const raw = randomBytes(32).toString("hex");
  const [row] = await db.insert(sessions).values({
    userId, tokenHash: createHash("sha256").update(raw).digest("hex"),
    expiresAt: new Date(Date.now() + 3_600_000), lastSeenAt: new Date(),
  }).returning({ id: sessions.id });
  return { id: row.id, cookie: "__Host-linaw_session=" + raw };
}

async function seedEmployer(label, nonce, makeSession) {
  const marker = "TTBL-" + label + "-" + nonce;
  const [org] = await db.insert(organizations).values({ name: marker + " employer", legalName: marker + " Inc." }).returning();
  const [entity] = await db.insert(legalEntities).values({ organizationId: org.id, code: marker.slice(0, 30),
    legalName: marker + " Inc.", displayName: marker, primaryEntity: true }).returning();
  const [unit] = await db.insert(orgUnits).values({ organizationId: org.id, legalEntityId: entity.id, type: "department",
    code: marker.slice(0, 30), name: marker + " department" }).returning();
  const [owner] = await db.insert(users).values({ email: marker.toLowerCase() + "@example.invalid", name: marker + " owner",
    passwordHash: "fictional-session-only", role: "owner", totpEnabled: true }).returning();
  await db.insert(userOrganizations).values({ userId: owner.id, organizationId: org.id, role: "owner", active: true });
  const session = await makeSession(owner.id);
  // Fictional fixture sessions only: a verified MFA timestamp for MFA-gated reads.
  await db.update(sessions).set({ mfaVerifiedAt: new Date() }).where(eq(sessions.id, session.id));
  const [worker] = await db.insert(employees).values({ organizationId: org.id, legalEntityId: entity.id, orgUnitId: unit.id,
    employeeNo: marker, firstName: "Table", lastName: marker, title: "Fictional", avatarInitials: "TT",
    basicRate: "20000.00", startDate: "2026-01-05" }).returning();
  await db.insert(employeePayProfiles).values({ organizationId: org.id, employeeId: worker.id, payBasis: "monthly",
    rateAmount: "20000.00", standardWorkDaysPerMonth: "22", standardHoursPerDay: "8" });
  return { org, entity, unit, owner, cookie: session.cookie, worker, marker, label, rank: { ATTA: 1, ATTB: 2, VICTIM: 4 }[label], seeded: {} };
}

async function victimSnapshot(orgId) {
  const [org, staff, units, entities, audit] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, orgId)),
    db.select().from(employees).where(eq(employees.organizationId, orgId)).orderBy(employees.id),
    db.select().from(orgUnits).where(eq(orgUnits.organizationId, orgId)).orderBy(orgUnits.id),
    db.select().from(legalEntities).where(eq(legalEntities.organizationId, orgId)).orderBy(legalEntities.id),
    db.select({ id: auditEvents.id, action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.organizationId, orgId)).orderBy(auditEvents.id),
  ]);
  return { org, staff, units, entities, audit };
}

export async function verifyTenantTable(_f, { request = standaloneRequest, expectStatus = standaloneExpectStatus, makeSession = standaloneMakeSession } = {}) {
  requireTenantTableDisposable();
  const discover = process.env.TENANT_TABLE_DISCOVER === "1";
  const profile = process.env.TENANT_TABLE_PROFILE ?? "default";
  const rows = (discover && process.env.TENANT_TABLE_DISCOVER_KEYS
    ? process.env.TENANT_TABLE_DISCOVER_KEYS.split(",").map((key) => TENANT_TABLE.find((row) => row.key === key.trim()) ?? { key: key.trim(), profile })
    : TENANT_TABLE).filter((row) => (row.profile ?? "default") === profile);
  assert.ok(rows.length > 0, "tenant table profile " + profile + " has no rows; an empty job proves nothing");
  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  // Attackers first, victim last: every victim ID is larger than any attacker-owned ID, so a
  // response cannot pass by echoing a low or shared identifier.
  const employers = [null];
  for (const label of ["ATTA", "ATTB"]) employers.push(await seedEmployer(label, nonce, makeSession));
  const victim = employers[0] = await seedEmployer("VICTIM", nonce, makeSession);
  for (const field of ["org", "worker", "unit", "entity"]) {
    assert.ok(Number.isSafeInteger(victim[field].id) && victim[field].id > employers[1][field].id && victim[field].id > employers[2][field].id,
      "Victim-only " + field + " ID must really exist and exceed both attackers' IDs");
  }
  // Row seeds run for every employer, victim included, so a leak of the victim's seeded row is
  // detectable and each attacker's own row is what its proof looks for. Distinct per employer.
  // Developer aid only: TENANT_TABLE_TRY=1 reports every failing row instead of stopping at the first,
  // and never prints the credit line, so it cannot be mistaken for a passing proof.
  const tryMode = process.env.TENANT_TABLE_TRY === "1";
  const tryFailures = [];
  const seedFailures = new Map();
  for (const item of rows) {
    if (!item.seed) continue;
    try {
      for (const e of employers) e.seeded[item.key] = (await item.seed(e)) ?? true;
    } catch (error) {
      if (!tryMode) throw error;
      seedFailures.set(item.key, String(error.cause?.message ?? error.message).split("\n")[0].slice(0, 200));
    }
  }
  const victimBefore = await victimSnapshot(victim.org.id);
  const passed = new Set();
  const firstAttackerResponses = new Map();
  let discriminatingProofs = 0;
  const report = [];

  for (const idx of [1, 2]) {
    const own = employers[idx];
    const base = { org: own.org, entity: own.entity, unit: own.unit, worker: own.worker, owner: own.owner, marker: own.marker,
      orgId: own.org.id, workerId: own.worker.id, unitId: own.unit.id, entityId: own.entity.id, rank: own.rank, victim };
    for (const item of rows) {
      const ctx = { ...base, seeded: own.seeded[item.key], victimSeeded: victim.seeded[item.key] };
      const [method, route] = item.key.split(" ");
      assert.equal(method, "GET", item.key + ": the table runner only proves organization-scoped reads so far");
      if (!discover) {
        for (const flag of item.flags ?? []) assert.equal(process.env[flag], "true", item.key + ": server flag " + flag + " must be on in this job");
        assert.equal(typeof item.prove, "function", item.key + ": a row without an own-data proof cannot be credited");
      }
      // Discovery only: TENANT_TABLE_DISCOVER_QUERIES='{"GET route":"a=1&b=2"}' tries a query before a row exists.
      const tried = discover ? JSON.parse(process.env.TENANT_TABLE_DISCOVER_QUERIES ?? "{}")[item.key] : undefined;
      const extra = item.query ? "&" + item.query(ctx) : tried ? "&" + tried.replace(/\{(\w+)\}/g, (_, name) => ctx[name]) : "";
      item.own = "/api/" + route + "?organizationId=" + own.org.id + extra;
      item.foreign = "/api/" + route + "?organizationId=" + victim.org.id + extra;
      if (discover) {
        const o = await request(item.own, { cookie: own.cookie });
        const v = await request(item.foreign, { cookie: own.cookie });
        const hits = [];
        const walk = (v, path) => {
          if (Array.isArray(v)) v.forEach((x, i) => walk(x, path + "[" + i + "]"));
          else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, path + "." + k);
          else if (typeof v === "string" && v.includes(own.marker)) hits.push(path + "~marker");
          else if (typeof v === "number" && path.length < 80 && [own.org.id, own.worker.id, own.unit.id, own.entity.id].includes(v) && /(organization|employee|unit|entity)Id$|\.id$/i.test(path)) hits.push(path + "=" + v);
        };
        walk(o.json, "");
        report.push({ key: item.key, attacker: idx, own: o.status, hits: hits.slice(0, 8), ownKeys: o.json && typeof o.json === "object" ? Object.keys(o.json).slice(0, 12) : null,
          ownSnippet: o.text.slice(0, process.env.TENANT_TABLE_DISCOVER_FULL === "1" ? 20000 : 160), ownHasOwnMarker: o.text.includes(own.marker), foreign: v.status,
          leaksVictimMarker: o.text.includes(victim.marker) || v.text.includes(victim.marker) });
        continue;
      }
      // The cited proof lines below stay at the loop's own indentation on purpose: the manifest pins their exact text.
      try {
      if (seedFailures.has(item.key)) throw new Error("seed failed: " + seedFailures.get(item.key));
      const owned = expectStatus(await request(item.own, { cookie: own.cookie }), item.status ?? 200, item.key + " own employer");
      await item.prove(owned, ctx);
      // The proof must tell employers apart: the first attacker's genuine response fails the second's proof.
      if (idx === 1) firstAttackerResponses.set(item.key, owned);
      else {
        await assert.rejects(async () => item.prove(firstAttackerResponses.get(item.key), ctx), item.key + ": proof accepts another employer's data");
        discriminatingProofs++;
      }
      assert.ok(!owned.text.includes(victim.marker), item.key + ": own response leaked a victim marker");
      const foreign = expectStatus(await request(item.foreign, { cookie: own.cookie }), item.deny ?? 403, item.key + " victim employer");
      assert.ok(!foreign.text.includes(victim.marker), item.key + ": denial leaked a victim marker");
      passed.add(item.key + "#" + idx);
      } catch (error) {
        if (!tryMode) throw error;
        tryFailures.push(item.key + " (attacker " + idx + "): " + String(error.message ?? error).split("\n")[0].slice(0, 230));
      }
    }
  }
  const victimAfter = await victimSnapshot(victim.org.id);
  if (discover) {
    console.log(JSON.stringify({ kind: "tenant-table-discovery", profile, credited: 0, report }, null, 1));
    return { discovered: report.length };
  }
  if (tryMode) {
    const failedKeys = new Set(tryFailures.map((line) => line.split(" (attacker")[0]));
    console.log(JSON.stringify({ kind: "tenant-table-try", profile, credited: 0, rows: rows.length,
      passingRows: rows.filter((row) => !failedKeys.has(row.key)).map((row) => row.key), failures: tryFailures }, null, 1));
    return { tried: rows.length };
  }
  assert.deepEqual(victimAfter, victimBefore, "table reads leave the victim employer's rows and audit trail unchanged");
  assert.equal(passed.size, rows.length * 2, "every row passed for both independent attacker employers");
  assert.equal(discriminatingProofs, rows.length, "every row's proof rejected the other attacker's genuine response");
  await db.delete(sessions).where(inArray(sessions.userId, employers.map((e) => e.owner.id)));
  console.log(JSON.stringify({ kind: "tenant-table-proof", profile, rows: rows.length, ownAndForeignPairs: passed.size,
    discriminatingProofs, victimDatabaseUnchanged: true, productionTested: false, certified: false }));
  return { rows: rows.length, pairs: passed.size };
}

if (process.argv[1] && process.argv[1].replaceAll("\\", "/").endsWith("scripts/qa/tenant-table-http.mjs")) {
  verifyTenantTable(null).then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
}
