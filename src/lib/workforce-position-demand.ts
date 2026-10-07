export type PositionDemandRuleInput = {
  id: number;
  positionId: number;
  positionStatus: string;
  jobProfileId: number;
  worksiteId: number;
  shiftDefinitionId: number;
  weekdays: number[];
  effectiveFrom: string;
  effectiveUntil: string | null;
  requiredHeadcount: number;
  active: boolean;
};

export type PositionDemandRequirement = {
  worksiteId: number;
  workDate: string;
  shiftDefinitionId: number;
  jobProfileId: number;
  requiredHeadcount: number;
  sourceRefs: Array<{ positionId: number; demandRuleId: number }>;
};

const DEMAND_POSITION_STATUSES = new Set(["approved", "open", "filled"]);

function isoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dateRange(startDate: string, endDate: string, maxDays = 366) {
  if (!isoDate(startDate) || !isoDate(endDate) || endDate < startDate) {
    throw new Error("Demand window requires valid YYYY-MM-DD dates.");
  }
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const rows: string[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    rows.push(cursor.toISOString().slice(0, 10));
    if (rows.length > maxDays) throw new Error(`Demand window cannot exceed ${maxDays} days.`);
  }
  return rows;
}

export function normalizeDemandWeekdays(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    .sort((a, b) => a - b);
}

export function buildPositionDemandRequirements(input: {
  startDate: string;
  endDate: string;
  rules: PositionDemandRuleInput[];
}): PositionDemandRequirement[] {
  const dates = dateRange(input.startDate, input.endDate);
  const grouped = new Map<string, PositionDemandRequirement>();

  for (const rule of input.rules) {
    if (!rule.active || !DEMAND_POSITION_STATUSES.has(rule.positionStatus)) continue;
    if (!Number.isInteger(rule.requiredHeadcount) || rule.requiredHeadcount <= 0) continue;
    const weekdays = normalizeDemandWeekdays(rule.weekdays);
    if (weekdays.length === 0) continue;

    for (const workDate of dates) {
      if (workDate < rule.effectiveFrom) continue;
      if (rule.effectiveUntil && workDate > rule.effectiveUntil) continue;
      const weekday = new Date(`${workDate}T00:00:00Z`).getUTCDay();
      if (!weekdays.includes(weekday)) continue;

      const key = [rule.worksiteId, workDate, rule.shiftDefinitionId, rule.jobProfileId].join("|");
      const current = grouped.get(key) ?? {
        worksiteId: rule.worksiteId,
        workDate,
        shiftDefinitionId: rule.shiftDefinitionId,
        jobProfileId: rule.jobProfileId,
        requiredHeadcount: 0,
        sourceRefs: [],
      };
      current.requiredHeadcount += rule.requiredHeadcount;
      current.sourceRefs.push({ positionId: rule.positionId, demandRuleId: rule.id });
      grouped.set(key, current);
    }
  }

  return [...grouped.values()]
    .map((row) => ({
      ...row,
      sourceRefs: row.sourceRefs.sort((a, b) => a.positionId - b.positionId || a.demandRuleId - b.demandRuleId),
    }))
    .sort((a, b) =>
      a.workDate.localeCompare(b.workDate)
      || a.worksiteId - b.worksiteId
      || a.shiftDefinitionId - b.shiftDefinitionId
      || a.jobProfileId - b.jobProfileId
    );
}
