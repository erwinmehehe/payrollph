export type OvertimeBudgetPolicyRecord = {
  id: number;
  orgUnitId: number;
  managerUserId: number | null;
  monthStart: string;
  budgetMinutes: number;
  enforcementMode: string;
  active: boolean;
};

export function overtimeBudgetScopeKey(orgUnitId: number, managerUserId: number | null) {
  if (!Number.isInteger(orgUnitId) || orgUnitId <= 0) {
    throw new Error("A positive organization-unit id is required for an overtime budget.");
  }
  if (managerUserId != null && (!Number.isInteger(managerUserId) || managerUserId <= 0)) {
    throw new Error("Manager user id must be a positive integer when supplied.");
  }
  return managerUserId == null ? `unit:${orgUnitId}` : `unit:${orgUnitId}:manager:${managerUserId}`;
}

export function overtimeBudgetMonthStart(workDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    throw new Error("Overtime budget work date must use YYYY-MM-DD.");
  }
  return `${workDate.slice(0, 7)}-01`;
}

export function resolveOvertimeBudgetPolicy(input: {
  policies: OvertimeBudgetPolicyRecord[];
  orgUnitId: number | null;
  managerUserId: number;
  workDate: string;
}) {
  if (input.orgUnitId == null) return null;
  const monthStart = overtimeBudgetMonthStart(input.workDate);
  const candidates = input.policies.filter((policy) =>
    policy.active
    && policy.orgUnitId === input.orgUnitId
    && policy.monthStart === monthStart,
  );
  return candidates.find((policy) => policy.managerUserId === input.managerUserId)
    ?? candidates.find((policy) => policy.managerUserId == null)
    ?? null;
}

export function evaluateOvertimeBudget(input: {
  budgetMinutes: number;
  usedMinutes: number;
  requestedMinutes: number;
  enforcementMode: string;
}) {
  const budgetMinutes = Math.max(0, Math.trunc(Number(input.budgetMinutes) || 0));
  const usedMinutes = Math.max(0, Math.trunc(Number(input.usedMinutes) || 0));
  const requestedMinutes = Math.max(0, Math.trunc(Number(input.requestedMinutes) || 0));
  const projectedMinutes = usedMinutes + requestedMinutes;
  const overageMinutes = Math.max(0, projectedMinutes - budgetMinutes);
  const exceeded = projectedMinutes > budgetMinutes;
  return {
    budgetMinutes,
    usedMinutes,
    requestedMinutes,
    projectedMinutes,
    remainingMinutes: Math.max(0, budgetMinutes - usedMinutes),
    overageMinutes,
    exceeded,
    blocked: exceeded && input.enforcementMode === "blocking",
    enforcementMode: input.enforcementMode === "blocking" ? "blocking" : "advisory",
  };
}
