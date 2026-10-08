import { normalizePositionSpec, type WorkforcePlanLivePosition, type WorkforcePlanPositionSpec } from "@/lib/workforce-plan-position-execution";

/**
 * A requisition can spend approved headcount only after the company's current
 * published plan baseline has been independently executed into the position
 * ledger. This is an immutable trace, not a new source of position authority.
 */
export type WorkforcePlanRequisitionLineage = {
  version: "hcm-plan-requisition-lineage-v1";
  planId: number;
  baselineId: number;
  baselineVersion: number;
  baselineSnapshotHash: string;
  executionId: number;
  executionHash: string;
  sourcePositionId: number;
  positionId: number;
  positionCode: string;
  jobProfileId: number;
  orgUnitId: number | null;
  legalEntityId: number | null;
  costCenterId: number | null;
  annualBudget: string;
  executionAppliedAt: string;
};

export type PublishedPlanSource = {
  id: number;
  organizationId: number;
  status: string;
};

export type PublishedBaselineSource = {
  id: number;
  organizationId: number;
  planId: number;
  version: number;
  current: boolean;
  snapshotHash: string;
  snapshot: unknown;
};

export type AppliedPositionExecutionSource = {
  id: number;
  organizationId: number;
  planId: number;
  baselineId: number;
  baselineSnapshotHash: string;
  status: string;
  executionHash: string;
  executionPlan: unknown;
  result: unknown;
  appliedAt: Date | string | null;
};

function object(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function entries(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(object) : [];
}

function positiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function hexHash(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export class PlanRequisitionHandoffError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PlanRequisitionHandoffError";
  }
}

function block(code: string, message: string): never {
  throw new PlanRequisitionHandoffError(code, message);
}

const CONTROL_FIELDS: Array<keyof WorkforcePlanPositionSpec> = [
  "code", "jobProfileId", "orgUnitId", "supervisoryOrgUnitId",
  "legalEntityId", "costCenterId", "planId", "managerEmployeeId",
  "employmentType", "plannedStartDate", "annualBudget", "notes",
];

export function resolvePublishedPlanRequisitionLineage(input: {
  organizationId: number;
  plan: PublishedPlanSource | null;
  baseline: PublishedBaselineSource | null;
  executions: AppliedPositionExecutionSource[];
  position: WorkforcePlanLivePosition;
}): WorkforcePlanRequisitionLineage {
  const { organizationId, plan, baseline, position } = input;
  if (!positiveInt(organizationId) || !positiveInt(position.id)
    || !positiveInt(position.planId) || !plan
    || plan.id !== position.planId || plan.organizationId !== organizationId
    || plan.status !== "published") {
    return block(
      "PLAN_REQUISITION_PUBLISHED_PLAN_REQUIRED",
      "This planned position needs a currently published workforce plan before recruitment.",
    );
  }

  if (!baseline || baseline.organizationId !== organizationId
    || baseline.planId !== plan.id || !baseline.current
    || !positiveInt(baseline.id) || !positiveInt(baseline.version)
    || !hexHash(baseline.snapshotHash)) {
    return block(
      "PLAN_REQUISITION_CURRENT_BASELINE_REQUIRED",
      "Publish an approved current workforce-plan baseline before opening a requisition.",
    );
  }

  const source = object(object(baseline.snapshot).positionExecutionSource);
  if (source.version !== "hcm-position-execution-source-v1"
    || !Array.isArray(source.positions)) {
    return block(
      "PLAN_REQUISITION_BASELINE_UPGRADE_REQUIRED",
      "The published baseline has no controlled position source. Republish an approved scenario and execute the refreshed plan.",
    );
  }
  if (position.status !== "approved") {
    return block(
      "PLAN_REQUISITION_POSITION_NOT_APPROVED",
      "Recruitment requires an approved, vacant position.",
    );
  }

  const executions = input.executions
    .filter((execution) =>
      execution.organizationId === organizationId
      && execution.planId === plan.id
      && execution.baselineId === baseline.id
      && execution.baselineSnapshotHash === baseline.snapshotHash
      && execution.status === "applied",
    )
    .sort((left, right) => right.id - left.id);
  if (executions.length === 0) {
    return block(
      "PLAN_REQUISITION_EXECUTION_REQUIRED",
      "Apply the current published plan's position execution preview before opening recruitment.",
    );
  }

  for (const execution of executions) {
    if (!positiveInt(execution.id) || !hexHash(execution.executionHash)) continue;
    const frozen = object(execution.executionPlan);
    const result = object(execution.result);
    const preview = object(frozen.preview);
    const summary = object(preview.summary);
    if (frozen.version !== "hcm-position-execution-preview-v1"
      || frozen.planId !== plan.id || frozen.baselineId !== baseline.id
      || frozen.baselineVersion !== baseline.version
      || frozen.baselineSnapshotHash !== baseline.snapshotHash
      || typeof frozen.liveStateHash !== "string"
      || summary.executable !== true || summary.blockerCount !== 0
      || result.baselineId !== baseline.id
      || result.baselineSnapshotHash !== baseline.snapshotHash
      || result.executionHash !== execution.executionHash) continue;

    const appliedAt = execution.appliedAt instanceof Date
      ? execution.appliedAt.toISOString() : String(execution.appliedAt ?? "");
    if (!Number.isFinite(new Date(appliedAt).getTime())
      || result.appliedAt !== appliedAt) continue;

    const created = entries(result.createdPositions).filter((entry) =>
      entry.positionId === position.id && entry.code === position.code);
    const updated = entries(result.updatedPositions).filter((entry) =>
      entry.positionId === position.id && entry.code === position.code);
    const noops = entries(preview.noops).filter((entry) =>
      entry.positionId === position.id && entry.code === position.code);
    // An executable position must appear in exactly one authoritative outcome
    // of the applied preview, not merely somewhere in the organization ledger.
    if (created.length + updated.length + noops.length !== 1) continue;
    const sourcePositionId = created.length ? created[0].sourcePositionId : position.id;
    if (!positiveInt(sourcePositionId)) continue;

    const actions = entries(preview.actions);
    if (created.length && !actions.some((entry) =>
      entry.kind === "create" && entry.sourcePositionId === sourcePositionId
        && entry.code === position.code)) continue;
    if (updated.length && !actions.some((entry) =>
      entry.kind === "update" && entry.positionId === position.id
        && entry.code === position.code)) continue;

    const matches = entries(source.positions).filter((row) =>
      row.sourcePositionId === sourcePositionId && row.code === position.code);
    if (matches.length !== 1) continue;
    const spec = matches[0];
    if (!positiveInt(spec.jobProfileId) || spec.planId !== plan.id
      || typeof spec.code !== "string" || !["planned", "approved", "open", "filled"].includes(String(spec.status))
      || !Number.isFinite(Number(spec.annualBudget)) || Number(spec.annualBudget) < 0) continue;

    let normalized: WorkforcePlanPositionSpec;
    try {
      normalized = normalizePositionSpec(spec as unknown as WorkforcePlanPositionSpec);
    } catch {
      continue;
    }
    const live = normalizePositionSpec({
      ...position,
      sourcePositionId,
      planId: position.planId,
    });
    if (CONTROL_FIELDS.some((field) => normalized[field] !== live[field])) {
      return block(
        "PLAN_REQUISITION_POSITION_DRIFT",
        "Position job, cost-center, employer, budget, or organization changed after plan execution. Publish and execute a revised plan.",
      );
    }

    return {
      version: "hcm-plan-requisition-lineage-v1",
      planId: plan.id,
      baselineId: baseline.id,
      baselineVersion: baseline.version,
      baselineSnapshotHash: baseline.snapshotHash,
      executionId: execution.id,
      executionHash: execution.executionHash,
      sourcePositionId,
      positionId: position.id,
      positionCode: position.code,
      jobProfileId: position.jobProfileId,
      orgUnitId: position.orgUnitId,
      legalEntityId: position.legalEntityId,
      costCenterId: position.costCenterId,
      annualBudget: Number(position.annualBudget).toFixed(2),
      executionAppliedAt: appliedAt,
    };
  }

  return block(
    "PLAN_REQUISITION_EXECUTION_EVIDENCE_STALE",
    "The position cannot be reconciled to the applied current plan. Republish and execute a fresh position baseline.",
  );
}
