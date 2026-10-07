export type PlanDemandPosition = {
  id: number;
  planId: number | null;
  jobProfileId: number;
  orgUnitId: number | null;
  status: string;
};

export type PlanRoleDemand = {
  jobProfileId: number;
  authorizedHeadcount: number;
  filledHeadcount: number;
  vacantHeadcount: number;
  positionIds: number[];
};

const AUTHORIZED_STATUSES = new Set(["approved", "open", "filled"]);

export function summarizePlanRoleDemand(input: {
  planId: number;
  orgUnitId: number | null;
  positions: PlanDemandPosition[];
}): PlanRoleDemand[] {
  const groups = new Map<number, PlanDemandPosition[]>();
  for (const position of input.positions) {
    if (position.planId !== input.planId) continue;
    if (!AUTHORIZED_STATUSES.has(position.status)) continue;
    if (input.orgUnitId != null && position.orgUnitId !== input.orgUnitId) continue;
    groups.set(position.jobProfileId, [...(groups.get(position.jobProfileId) ?? []), position]);
  }

  return [...groups.entries()]
    .map(([jobProfileId, rows]) => ({
      jobProfileId,
      authorizedHeadcount: rows.length,
      filledHeadcount: rows.filter((row) => row.status === "filled").length,
      vacantHeadcount: rows.filter((row) => row.status !== "filled").length,
      positionIds: rows.map((row) => row.id).sort((a, b) => a - b),
    }))
    .sort((a, b) => a.jobProfileId - b.jobProfileId);
}

export function validatePlanDemandHeadcount(input: {
  requestedHeadcount: number;
  role: PlanRoleDemand | null;
}) {
  if (!Number.isInteger(input.requestedHeadcount) || input.requestedHeadcount < 1) {
    throw new Error("Required headcount must be a positive whole number.");
  }
  if (!input.role || input.role.authorizedHeadcount < 1) {
    throw new Error("The selected workforce plan has no approved/open/filled position for this role and organization unit.");
  }
  if (input.requestedHeadcount > input.role.authorizedHeadcount) {
    throw new Error(
      `Required headcount ${input.requestedHeadcount} exceeds the plan-authorized headcount of ${input.role.authorizedHeadcount} for this role.`,
    );
  }
}

export function demandDates(startDate: string, endDate: string, maxDays = 14) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error("Demand dates must use YYYY-MM-DD.");
  }
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (end < start) throw new Error("Demand end date cannot precede start date.");

  const dates: string[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
    if (dates.length > maxDays) {
      throw new Error(`Demand handoff cannot exceed ${maxDays} days at a time.`);
    }
  }
  return dates;
}
