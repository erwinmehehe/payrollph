import { paidShiftMinutes } from "@/lib/workforce-labor-variance";
import type { RecoveryDraft } from "@/lib/workforce-recovery-draft";

/**
 * Read-only labor and coverage projection over an already-governed recovery
 * draft. This is NOT a payroll calculation or approval of future work.
 */
export type PlanningCoverageRow = {
  requirementId: number;
  workDate: string;
  worksiteId: number;
  shiftDefinitionId: number;
  requiredHeadcount: number;
  availableScheduledHeadcount: number;
  gap: number;
};

export type PlanningShift = {
  id: number;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  spansMidnight: boolean;
};

export type PlanningLaborEvidence = {
  costVisible: boolean;
  costingBoundary: string;
  rows: Array<{
    requirementId: number;
    benchmarkHourlyRate: number | null;
    requiredCostBasis: string | null;
  }>;
  quality: {
    missingPayProfileEmployeeIds: number[];
    invalidPayProfileEmployeeIds: number[];
  };
};

export type PlanningRequirementPreview = {
  requirementId: number;
  workDate: string;
  worksiteId: number;
  shiftDefinitionId: number;
  requiredHeadcount: number;
  availableScheduledHeadcount: number;
  baselineGap: number;
  proposedFills: number;
  projectedAvailableHeadcount: number;
  projectedGap: number;
  estimatedAddedBaseCost: number | null;
  costBasis: string | null;
};

export type WorkforcePlanningPreview = {
  rows: PlanningRequirementPreview[];
  uncoveredBefore: number;
  uncoveredAfter: number;
  proposedAssignments: number;
  unresolvedRequirements: number;
  costStatus: "estimated" | "restricted" | "incomplete";
  estimatedAdditionalBaseCost: number | null;
  unpricedAssignments: number;
  costBases: string[];
  costingBoundary: string;
  evidenceWarnings: string[];
};

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

const VALID_COST_BASIS = new Set([
  "scheduled-mix", "actual-mix", "workspace-average",
]);

export function previewWorkforceRecovery(input: {
  draft: RecoveryDraft;
  coverage: readonly PlanningCoverageRow[];
  shifts: readonly PlanningShift[];
  labor: PlanningLaborEvidence | null;
}): WorkforcePlanningPreview {
  const coverage = input.coverage.filter((row) => row.gap > 0);
  const rateByRequirement = new Map(input.labor?.rows.map((row) =>
    [row.requirementId, row] as const
  ) ?? []);
  const shiftById = new Map(input.shifts.map((row) => [row.id, row]));
  const fillsByRequirement = new Map<number, number>();
  const warnings: string[] = [];
  const costsByRequirement = new Map<number, { amount: number; basis: string }>();
  let unpriced = 0;

  for (const fill of input.draft.fills) {
    fillsByRequirement.set(
      fill.requirementId, (fillsByRequirement.get(fill.requirementId) ?? 0) + 1,
    );
  }

  const baseline = coverage.reduce((total, row) => total + row.gap, 0);
  const coveredRequirementIds = new Set(coverage.map((row) => row.requirementId));
  const invalidDistribution = input.draft.fills.some((fill) =>
    !coveredRequirementIds.has(fill.requirementId)
  ) || coverage.some((row) =>
    !Number.isSafeInteger(row.gap) || !Number.isSafeInteger(row.availableScheduledHeadcount)
    || row.availableScheduledHeadcount < 0 || row.requiredHeadcount < 0
    || (fillsByRequirement.get(row.requirementId) ?? 0) > row.gap
  ) || baseline !== input.draft.baselineGap ||
    input.draft.projectedGap !== Math.max(0, baseline - input.draft.fills.length);

  if (invalidDistribution) warnings.push("Recovery proposal and staffing demand do not reconcile.");

  const allowedToSeeCosts = Boolean(input.labor?.costVisible);
  const badPayEvidence = Boolean(input.labor &&
    (input.labor.quality.missingPayProfileEmployeeIds.length > 0
      || input.labor.quality.invalidPayProfileEmployeeIds.length > 0));
  if (allowedToSeeCosts && badPayEvidence) {
    warnings.push("Employee pay-rate evidence is incomplete; do not rely on a monetary estimate.");
  }

  for (const row of coverage) {
    const proposed = fillsByRequirement.get(row.requirementId) ?? 0;
    if (!proposed || !allowedToSeeCosts || badPayEvidence || invalidDistribution) continue;
    const rateEvidence = rateByRequirement.get(row.requirementId);
    const shift = shiftById.get(row.shiftDefinitionId);
    const rate = rateEvidence?.benchmarkHourlyRate;
    if (!shift || rate == null || !Number.isFinite(rate) || rate <= 0 ||
        !rateEvidence?.requiredCostBasis ||
        !VALID_COST_BASIS.has(rateEvidence.requiredCostBasis)) {
      unpriced += proposed;
      continue;
    }
    let paidMinutes: number;
    try {
      paidMinutes = paidShiftMinutes(shift);
    } catch {
      unpriced += proposed;
      continue;
    }
    if (!Number.isFinite(paidMinutes) || paidMinutes <= 0) {
      unpriced += proposed;
      continue;
    }
    const amount = money((paidMinutes / 60) * rate * proposed);
    if (!Number.isFinite(amount) || amount < 0) {
      unpriced += proposed;
      continue;
    }
    costsByRequirement.set(row.requirementId, {
      amount, basis: rateEvidence.requiredCostBasis,
    });
  }

  let costStatus: WorkforcePlanningPreview["costStatus"] = allowedToSeeCosts
    ? "estimated" : "restricted";
  if (allowedToSeeCosts && (badPayEvidence || invalidDistribution || unpriced > 0)) {
    costStatus = "incomplete";
  }

  // Do not show a misleading partial sum when even one proposed assignment is
  // unpriced, or when the viewer lacks Payroll/People cost permission.
  const showMoney = costStatus === "estimated";
  const rows: PlanningRequirementPreview[] = coverage.map((row) => {
    const fills = fillsByRequirement.get(row.requirementId) ?? 0;
    const priced = costsByRequirement.get(row.requirementId);
    return {
      requirementId: row.requirementId,
      workDate: row.workDate,
      worksiteId: row.worksiteId,
      shiftDefinitionId: row.shiftDefinitionId,
      requiredHeadcount: row.requiredHeadcount,
      availableScheduledHeadcount: row.availableScheduledHeadcount,
      baselineGap: row.gap,
      proposedFills: fills,
      projectedAvailableHeadcount: row.availableScheduledHeadcount + fills,
      projectedGap: Math.max(0, row.gap - fills),
      estimatedAddedBaseCost: showMoney ? priced?.amount ?? 0 : null,
      costBasis: showMoney ? priced?.basis ?? null : null,
    };
  });

  const uncoveredAfter = rows.reduce((total, row) => total + row.projectedGap, 0);
  return {
    rows,
    uncoveredBefore: baseline,
    uncoveredAfter,
    proposedAssignments: input.draft.fills.length,
    unresolvedRequirements: rows.filter((row) => row.projectedGap > 0).length,
    costStatus,
    estimatedAdditionalBaseCost: showMoney
      ? money(rows.reduce((total, row) => total + (row.estimatedAddedBaseCost ?? 0), 0))
      : null,
    unpricedAssignments: unpriced,
    costBases: showMoney ? [...new Set(rows.map((row) => row.costBasis).filter(
      (basis): basis is string => Boolean(basis),
    ))] : [],
    costingBoundary: input.labor?.costingBoundary ??
      "Base-pay planning estimate only; no payroll release is calculated.",
    evidenceWarnings: warnings,
  };
}
