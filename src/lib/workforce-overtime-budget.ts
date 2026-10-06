export type OvertimeBudgetEnforcement = "advisory" | "block";

export type OvertimeBudgetSnapshot = {
  budgetId: number | null;
  orgUnitId: number | null;
  periodMonth: string;
  budgetMinutes: number | null;
  approvedMinutes: number;
  pendingMinutes: number;
  remainingMinutes: number | null;
  projectedApprovedMinutes: number;
  projectedRemainingMinutes: number | null;
  overBudget: boolean;
  enforcementMode: OvertimeBudgetEnforcement | "none";
  managerUserId: number | null;
  approvalBlocked: boolean;
  approvalBlockReason: string | null;
  payrollEntitlementIndependent: true;
};

function wholeMinutes(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

export function monthForWorkDate(workDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    throw new Error("workDate must use YYYY-MM-DD.");
  }
  return workDate.slice(0, 7);
}

export function evaluateOvertimeBudget(input: {
  budget?: {
    id: number;
    orgUnitId: number;
    periodMonth: string;
    budgetMinutes: number;
    enforcementMode: string;
    managerUserId?: number | null;
    active?: boolean;
  } | null;
  approvedMinutes: number;
  pendingMinutes: number;
  requestedMinutes: number;
  requestKind: string;
}) : OvertimeBudgetSnapshot {
  const approvedMinutes = wholeMinutes(input.approvedMinutes);
  const pendingMinutes = wholeMinutes(input.pendingMinutes);
  const requestedMinutes = wholeMinutes(input.requestedMinutes);
  const budget = input.budget && input.budget.active !== false ? input.budget : null;

  if (!budget) {
    return {
      budgetId: null,
      orgUnitId: null,
      periodMonth: "",
      budgetMinutes: null,
      approvedMinutes,
      pendingMinutes,
      remainingMinutes: null,
      projectedApprovedMinutes: approvedMinutes + requestedMinutes,
      projectedRemainingMinutes: null,
      overBudget: false,
      enforcementMode: "none",
      managerUserId: null,
      approvalBlocked: false,
      approvalBlockReason: null,
      payrollEntitlementIndependent: true,
    };
  }

  const budgetMinutes = wholeMinutes(budget.budgetMinutes);
  const projectedApprovedMinutes = approvedMinutes + requestedMinutes;
  const remainingMinutes = budgetMinutes - approvedMinutes;
  const projectedRemainingMinutes = budgetMinutes - projectedApprovedMinutes;
  const overBudget = projectedApprovedMinutes > budgetMinutes;
  const enforcementMode: OvertimeBudgetEnforcement =
    budget.enforcementMode === "block" ? "block" : "advisory";

  // A hard budget is a forward-looking authorization control. Emergency
  // post-approval records work that has already happened, so it is never
  // prevented from being recorded merely because the budget was exceeded.
  const approvalBlocked =
    overBudget
    && enforcementMode === "block"
    && input.requestKind === "pre_approved";

  return {
    budgetId: budget.id,
    orgUnitId: budget.orgUnitId,
    periodMonth: budget.periodMonth,
    budgetMinutes,
    approvedMinutes,
    pendingMinutes,
    remainingMinutes,
    projectedApprovedMinutes,
    projectedRemainingMinutes,
    overBudget,
    enforcementMode,
    managerUserId: budget.managerUserId ?? null,
    approvalBlocked,
    approvalBlockReason: approvalBlocked
      ? "Approving this pre-approved overtime request would exceed the organization-unit OT budget."
      : null,
    payrollEntitlementIndependent: true,
  };
}

export function summarizeOvertimeBudget(input: {
  budgetMinutes: number;
  approvedMinutes: number;
  pendingMinutes: number;
}) {
  const budgetMinutes = wholeMinutes(input.budgetMinutes);
  const approvedMinutes = wholeMinutes(input.approvedMinutes);
  const pendingMinutes = wholeMinutes(input.pendingMinutes);
  return {
    budgetMinutes,
    approvedMinutes,
    pendingMinutes,
    remainingMinutes: budgetMinutes - approvedMinutes,
    committedPercent: budgetMinutes > 0
      ? Math.round((approvedMinutes / budgetMinutes) * 10_000) / 100
      : approvedMinutes > 0 ? 100 : 0,
    pendingIfApprovedMinutes: approvedMinutes + pendingMinutes,
    pendingIfApprovedPercent: budgetMinutes > 0
      ? Math.round(((approvedMinutes + pendingMinutes) / budgetMinutes) * 10_000) / 100
      : approvedMinutes + pendingMinutes > 0 ? 100 : 0,
    overBudget: approvedMinutes > budgetMinutes,
    projectedOverBudget: approvedMinutes + pendingMinutes > budgetMinutes,
  };
}
