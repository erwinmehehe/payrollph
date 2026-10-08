import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PlanRequisitionHandoffError,
  resolvePublishedPlanRequisitionLineage,
  type AppliedPositionExecutionSource,
  type PublishedBaselineSource,
  type PublishedPlanSource,
} from "../src/lib/workforce-plan-requisition-handoff";
import { type WorkforcePlanLivePosition } from "../src/lib/workforce-plan-position-execution";

const HASH = "a".repeat(64);
const EXECUTION_HASH = "b".repeat(64);
const APPLIED_AT = "2026-10-08T05:00:00.000Z";
const position: WorkforcePlanLivePosition = {
  id: 12,
  code: "ENG-12",
  jobProfileId: 3,
  orgUnitId: 4,
  supervisoryOrgUnitId: 5,
  legalEntityId: 6,
  costCenterId: 7,
  planId: 8,
  managerEmployeeId: 9,
  employmentType: "Regular",
  status: "approved",
  plannedStartDate: "2026-11-01",
  annualBudget: "850000.00",
  notes: "Approved engineering vacancy",
};
const plan: PublishedPlanSource = { id: 8, organizationId: 100, status: "published" };
const sourcePosition = { ...position, sourcePositionId: position.id, annualBudget: 850000, status: "planned" };
const baseline: PublishedBaselineSource = {
  id: 40, organizationId: 100, planId: 8, version: 2, current: true, snapshotHash: HASH,
  snapshot: {
    version: "hcm-headcount-baseline-v1",
    positionExecutionSource: {
      version: "hcm-position-execution-source-v1",
      positions: [sourcePosition],
    },
  },
};
const execution: AppliedPositionExecutionSource = {
  id: 77, organizationId: 100, planId: 8, baselineId: 40,
  baselineSnapshotHash: HASH, status: "applied", executionHash: EXECUTION_HASH,
  appliedAt: new Date(APPLIED_AT),
  executionPlan: {
    version: "hcm-position-execution-preview-v1",
    baselineId: 40, baselineVersion: 2, baselineSnapshotHash: HASH,
    planId: 8, liveStateHash: "c".repeat(64),
    preview: {
      summary: { executable: true, blockerCount: 0 },
      actions: [], noops: [{ positionId: 12, code: "ENG-12", status: "approved" }],
    },
  },
  result: {
    appliedAt: APPLIED_AT, baselineId: 40, baselineSnapshotHash: HASH,
    executionHash: EXECUTION_HASH, createdPositions: [], updatedPositions: [],
    noopCount: 1,
  },
};

function decide(changes: {
  plan?: PublishedPlanSource | null;
  baseline?: PublishedBaselineSource | null;
  position?: WorkforcePlanLivePosition;
  executions?: AppliedPositionExecutionSource[];
  organizationId?: number;
} = {}) {
  return resolvePublishedPlanRequisitionLineage({
    organizationId: changes.organizationId ?? 100,
    plan: changes.plan === undefined ? plan : changes.plan,
    baseline: changes.baseline === undefined ? baseline : changes.baseline,
    position: changes.position ?? position,
    executions: changes.executions ?? [execution],
  });
}

function rejected(code: string, cb: () => unknown) {
  assert.throws(cb, (caught: unknown) =>
    caught instanceof PlanRequisitionHandoffError && caught.code === code,
  );
}

test("an applied current plan allows an approved matching vacant position to recruit", () => {
  const proof = decide();
  assert.equal(proof.version, "hcm-plan-requisition-lineage-v1");
  assert.deepEqual(
    [proof.planId, proof.baselineId, proof.baselineVersion, proof.executionId, proof.positionId, proof.sourcePositionId],
    [8, 40, 2, 77, 12, 12],
  );
  assert.equal(proof.executionHash, EXECUTION_HASH);
  assert.equal(proof.annualBudget, "850000.00");
  assert.equal(proof.executionAppliedAt, APPLIED_AT);
});

test("plan and baseline authority never fall back to unapproved or stale sources", () => {
  rejected("PLAN_REQUISITION_PUBLISHED_PLAN_REQUIRED", () =>
    decide({ plan: { ...plan, status: "draft" } }));
  rejected("PLAN_REQUISITION_PUBLISHED_PLAN_REQUIRED", () =>
    decide({ plan: { ...plan, organizationId: 101 } }));
  rejected("PLAN_REQUISITION_PUBLISHED_PLAN_REQUIRED", () =>
    decide({ position: { ...position, planId: 99 } }));
  rejected("PLAN_REQUISITION_CURRENT_BASELINE_REQUIRED", () =>
    decide({ baseline: null }));
  rejected("PLAN_REQUISITION_CURRENT_BASELINE_REQUIRED", () =>
    decide({ baseline: { ...baseline, current: false } }));
  rejected("PLAN_REQUISITION_CURRENT_BASELINE_REQUIRED", () =>
    decide({ baseline: { ...baseline, organizationId: 101 } }));
  rejected("PLAN_REQUISITION_BASELINE_UPGRADE_REQUIRED", () =>
    decide({ baseline: { ...baseline, snapshot: {} } }));
  rejected("PLAN_REQUISITION_POSITION_NOT_APPROVED", () =>
    decide({ position: { ...position, status: "planned" } }));
});

test("an unexecuted, superseded, wrong-tenant or forged execution never authorizes recruitment", () => {
  rejected("PLAN_REQUISITION_EXECUTION_REQUIRED", () => decide({ executions: [] }));
  rejected("PLAN_REQUISITION_EXECUTION_REQUIRED", () =>
    decide({ executions: [{ ...execution, status: "preview" }] }));
  rejected("PLAN_REQUISITION_EXECUTION_REQUIRED", () =>
    decide({ executions: [{ ...execution, baselineId: 41 }] }));
  rejected("PLAN_REQUISITION_EXECUTION_REQUIRED", () =>
    decide({ executions: [{ ...execution, organizationId: 101 }] }));
  rejected("PLAN_REQUISITION_EXECUTION_EVIDENCE_STALE", () =>
    decide({ executions: [{
      ...execution, result: { ...execution.result as object, executionHash: "f".repeat(64) },
    }] }));
  rejected("PLAN_REQUISITION_EXECUTION_EVIDENCE_STALE", () =>
    decide({ executions: [{
      ...execution, executionPlan: { ...execution.executionPlan as object, baselineVersion: 1 },
    }] }));
});

test("budget, job, org, legal entity, reporting line and plan drift all require republishing", () => {
  const variants: Partial<WorkforcePlanLivePosition>[] = [
    { code: "ENG-13" }, { jobProfileId: 10 }, { orgUnitId: 19 },
    { supervisoryOrgUnitId: 17 }, { legalEntityId: 11 }, { costCenterId: 12 },
    { managerEmployeeId: 20 }, { annualBudget: "860000.00" },
    { employmentType: "Contract" }, { notes: "Modified" }, { plannedStartDate: "2026-12-01" },
  ];
  for (const changed of variants) {
    const code = changed.code ? "PLAN_REQUISITION_EXECUTION_EVIDENCE_STALE" : "PLAN_REQUISITION_POSITION_DRIFT";
    rejected(code, () => decide({ position: { ...position, ...changed } }));
  }
});

test("executed recreated position retains its original baseline source position identity", () => {
  const inserted = { ...position, id: 111 };
  const mappedBaseline = {
    ...baseline,
    snapshot: {
      positionExecutionSource: {
        version: "hcm-position-execution-source-v1",
        positions: [sourcePosition],
      },
    },
  };
  const mappedExecution = {
    ...execution,
    executionPlan: {
      ...execution.executionPlan as object,
      preview: {
        summary: { executable: true, blockerCount: 0 },
        actions: [{ kind: "create", sourcePositionId: 12, code: "ENG-12" }],
        noops: [],
      },
    },
    result: {
      ...execution.result as object,
      createdPositions: [{ positionId: 111, sourcePositionId: 12, code: "ENG-12" }],
    },
  };
  const proof = decide({ position: inserted, baseline: mappedBaseline, executions: [mappedExecution] });
  assert.equal(proof.sourcePositionId, 12);
  assert.equal(proof.positionId, 111);

  const impostor = { ...mappedExecution, result: {
    ...mappedExecution.result as object,
    createdPositions: [{ positionId: 111, sourcePositionId: 12345, code: "ENG-12" }],
  } };
  rejected("PLAN_REQUISITION_EXECUTION_EVIDENCE_STALE", () =>
    decide({ position: inserted, baseline: mappedBaseline, executions: [impostor] }));
});

test("executed position update must match the same stored update action", () => {
  const updated = {
    ...execution,
    executionPlan: {
      ...execution.executionPlan as object,
      preview: {
        summary: { executable: true, blockerCount: 0 },
        actions: [{ kind: "update", positionId: 12, code: "ENG-12" }],
        noops: [],
      },
    },
    result: {
      ...execution.result as object,
      updatedPositions: [{ positionId: 12, code: "ENG-12" }],
    },
  };
  assert.equal(decide({ executions: [updated] }).executionId, 77);
  const forged = { ...updated, executionPlan: {
    ...updated.executionPlan as object,
    preview: { summary: { executable: true, blockerCount: 0 }, actions: [], noops: [] },
  } };
  rejected("PLAN_REQUISITION_EXECUTION_EVIDENCE_STALE", () =>
    decide({ executions: [forged] }));
});

test("recruitment uses transaction-scoped plan and position locks and immutable DB provenance", () => {
  const route = readFileSync("src/app/api/recruitment/route.ts", "utf8");
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const migration = readFileSync("drizzle/0098_workforce_plan_requisition_lineage.sql", "utf8");
  const planningUi = readFileSync("src/components/workforce-planning-panel.tsx", "utf8");
  const recruitmentUi = readFileSync("src/components/recruitment-panel.tsx", "utf8");
  assert.match(route, /pg_advisory_xact_lock\(4194/);
  assert.match(route, /for share/);
  assert.match(route, /pg_advisory_xact_lock\(4102/);
  assert.match(route, /positionControlFingerprint\(freshPosition\) !== positionControlFingerprint\(position\)/);
  assert.match(route, /eq\(workforcePlanBaselines.current, true\)/);
  assert.match(route, /eq\(workforcePlanPositionExecutions.status, "applied"\)/);
  assert.match(route, /resolvePublishedPlanRequisitionLineage\(/);
  assert.match(route, /planHandoffEvidence: lineage/);
  assert.match(route, /planHandoffEvidence: lineage,[\s\S]*positionExecutionId/);
  assert.match(schema, /planHandoffEvidence: jsonb\("plan_handoff_evidence"\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "plan_handoff_evidence" jsonb/);
  assert.match(planningUi, /payload.planHandoffEvidence/);
  assert.match(recruitmentUi, /published baseline v/);
});
