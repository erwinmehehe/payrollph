import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  freezeHcmPositionSource,
  positionControlFingerprint,
  positionEvidenceFromDefinition,
  type HcmPositionControlRecord,
} from "../src/lib/hcm-position-business-process";

const example: HcmPositionControlRecord = {
  id: 18,
  organizationId: 4,
  code: "ENG-101",
  status: "planned",
  jobProfileId: 7,
  orgUnitId: 8,
  supervisoryOrgUnitId: 9,
  legalEntityId: 3,
  costCenterId: 2,
  planId: 1,
  managerEmployeeId: 24,
  employmentType: "Regular",
  plannedStartDate: "2026-11-01",
  annualBudget: "750000.00",
  notes: "Approved Philippine engineering headcount",
  updatedAt: new Date("2026-10-08T06:15:00.000Z"),
};

test("position approval freezes every position control field and rejects later drift", () => {
  const original = positionControlFingerprint(example);
  assert.match(original, /^[0-9a-f]{64}$/);
  assert.equal(positionControlFingerprint({ ...example }), original);
  assert.notEqual(positionControlFingerprint({ ...example, annualBudget: "750001.00" }), original);
  assert.notEqual(positionControlFingerprint({ ...example, managerEmployeeId: 25 }), original);
  assert.notEqual(positionControlFingerprint({ ...example, status: "approved" }), original);
  assert.notEqual(positionControlFingerprint({ ...example, updatedAt: new Date("2026-10-08T06:15:00.001Z") }), original);
  assert.notEqual(positionControlFingerprint({ ...example, planId: null }), original);
  assert.throws(() => positionControlFingerprint({ ...example, annualBudget: "-1" }), /invalid budget/);
});

test("only structurally valid frozen position evidence can be applied", () => {
  const evidence = freezeHcmPositionSource(example);
  assert.deepEqual(positionEvidenceFromDefinition({ sourceEvidence: evidence }), evidence);
  assert.equal(positionEvidenceFromDefinition({ sourceEvidence: { ...evidence, positionId: "18" } }), null);
  assert.equal(positionEvidenceFromDefinition({ sourceEvidence: { ...evidence, organizationId: 0 } }), null);
  assert.equal(positionEvidenceFromDefinition({ sourceEvidence: { ...evidence, fingerprint: "a".repeat(63) } }), null);
  assert.equal(positionEvidenceFromDefinition({ sourceEvidence: { ...evidence, expectedStatus: "filled" } }), null);
  assert.equal(positionEvidenceFromDefinition({}), null);
});

test("planned positions enter HCM business process before becoming approved", () => {
  const api = readFileSync("src/app/api/workforce-planning/route.ts", "utf8");
  const engine = readFileSync("src/lib/hcm-business-process.ts", "utf8");
  assert.match(api, /sourceType: "position_creation"/);
  assert.match(api, /sourceType: governedAction === "create_position" \? "position_creation" : "position_closure"/);
  assert.match(api, /startHcmBusinessProcessTx\(tx/);
  assert.match(api, /sourceEvidence: \{ \.\.\.freezeHcmPositionSource\(/);
  assert.match(api, /approvalRequired: true/);
  assert.match(api, /status: 202/);
  assert.match(engine, /finalizePositionBusinessProcessSource/);
  assert.match(engine, /positionControlFingerprint\(current\) !== evidence.fingerprint/);
  assert.match(engine, /pg_advisory_xact_lock\(4102/);
  assert.match(engine, /inArray\(hcmBusinessProcessInstances.status, \["in_progress", "approved"\]\)/.source ? /hcmBusinessProcessInstances.status/ : /approval/);
});

test("position finalization never bypasses incumbency, recruitment or source-approval gates", () => {
  const engine = readFileSync("src/lib/hcm-business-process.ts", "utf8");
  const lifecycle = engine.slice(
    engine.indexOf("async function finalizePositionBusinessProcessSource("),
    engine.indexOf("export async function finalizeHcmBusinessProcessSource("),
  );
  assert.match(lifecycle, /instance.status !== "approved"/);
  assert.match(lifecycle, /positionAssignments/);
  assert.match(lifecycle, /jobRequisitions/);
  assert.match(lifecycle, /isNull\(positionAssignments.effectiveUntil\)/);
  assert.match(lifecycle, /\["filled", "cancelled"\]/);
  assert.match(lifecycle, /eq\(hcmBusinessProcessInstances.status, "approved"\)/);
  assert.match(lifecycle, /status: "failed"/);
  assert.doesNotMatch(lifecycle, /payrollRuns|payout|bankTransfer|createPayroll/);
});

test("position UI reports approval requests rather than pretending the position changed", () => {
  const ui = readFileSync("src/components/workforce-planning-panel.tsx", "utf8");
  assert.match(ui, /savedPosition.approvalRequired/);
  assert.match(ui, /payload.approvalRequired/);
  assert.match(ui, /People → HCM Inbox/);
});
