import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  freezeHireApproval,
  hireEvidenceFromDefinition,
  hireReviewFingerprint,
  hashRequisitionPlanHandoff,
  type HireReviewContext,
} from "../src/lib/hcm-hire-business-process";

const example: HireReviewContext = {
  applicantId: 14,
  requisitionId: 9,
  positionId: 7,
  applicantStage: "offer",
  applicantEmail: "worker@example.test",
  offeredMonthly: "50000.00",
  requisitionStatus: "interviewing",
  requisitionPlanHandoffHash: null,
  positionCode: "ENG-1",
  positionStatus: "open",
  positionUpdatedAt: "2026-10-08T03:00:00.000Z",
  positionOrgUnitId: 4,
  positionLegalEntityId: 2,
  positionPlanId: 3,
  positionAnnualBudget: "850000.00",
  profileTitle: "Engineer",
  employeeNo: "EMP-H00014",
  firstName: "Alex",
  middleName: "",
  lastName: "Worker",
  startDate: "2026-10-31",
  region: "NCR",
  nationality: "Filipino",
  mwe: false,
  payBasis: "monthly",
  rateAmount: "50000.00",
  standardWorkDaysPerMonth: "22.00",
  standardHoursPerDay: "8.00",
};

test("hire approvals freeze offer, pay, employee number, identity and position evidence", () => {
  const original = hireReviewFingerprint(example);
  assert.match(original, /^[a-f0-9]{64}$/);
  assert.equal(hireReviewFingerprint({ ...example, applicantEmail: "WORKER@example.test" }), original);
  const variations: Partial<HireReviewContext>[] = [
    { offeredMonthly: "50000.01" },
    { rateAmount: "51000.00" },
    { employeeNo: "EMP-H00099" },
    { firstName: "Other" },
    { startDate: "2026-11-01" },
    { positionId: 10 },
    { positionOrgUnitId: 5 },
    { positionLegalEntityId: 8 },
    { positionPlanId: 17 },
    { requisitionStatus: "cancelled" },
    { requisitionPlanHandoffHash: "c".repeat(64) },
    { positionAnnualBudget: "800000.00" },
    { positionUpdatedAt: "2026-10-08T03:00:00.001Z" },
    { profileTitle: "Supervisor" },
    { mwe: true },
  ];
  for (const changed of variations) {
    assert.notEqual(hireReviewFingerprint({ ...example, ...changed }), original, JSON.stringify(changed));
  }
  assert.throws(() => hireReviewFingerprint({ ...example, applicantId: 0 }), /invalid candidate/);
});

test("only valid frozen hire evidence can authorize candidate-to-worker conversion", () => {
  const source = freezeHireApproval(example);
  assert.deepEqual(hireEvidenceFromDefinition({ sourceEvidence: source }), source);
  assert.equal(hireEvidenceFromDefinition({ sourceEvidence: { ...source, applicantId: "14" } }), null);
  assert.equal(hireEvidenceFromDefinition({ sourceEvidence: { ...source, positionId: 0 } }), null);
  assert.equal(hireEvidenceFromDefinition({ sourceEvidence: { ...source, fingerprint: "broken" } }), null);
  assert.equal(hireEvidenceFromDefinition({}), null);
});

test("hire API enforces independent approval and atomic conversion", () => {
  const api = readFileSync("src/app/api/recruitment/hire/route.ts", "utf8");
  const intake = api.indexOf("const reviewContext: HireReviewContext");
  const conversion = api.indexOf("const resultOrResponse = await db.transaction");
  const insert = api.indexOf("await tx.insert(employees).values");
  assert.ok(intake > 0 && conversion > intake && insert > conversion);
  assert.match(api.slice(intake, conversion), /sourceType: "recruitment_hire"/);
  assert.match(api.slice(intake, conversion), /processType: "hire"/);
  assert.match(api.slice(intake, conversion), /status: 202/);
  assert.match(api.slice(conversion, insert), /eq\(hcmBusinessProcessInstances.status, "approved"\)/);
  assert.match(api.slice(conversion, insert), /hireReviewFingerprint/);
  assert.match(api.slice(insert), /status: "applied", updatedAt: new Date\(\)/);
  assert.match(api, /if \(!access.companyWide\)/);
});

test("hiring UI distinguishes pending approval from an employee creation", () => {
  const ui = readFileSync("src/components/recruitment-panel.tsx", "utf8");
  assert.match(ui, /if \(payload.approvalRequired\)/);
  assert.match(ui, /No worker or payroll records were created/);
  assert.match(ui, /Request review \/ complete approved hire/);
});

test("plan-backed requisition evidence is immutable throughout two-stage hire approval", () => {
  const lineage = {
    version: "hcm-plan-requisition-lineage-v1",
    planId: 8,
    baselineId: 40,
    baselineVersion: 2,
    baselineSnapshotHash: "a".repeat(64),
    executionId: 77,
    executionHash: "b".repeat(64),
    sourcePositionId: 12,
    positionId: 111,
    positionCode: "ENG-12",
    jobProfileId: 3,
    orgUnitId: 4,
    legalEntityId: 5,
    costCenterId: 6,
    annualBudget: "850000.00",
    executionAppliedAt: "2026-10-08T05:00:00.000Z",
  };
  const proof = hashRequisitionPlanHandoff(lineage);
  assert.match(proof ?? "", /^[a-f0-9]{64}$/);
  assert.equal(hashRequisitionPlanHandoff(null), null);
  assert.equal(hashRequisitionPlanHandoff({ ...lineage }), proof);
  assert.notEqual(hashRequisitionPlanHandoff({ ...lineage, executionId: 78 }), proof);
  assert.notEqual(hashRequisitionPlanHandoff({ ...lineage, annualBudget: "850001.00" }), proof);
  assert.throws(() => hashRequisitionPlanHandoff({ ...lineage, baselineId: "40" }), /invalid/);
  const approved = hireReviewFingerprint({ ...example, requisitionPlanHandoffHash: proof });
  assert.notEqual(approved, hireReviewFingerprint({ ...example, requisitionPlanHandoffHash: null }));
  const hireApi = readFileSync("src/app/api/recruitment/hire/route.ts", "utf8");
  assert.equal(hireApi.split("requisitionPlanHandoffHash: hashRequisitionPlanHandoff(freshRequisition.planHandoffEvidence)").length - 1, 2);
  assert.equal(hireApi.split("planHandoffEvidence: jobRequisitions.planHandoffEvidence").length - 1, 2);
});
