export type HeadcountPlanPosition = {
  id: number;
  planId: number | null;
  jobProfileId: number;
  orgUnitId: number | null;
  costCenterId: number | null;
  status: string;
  annualBudget: string | number;
};

export type HeadcountPlanAssignment = {
  positionId: number;
  fte: string | number;
  effectiveFrom: string;
  effectiveUntil: string | null;
};

export type HeadcountPlanDimensionRow = {
  key: number | null;
  requestedHeadcount: number;
  approvedHeadcount: number;
  filledHeadcount: number;
  requestedFte: number;
  approvedFte: number;
  filledFte: number;
  annualPositionBudget: number;
};

export type HeadcountPlanSummary = HeadcountPlanDimensionRow & {
  vacantApprovedHeadcount: number;
  positionIds: number[];
  dimensions: {
    orgUnits: HeadcountPlanDimensionRow[];
    costCenters: HeadcountPlanDimensionRow[];
    jobProfiles: HeadcountPlanDimensionRow[];
  };
  quality: {
    filledPositionsWithoutActiveAssignment: number[];
    activeAssignmentsOnNonFilledPositions: number[];
  };
};

const REQUESTED_STATUSES = new Set(["planned", "approved", "open", "filled", "frozen"]);
const APPROVED_STATUSES = new Set(["approved", "open", "filled"]);

function round4(value: number) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function activeOn(assignment: HeadcountPlanAssignment, asOf: string) {
  return assignment.effectiveFrom <= asOf
    && (assignment.effectiveUntil == null || assignment.effectiveUntil >= asOf);
}

function summarizeRows(
  rows: HeadcountPlanPosition[],
  assignmentsByPosition: Map<number, HeadcountPlanAssignment[]>,
  key: number | null,
): HeadcountPlanDimensionRow {
  const requested = rows.filter((row) => REQUESTED_STATUSES.has(row.status));
  const approved = rows.filter((row) => APPROVED_STATUSES.has(row.status));
  const filled = rows.filter((row) => row.status === "filled");
  const filledFte = filled.reduce((sum, position) => {
    const assignments = assignmentsByPosition.get(position.id) ?? [];
    return sum + assignments.reduce((inner, assignment) => inner + Number(assignment.fte || 0), 0);
  }, 0);
  return {
    key,
    requestedHeadcount: requested.length,
    approvedHeadcount: approved.length,
    filledHeadcount: filled.length,
    requestedFte: round4(requested.length),
    approvedFte: round4(approved.length),
    filledFte: round4(filledFte),
    annualPositionBudget: round2(requested.reduce((sum, row) => sum + Number(row.annualBudget || 0), 0)),
  };
}

function groupDimension(
  rows: HeadcountPlanPosition[],
  assignmentsByPosition: Map<number, HeadcountPlanAssignment[]>,
  keyOf: (row: HeadcountPlanPosition) => number | null,
) {
  const groups = new Map<number | null, HeadcountPlanPosition[]>();
  for (const row of rows) {
    const key = keyOf(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([key, group]) => summarizeRows(group, assignmentsByPosition, key))
    .sort((a, b) => (a.key ?? -1) - (b.key ?? -1));
}

export function summarizeHeadcountPlan(input: {
  planId: number;
  asOf: string;
  scopeOrgUnitId?: number | null;
  positions: HeadcountPlanPosition[];
  assignments: HeadcountPlanAssignment[];
}): HeadcountPlanSummary {
  const planRows = input.positions.filter((position) =>
    position.planId === input.planId
    && (input.scopeOrgUnitId == null || position.orgUnitId === input.scopeOrgUnitId)
    && position.status !== "closed"
  );
  const planPositionIds = new Set(planRows.map((row) => row.id));
  const activeAssignments = input.assignments.filter((assignment) =>
    planPositionIds.has(assignment.positionId) && activeOn(assignment, input.asOf)
  );
  const assignmentsByPosition = new Map<number, HeadcountPlanAssignment[]>();
  for (const assignment of activeAssignments) {
    assignmentsByPosition.set(
      assignment.positionId,
      [...(assignmentsByPosition.get(assignment.positionId) ?? []), assignment],
    );
  }

  const total = summarizeRows(planRows, assignmentsByPosition, null);
  const filledPositionsWithoutActiveAssignment = planRows
    .filter((row) => row.status === "filled" && !(assignmentsByPosition.get(row.id)?.length))
    .map((row) => row.id)
    .sort((a, b) => a - b);
  const activeAssignmentsOnNonFilledPositions = planRows
    .filter((row) => row.status !== "filled" && Boolean(assignmentsByPosition.get(row.id)?.length))
    .map((row) => row.id)
    .sort((a, b) => a - b);

  return {
    ...total,
    vacantApprovedHeadcount: Math.max(0, total.approvedHeadcount - total.filledHeadcount),
    positionIds: planRows.map((row) => row.id).sort((a, b) => a - b),
    dimensions: {
      orgUnits: groupDimension(planRows, assignmentsByPosition, (row) => row.orgUnitId),
      costCenters: groupDimension(planRows, assignmentsByPosition, (row) => row.costCenterId),
      jobProfiles: groupDimension(planRows, assignmentsByPosition, (row) => row.jobProfileId),
    },
    quality: {
      filledPositionsWithoutActiveAssignment,
      activeAssignmentsOnNonFilledPositions,
    },
  };
}

export function compareHeadcountPlanSummary(
  baseline: HeadcountPlanSummary,
  actual: HeadcountPlanSummary,
) {
  return {
    requestedHeadcount: actual.requestedHeadcount - baseline.requestedHeadcount,
    approvedHeadcount: actual.approvedHeadcount - baseline.approvedHeadcount,
    filledHeadcount: actual.filledHeadcount - baseline.filledHeadcount,
    vacantApprovedHeadcount: actual.vacantApprovedHeadcount - baseline.vacantApprovedHeadcount,
    requestedFte: round4(actual.requestedFte - baseline.requestedFte),
    approvedFte: round4(actual.approvedFte - baseline.approvedFte),
    filledFte: round4(actual.filledFte - baseline.filledFte),
    annualPositionBudget: round2(actual.annualPositionBudget - baseline.annualPositionBudget),
  };
}
