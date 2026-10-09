import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  effectiveHcmSourceDrift,
  effectiveHcmTargetDrift,
  type HcmEffectiveSourceState,
} from "../src/lib/hcm-effective-source-integrity";

const baseline: HcmEffectiveSourceState = {
  employee: {
    orgUnitId: 5,
    legalEntityId: 7,
    title: "Analyst",
    employmentType: "Regular",
    status: "Active",
  },
  assignment: {
    id: 21,
    positionId: 42,
    assignmentType: "primary",
    fte: "1.0000",
    effectiveFrom: "2025-08-01",
  },
  position: {
    id: 42,
    code: "FIN-002",
    orgUnitId: 5,
    supervisoryOrgUnitId: 3,
    legalEntityId: 7,
    costCenterId: 12,
    managerEmployeeId: 8,
    employmentType: "Regular",
  },
};

test("an unchanged fully sourced HCM movement is eligible for independently approved application", () => {
  assert.equal(effectiveHcmSourceDrift(baseline, structuredClone(baseline)), null);
  assert.equal(effectiveHcmSourceDrift({
    ...baseline,
    employee: { ...baseline.employee, orgUnitId: "5", legalEntityId: "7" },
  }, baseline), null, "serialized identifier strings preserve the same source identity");
});

test("transfer cannot overwrite more recent legal-employer, org-unit, title, employment or status changes", () => {
  for (const field of ["orgUnitId", "legalEntityId", "title", "employmentType", "status"]) {
    const current = structuredClone(baseline);
    current.employee[field] = field === "title" ? "Senior Analyst"
      : field === "employmentType" ? "Fixed term"
      : field === "status" ? "On leave"
      : 999;
    const drift = effectiveHcmSourceDrift(baseline, current);
    assert.equal(drift?.code, "HCM_EFFECTIVE_SOURCE_CHANGED", field);
    assert.equal(drift?.field, `employee.${field}`, field);
  }
});

test("position changes must not rewrite a swapped incumbent, manager or legal employer", () => {
  const swapped = structuredClone(baseline);
  if (swapped.assignment) swapped.assignment.positionId = 300;
  const drift = effectiveHcmSourceDrift(baseline, swapped);
  assert.equal(drift?.field, "assignment.positionId");

  for (const key of ["managerEmployeeId", "legalEntityId", "orgUnitId", "costCenterId", "supervisoryOrgUnitId", "employmentType"]) {
    const changed = structuredClone(baseline);
    if (changed.position) changed.position[key] = 600;
    assert.equal(effectiveHcmSourceDrift(baseline, changed)?.field, `position.${key}`);
  }
});

test("change with no assigned position accepts a stable, unassigned worker", () => {
  const none: HcmEffectiveSourceState = { employee: baseline.employee, assignment: null, position: null };
  assert.equal(effectiveHcmSourceDrift(none, structuredClone(none)), null);
  const newlyAssigned = structuredClone(none);
  newlyAssigned.assignment = structuredClone(baseline.assignment);
  newlyAssigned.position = structuredClone(baseline.position);
  assert.equal(effectiveHcmSourceDrift(none, newlyAssigned)?.field, "assignment");
});

test("approved destination is immutable even when its vacancy status is normally reserved", () => {
  const target = structuredClone(baseline.position);
  assert.equal(effectiveHcmTargetDrift({ targetPosition: target }, structuredClone(target)), null);
  assert.equal(effectiveHcmTargetDrift({ targetPosition: null }, null), null);

  for (const field of ["orgUnitId", "supervisoryOrgUnitId", "legalEntityId",
    "managerEmployeeId", "costCenterId", "employmentType", "code", "id"]) {
    const changed = structuredClone(baseline.position);
    if (changed) changed[field] = field === "employmentType" ? "Fixed term"
      : field === "code" ? "NEW-OWNER"
      : 9999;
    const result = effectiveHcmTargetDrift({ targetPosition: baseline.position }, changed);
    assert.equal(result?.code, "HCM_EFFECTIVE_SOURCE_CHANGED", field);
    assert.equal(result?.field, `targetPosition.${field}`, field);
  }
  assert.equal(effectiveHcmTargetDrift({}, baseline.position)?.code, "HCM_EFFECTIVE_SOURCE_MISSING");
  assert.equal(effectiveHcmTargetDrift({ targetPosition: null }, baseline.position)?.field, "targetPosition");
});

test("missing or malformed legacy approval source fails closed before any HCM mutation", () => {
  for (const missing of [{}, { employee: baseline.employee }, null, [], {
    employee: baseline.employee, assignment: undefined, position: null,
  }]) {
    assert.equal(effectiveHcmSourceDrift(missing, baseline)?.code, "HCM_EFFECTIVE_SOURCE_MISSING");
  }
  const missingField = structuredClone(baseline);
  delete missingField.employee.status;
  assert.equal(effectiveHcmSourceDrift(missingField, baseline)?.field, "employee.status");
});

test("apply commits worker, position, event, decision and audit together or none", () => {
  const source = readFileSync("src/lib/hcm-effective-changes.ts", "utf8");
  const transactionStart = source.indexOf("result = await db.transaction(async (tx) => {");
  const transactionEnd = source.indexOf("\n  } catch (error) {\n    const message =", transactionStart);
  assert.ok(transactionStart > -1 && transactionEnd > transactionStart);
  const committed = source.slice(transactionStart, transactionEnd);
  assert.ok(committed.includes("pg_advisory_xact_lock(4203"));
  assert.ok(committed.includes("pg_advisory_xact_lock(4204"));
  assert.ok(committed.includes("effectiveHcmSourceDrift(change.fromSnapshot"));
  assert.ok(committed.includes("effectiveHcmTargetDrift(change.toSnapshot"));
  assert.ok(committed.includes("ORDER BY id FOR UPDATE"));
  assert.ok(committed.includes("tx.update(positionAssignments)"));
  assert.ok(committed.includes("tx.update(employees)"));
  assert.ok(committed.includes("tx.insert(workerEmploymentEvents)"));
  assert.ok(committed.includes("tx.update(workerEffectiveChanges)"));
  assert.ok(committed.includes("tx.insert(auditEvents)"));
  assert.ok(committed.includes('sourceGuard: "validated-before-apply"'));
  assert.ok(committed.includes("HCM change audit did not persist"));
  assert.ok(!source.includes("recordAuditEvent"));
  assert.ok(source.includes("if (!closedAssignment)"));
  assert.ok(source.includes("The employee's authoritative HCM source changed before commit"));
});

test("a failure delivering field-change automation is a post-commit warning, never a failed movement", () => {
  const source = readFileSync("src/lib/hcm-effective-changes.ts", "utf8");
  const appliedIndex = source.indexOf('status: "applied"');
  const postCommit = source.indexOf("const postApplyWarnings: string[]");
  const fieldTry = source.indexOf("fieldChangeAutomation = await runEmployeeFieldChangeAutomations");
  const warning = source.indexOf('postApplyWarnings.push(`field-change-automation:');
  assert.ok(appliedIndex > -1 && postCommit > appliedIndex);
  assert.ok(fieldTry > postCommit && warning > fieldTry);
  assert.ok(source.includes("return {\n    ...result,\n    hcmObligations"));
});

test("request, approval, decline, cancellation and retry decisions each audit inside SQL transaction", () => {
  const route = readFileSync("src/app/api/hcm/effective-changes/route.ts", "utf8");
  for (const action of [
    "Effective-dated HCM change requested",
    "Effective-dated HCM change approved",
    "Effective-dated HCM change declined",
    "Effective-dated HCM change cancelled",
    "Effective-dated HCM change retried",
  ]) {
    assert.ok(route.includes(`action: "${action}"`), action);
  }
  assert.ok(route.includes("startHcmBusinessProcessTx(tx"));
  assert.ok(route.includes("requireSensitiveActionMfa(user)"));
  assert.ok(route.includes('action: "hcm-effective-change-request"'));
  assert.ok(route.includes('action: "hcm-effective-change-decision"'));
  assert.ok(route.includes("tx.insert(auditEvents)"));
  assert.ok(!route.includes("recordAuditEvent"));
  assert.ok(route.includes("HCM_RETRY_APPROVAL_EVIDENCE_MISSING"));
  assert.ok(route.includes("HCM_RETRY_BP_NOT_APPROVED"));
  assert.ok(route.includes("HCM_RETRY_TARGET_NOT_RESERVED"));
  assert.ok(route.includes("effectiveHcmSourceDrift(change.fromSnapshot"));
  assert.ok(route.includes("effectiveHcmTargetDrift(change.toSnapshot"));
  assert.ok(route.includes("FOR UPDATE"));
  assert.ok(route.includes("HCM_RETRY_DECISION_STALE"));
});
