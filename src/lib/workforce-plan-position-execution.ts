export type WorkforcePlanPositionSpec = {
  sourcePositionId: number;
  code: string;
  jobProfileId: number;
  orgUnitId: number | null;
  supervisoryOrgUnitId: number | null;
  legalEntityId: number | null;
  costCenterId: number | null;
  planId: number;
  managerEmployeeId: number | null;
  employmentType: string;
  status: string;
  plannedStartDate: string | null;
  annualBudget: number;
  notes: string | null;
};

export type WorkforcePlanLivePosition = {
  id: number;
  code: string;
  jobProfileId: number;
  orgUnitId: number | null;
  supervisoryOrgUnitId: number | null;
  legalEntityId: number | null;
  costCenterId: number | null;
  planId: number | null;
  managerEmployeeId: number | null;
  employmentType: string;
  status: string;
  plannedStartDate: string | null;
  annualBudget: string | number;
  notes: string | null;
};

export type PositionExecutionAction =
  | {
      kind: "create";
      sourcePositionId: number;
      code: string;
      after: WorkforcePlanPositionSpec & { status: "approved" };
    }
  | {
      kind: "update";
      positionId: number;
      code: string;
      before: WorkforcePlanPositionSpec;
      after: WorkforcePlanPositionSpec;
      changedFields: string[];
    };

export type PositionExecutionBlocker = {
  code:
    | "BASELINE_POSITION_INVALID"
    | "UNAPPROVED_PLAN_POSITION"
    | "POSITION_CODE_COLLISION"
    | "MISSING_NONCREATABLE_POSITION"
    | "POSITION_IDENTITY_DRIFT"
    | "POSITION_LIFECYCLE_DRIFT"
    | "OCCUPIED_POSITION_DRIFT"
    | "RECRUITING_POSITION_DRIFT";
  positionId: number | null;
  positionCode: string | null;
  message: string;
};

function money(value: string | number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("Position budget must be finite.");
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

export function normalizePositionSpec(
  row: Omit<WorkforcePlanPositionSpec, "annualBudget"> & { annualBudget: string | number },
): WorkforcePlanPositionSpec {
  return {
    sourcePositionId: row.sourcePositionId,
    code: row.code.trim().toUpperCase(),
    jobProfileId: row.jobProfileId,
    orgUnitId: row.orgUnitId ?? null,
    supervisoryOrgUnitId: row.supervisoryOrgUnitId ?? null,
    legalEntityId: row.legalEntityId ?? null,
    costCenterId: row.costCenterId ?? null,
    planId: row.planId,
    managerEmployeeId: row.managerEmployeeId ?? null,
    employmentType: row.employmentType,
    status: row.status,
    plannedStartDate: row.plannedStartDate ?? null,
    annualBudget: money(row.annualBudget),
    notes: row.notes ?? null,
  };
}

export function livePositionSpec(row: WorkforcePlanLivePosition): WorkforcePlanPositionSpec {
  if (row.planId == null) {
    throw new Error(`Position ${row.code} is not linked to a workforce plan.`);
  }
  return normalizePositionSpec({
    sourcePositionId: row.id,
    code: row.code,
    jobProfileId: row.jobProfileId,
    orgUnitId: row.orgUnitId,
    supervisoryOrgUnitId: row.supervisoryOrgUnitId,
    legalEntityId: row.legalEntityId,
    costCenterId: row.costCenterId,
    planId: row.planId,
    managerEmployeeId: row.managerEmployeeId,
    employmentType: row.employmentType,
    status: row.status,
    plannedStartDate: row.plannedStartDate,
    annualBudget: row.annualBudget,
    notes: row.notes,
  });
}

const STRUCTURAL_FIELDS: Array<keyof WorkforcePlanPositionSpec> = [
  "jobProfileId",
  "orgUnitId",
  "supervisoryOrgUnitId",
  "legalEntityId",
  "costCenterId",
  "planId",
  "managerEmployeeId",
  "employmentType",
  "plannedStartDate",
  "annualBudget",
  "notes",
];

function changedStructuralFields(
  baseline: WorkforcePlanPositionSpec,
  live: WorkforcePlanPositionSpec,
) {
  return STRUCTURAL_FIELDS.filter((field) => baseline[field] !== live[field]).map(String);
}

function approvedTarget(spec: WorkforcePlanPositionSpec): WorkforcePlanPositionSpec {
  return {
    ...spec,
    status: spec.status === "planned" ? "approved" : spec.status,
  };
}

export function buildPositionExecutionPreview(input: {
  planId: number;
  baselinePositions: WorkforcePlanPositionSpec[];
  livePositions: WorkforcePlanLivePosition[];
  activeAssignmentPositionIds?: Iterable<number>;
  activeRequisitionPositionIds?: Iterable<number>;
}) {
  const assignmentIds = new Set(input.activeAssignmentPositionIds ?? []);
  const requisitionIds = new Set(input.activeRequisitionPositionIds ?? []);
  const blockers: PositionExecutionBlocker[] = [];
  const actions: PositionExecutionAction[] = [];
  const noops: Array<{ positionId: number; code: string; status: string }> = [];

  const baseline = input.baselinePositions.map(normalizePositionSpec);
  const baselineIds = new Set<number>();
  const baselineCodes = new Set<string>();

  for (const spec of baseline) {
    if (
      !Number.isInteger(spec.sourcePositionId)
      || spec.sourcePositionId <= 0
      || spec.planId !== input.planId
      || !spec.code
      || !Number.isInteger(spec.jobProfileId)
      || spec.jobProfileId <= 0
      || spec.status === "closed"
    ) {
      blockers.push({
        code: "BASELINE_POSITION_INVALID",
        positionId: Number.isInteger(spec.sourcePositionId) ? spec.sourcePositionId : null,
        positionCode: spec.code || null,
        message: "Published position evidence is incomplete or not executable.",
      });
      continue;
    }
    if (baselineIds.has(spec.sourcePositionId) || baselineCodes.has(spec.code)) {
      blockers.push({
        code: "BASELINE_POSITION_INVALID",
        positionId: spec.sourcePositionId,
        positionCode: spec.code,
        message: "Published position evidence contains duplicate position identity.",
      });
      continue;
    }
    baselineIds.add(spec.sourcePositionId);
    baselineCodes.add(spec.code);
  }

  const liveById = new Map(input.livePositions.map((row) => [row.id, row]));
  const liveByCode = new Map(input.livePositions.map((row) => [row.code.trim().toUpperCase(), row]));

  for (const live of input.livePositions) {
    if (live.planId === input.planId && live.status !== "closed" && !baselineIds.has(live.id)) {
      blockers.push({
        code: "UNAPPROVED_PLAN_POSITION",
        positionId: live.id,
        positionCode: live.code,
        message: "A live position was linked to this plan after the published baseline. Publish a new approved baseline before execution.",
      });
    }
  }

  for (const spec of baseline) {
    if (!baselineIds.has(spec.sourcePositionId)) continue;
    const live = liveById.get(spec.sourcePositionId);

    if (!live) {
      const collision = liveByCode.get(spec.code);
      if (collision) {
        blockers.push({
          code: "POSITION_CODE_COLLISION",
          positionId: collision.id,
          positionCode: spec.code,
          message: "The published position code is now used by a different live position.",
        });
        continue;
      }
      if (!["planned", "approved"].includes(spec.status)) {
        blockers.push({
          code: "MISSING_NONCREATABLE_POSITION",
          positionId: spec.sourcePositionId,
          positionCode: spec.code,
          message: "Only missing planned or approved positions can be recreated from published evidence.",
        });
        continue;
      }
      actions.push({
        kind: "create",
        sourcePositionId: spec.sourcePositionId,
        code: spec.code,
        after: { ...spec, status: "approved" },
      });
      continue;
    }

    const liveSpec = livePositionSpec(live);
    if (liveSpec.code !== spec.code) {
      blockers.push({
        code: "POSITION_IDENTITY_DRIFT",
        positionId: live.id,
        positionCode: live.code,
        message: "Position code changed after publication. Republish the plan rather than rewriting identity during execution.",
      });
      continue;
    }

    const structuralChanges = changedStructuralFields(spec, liveSpec);
    const baselineTarget = approvedTarget(spec);

    if (structuralChanges.length > 0) {
      if (assignmentIds.has(live.id)) {
        blockers.push({
          code: "OCCUPIED_POSITION_DRIFT",
          positionId: live.id,
          positionCode: live.code,
          message: "An occupied position changed after publication and cannot be rewritten by plan execution.",
        });
        continue;
      }
      if (requisitionIds.has(live.id)) {
        blockers.push({
          code: "RECRUITING_POSITION_DRIFT",
          positionId: live.id,
          positionCode: live.code,
          message: "A recruiting position changed after publication and cannot be rewritten by plan execution.",
        });
        continue;
      }
      if (!["planned", "approved"].includes(live.status) || !["planned", "approved"].includes(spec.status)) {
        blockers.push({
          code: "POSITION_LIFECYCLE_DRIFT",
          positionId: live.id,
          positionCode: live.code,
          message: "Position lifecycle advanced after publication. Republish before applying structural changes.",
        });
        continue;
      }
      actions.push({
        kind: "update",
        positionId: live.id,
        code: live.code,
        before: liveSpec,
        after: { ...baselineTarget, sourcePositionId: live.id },
        changedFields: [...structuralChanges, ...(live.status !== baselineTarget.status ? ["status"] : [])],
      });
      continue;
    }

    if (spec.status === "planned" && live.status === "planned") {
      actions.push({
        kind: "update",
        positionId: live.id,
        code: live.code,
        before: liveSpec,
        after: { ...liveSpec, status: "approved" },
        changedFields: ["status"],
      });
      continue;
    }

    if (spec.status === "approved" && live.status === "planned") {
      actions.push({
        kind: "update",
        positionId: live.id,
        code: live.code,
        before: liveSpec,
        after: { ...liveSpec, status: "approved" },
        changedFields: ["status"],
      });
      continue;
    }

    if (
      spec.status === live.status
      || (spec.status === "planned" && ["approved", "open", "filled"].includes(live.status))
      || (spec.status === "approved" && ["open", "filled"].includes(live.status))
    ) {
      noops.push({ positionId: live.id, code: live.code, status: live.status });
      continue;
    }

    blockers.push({
      code: "POSITION_LIFECYCLE_DRIFT",
      positionId: live.id,
      positionCode: live.code,
      message: "The live position lifecycle no longer matches the published plan.",
    });
  }

  return {
    planId: input.planId,
    actions,
    blockers,
    noops,
    summary: {
      baselinePositions: baseline.length,
      createCount: actions.filter((action) => action.kind === "create").length,
      updateCount: actions.filter((action) => action.kind === "update").length,
      noopCount: noops.length,
      blockerCount: blockers.length,
      executable: blockers.length === 0,
    },
  };
}
