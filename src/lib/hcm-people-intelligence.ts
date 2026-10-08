/**
 * Decision-grade, aggregate-only People Intelligence.
 *
 * Historical status uses applied worker employment events, NEVER future-dated
 * transactions or the employee's mutable current status. When no supported
 * history exists we say "unverified" rather than fabricate a prior headcount.
 * Position status/requisitions/compensation cycles are current-state ledgers
 * without complete historical status history; never backdate those metrics.
 */
export type HcmAnalyticsWorker = {
  id: number;
  startDate: string;
  status: string;
  orgUnitId: number | null;
  employmentType: string;
};
export type HcmAnalyticsEmploymentEvent = {
  id: number;
  employeeId: number;
  effectiveDate: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  fromOrgUnitId: number | null;
  toOrgUnitId: number | null;
};
export type HcmAnalyticsPosition = {
  id: number;
  status: string;
  orgUnitId: number | null;
  annualBudget: string;
};
export type HcmAnalyticsAssignment = {
  employeeId: number;
  positionId: number;
  fte: string;
  assignmentType: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
};
export type HcmAnalyticsRequisition = {
  id: number;
  positionId: number | null;
  status: string;
  createdAt: string;
};
export type HcmAnalyticsApplicant = {
  requisitionId: number;
  hiredAt: string | null;
};
export type HcmAnalyticsSeparation = {
  employeeId: number;
  status: string;
  lastDay: string;
};
export type HcmAnalyticsPayroll = {
  status: string;
  payDate: string;
  grossPay: string;
  netPay: string;
};
export type HcmAnalyticsCycle = {
  id: number;
  status: string;
  budgetPool: string;
};
export type HcmAnalyticsProposal = {
  cycleId: number;
  status: string;
  currentAnnual: string;
  proposedAnnual: string;
};
export type HcmAnalyticsUnit = { id: number; name: string };

export type PeopleIntelligenceSummary = {
  asOf: string;
  windowStart: string;
  windowDays: number;
  historical: boolean;
  coverage: { eligible: number; verified: number; unverified: number; percent: number };
  headcount: number | null;
  hires: number;
  completedExits: number;
  turnoverRate: number | null;
  assignedFte: number | null;
  vacantPositions: number | null;
  activeRequisitions: number | null;
  recordedAnnualVacancyBudget: number | null;
  medianHireDays: number | null;
  approvedCompensationDeltaAnnual: number | null;
  activeCycleBudget: number | null;
  releasedPayrollGross: number | null;
  releasedPayrollNet: number | null;
  releasedRunCount: number;
  trends: Array<{ date: string; headcount: number | null; verified: number; eligible: number }>;
  units: Array<{ orgUnit: string; headcount: number }> | null;
  warnings: string[];
};

function money(value: string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return numeric;
}

/**
 * Locale-independent Philippine business date. `en-CA` formatting is not
 * guaranteed to produce YYYY-MM-DD on every Node/ICU deployment.
 */
export function hcmManilaDay(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid People Intelligence timestamp.");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const part = (kind: "year" | "month" | "day") =>
    parts.find((entry) => entry.type === kind)?.value;
  const year = part("year"), month = part("month"), day = part("day");
  if (!year || !month || !day) throw new Error("Cannot construct Philippine business date.");
  return `${year}-${month}-${day}`;
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const utc = new Date(value + "T00:00:00Z");
  return Number.isFinite(utc.getTime()) && utc.toISOString().slice(0, 10) === value;
}

export function hcmAnalyticsDate(value: string, today: string): string {
  if (!validDate(value) || !validDate(today) || value > today) {
    throw new Error("asOf must be a valid YYYY-MM-DD date no later than today's Philippine business date.");
  }
  return value;
}

export function hcmDateOffset(value: string, days: number): string {
  if (!validDate(value) || !Number.isInteger(days) || Math.abs(days) > 400) {
    throw new Error("Invalid HCM analytics date range.");
  }
  const day = new Date(value + "T00:00:00Z");
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

const PRESENT = new Set(["active", "on leave", "leave", "disciplinary", "separating", "probationary"]);
const ABSENT = new Set(["separated", "terminated", "inactive", "dismissed", "archived"]);

export function hcmWorkerStatusAt(
  worker: HcmAnalyticsWorker,
  events: HcmAnalyticsEmploymentEvent[],
  asOf: string,
  today: string,
): "present" | "absent" | "not_started" | "unverified" {
  if (worker.startDate > asOf) return "not_started";
  let status: string | null = null;
  if (asOf === today) {
    status = worker.status;
  } else {
    const related = events.filter((row) => row.employeeId === worker.id)
      .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.id - b.id);
    const earlier = related.filter((row) => row.effectiveDate <= asOf && row.toStatus);
    if (earlier.length > 0) {
      status = earlier[earlier.length - 1].toStatus;
    } else {
      // The first future applied event may document the prior state. A
      // scheduled/approval event is not present in this applied event ledger.
      const future = related.find((row) => row.effectiveDate > asOf && row.fromStatus);
      status = future?.fromStatus ?? null;
    }
  }
  if (status == null) return "unverified";
  const normalized = status.trim().toLowerCase();
  if (PRESENT.has(normalized)) return "present";
  if (ABSENT.has(normalized)) return "absent";
  return "unverified";
}

function snapshot(input: {
  workers: HcmAnalyticsWorker[];
  events: HcmAnalyticsEmploymentEvent[];
  asOf: string;
  today: string;
}) {
  const states = new Map<number, ReturnType<typeof hcmWorkerStatusAt>>();
  let headcount = 0;
  let verified = 0;
  let unverified = 0;
  let eligible = 0;
  for (const worker of input.workers) {
    const state = hcmWorkerStatusAt(worker, input.events, input.asOf, input.today);
    states.set(worker.id, state);
    if (state === "not_started") continue;
    eligible++;
    if (state === "unverified") {
      unverified++;
    } else {
      verified++;
      if (state === "present") headcount++;
    }
  }
  return {
    states,
    eligible,
    verified,
    unverified,
    coveragePct: eligible === 0 ? 100 : Number((verified / eligible * 100).toFixed(1)),
    headcount: unverified ? null : headcount,
  };
}

function monthSnapshots(asOf: string): string[] {
  const dates: string[] = [];
  const [year, month] = asOf.split("-").map(Number);
  for (let i = 5; i >= 1; i--) {
    const day = new Date(Date.UTC(year, month - i, 0));
    dates.push(day.toISOString().slice(0, 10));
  }
  dates.push(asOf);
  return dates;
}

function median(numbers: number[]): number | null {
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return Number((sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2).toFixed(1));
}

const MS_PER_DAY = 86_400_000;
function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / MS_PER_DAY);
}

export function summarizeHcmPeopleIntelligence(input: {
  asOf: string;
  today: string;
  windowDays: number;
  workers: HcmAnalyticsWorker[];
  events: HcmAnalyticsEmploymentEvent[];
  positions: HcmAnalyticsPosition[];
  assignments: HcmAnalyticsAssignment[];
  requisitions: HcmAnalyticsRequisition[];
  applicants: HcmAnalyticsApplicant[];
  separations: HcmAnalyticsSeparation[];
  payrollRuns: HcmAnalyticsPayroll[];
  cycles: HcmAnalyticsCycle[];
  proposals: HcmAnalyticsProposal[];
  units: HcmAnalyticsUnit[];
}): PeopleIntelligenceSummary {
  const asOf = hcmAnalyticsDate(input.asOf, input.today);
  if (![30, 90, 180, 365].includes(input.windowDays)) {
    throw new Error("The People Intelligence window must be 30, 90, 180 or 365 days.");
  }
  const windowStart = hcmDateOffset(asOf, 1 - input.windowDays);
  const historical = asOf !== input.today;
  const current = snapshot({ workers: input.workers, events: input.events, asOf, today: input.today });
  const starting = snapshot({
    workers: input.workers,
    events: input.events,
    asOf: hcmDateOffset(windowStart, -1),
    today: input.today,
  });
  const hires = input.workers.filter((row) => row.startDate >= windowStart && row.startDate <= asOf).length;
  // Only released final-pay separation evidence counts as a completed exit;
  // draft/approved packages and "Separating" do not count as leavers.
  const completedExits = new Set(input.separations.filter((row) =>
    row.status === "released" && row.lastDay >= windowStart && row.lastDay <= asOf)
    .map((row) => `${row.employeeId}:${row.lastDay}`)).size;
  const avgHeadcount = starting.headcount != null && current.headcount != null
    ? (starting.headcount + current.headcount) / 2 : null;
  const turnoverRate = avgHeadcount != null && avgHeadcount > 0
    ? Number((completedExits / avgHeadcount * 100).toFixed(1)) : null;
  const activeWorkerIds = new Set([...current.states.entries()]
    .filter(([, state]) => state === "present").map(([id]) => id));
  const liveAssignments = input.assignments.filter((row) =>
    row.assignmentType === "primary"
    && row.effectiveFrom <= asOf
    && (row.effectiveUntil == null || row.effectiveUntil >= asOf));
  const doubleAssigned = liveAssignments.some((row, idx) =>
    liveAssignments.findIndex((other) => other.employeeId === row.employeeId) !== idx);
  const invalidFte = liveAssignments.some((row) =>
    !Number.isFinite(Number(row.fte)) || Number(row.fte) < 0 || Number(row.fte) > 1);
  const assignedFte = current.unverified || doubleAssigned || invalidFte
    ? null : Number(liveAssignments.filter((row) => activeWorkerIds.has(row.employeeId))
      .reduce((sum, row) => sum + Number(row.fte), 0).toFixed(2));

  const occupiedPositionIds = new Set(liveAssignments.map((row) => row.positionId));
  const eligibleVacancies = historical ? [] : input.positions.filter((row) =>
    (row.status === "approved" || row.status === "open") && !occupiedPositionIds.has(row.id));
  const recordedAnnualVacancyBudget = historical ? null
    : eligibleVacancies.every((row) => money(row.annualBudget) != null)
      ? Number(eligibleVacancies.reduce((sum, row) => sum + Number(row.annualBudget), 0).toFixed(2))
      : null;
  const activeRequisitions = historical ? null
    : input.requisitions.filter((row) => ["open", "interviewing"].includes(row.status)).length;

  const recruitments = new Map(input.requisitions.map((row) => [row.id, row]));
  const hireDays: number[] = [];
  for (const applicant of input.applicants) {
    if (!applicant.hiredAt) continue;
    const hiredDate = hcmManilaDay(applicant.hiredAt);
    if (hiredDate < windowStart || hiredDate > asOf) continue;
    const req = recruitments.get(applicant.requisitionId);
    if (!req) continue;
    const reqCreated = hcmManilaDay(req.createdAt);
    const days = daysBetween(reqCreated, hiredDate);
    if (days >= 0 && days <= 3650) hireDays.push(days);
  }

  const releasedRuns = input.payrollRuns.filter((row) =>
    row.status.toLowerCase() === "released" && row.payDate >= windowStart && row.payDate <= asOf);
  const releasedPayrollGross = releasedRuns.reduce((sum, row) => sum + Number(row.grossPay), 0);
  const releasedPayrollNet = releasedRuns.reduce((sum, row) => sum + Number(row.netPay), 0);
  const safeGross = Number.isFinite(releasedPayrollGross) && releasedPayrollGross >= 0
    && releasedRuns.every((row) => money(row.grossPay) != null)
    ? Number(releasedPayrollGross.toFixed(2)) : null;
  const safeNet = Number.isFinite(releasedPayrollNet) && releasedPayrollNet >= 0
    && releasedRuns.every((row) => money(row.netPay) != null)
    ? Number(releasedPayrollNet.toFixed(2)) : null;

  const activeCycles = input.cycles.filter((row) => row.status === "active");
  const cycleIds = new Set(activeCycles.map((row) => row.id));
  const cycleBudgetsValid = activeCycles.every((row) => money(row.budgetPool) != null);
  const activeCycleBudget = historical || !cycleBudgetsValid ? null
    : Number(activeCycles.reduce((sum, row) => sum + Number(row.budgetPool), 0).toFixed(2));
  const acceptedProposals = input.proposals.filter((row) =>
    cycleIds.has(row.cycleId) && ["approved", "scheduled", "applied"].includes(row.status));
  const approvedCompensationDeltaAnnual = historical
    || acceptedProposals.some((row) => money(row.currentAnnual) == null || money(row.proposedAnnual) == null)
    ? null
    : Number(acceptedProposals.reduce((sum, row) =>
        sum + Number(row.proposedAnnual) - Number(row.currentAnnual), 0).toFixed(2));

  const trends = monthSnapshots(asOf).map((date) => {
    const point = snapshot({ workers: input.workers, events: input.events, asOf: date, today: input.today });
    return { date, headcount: point.headcount, eligible: point.eligible, verified: point.verified };
  });

  // Do not permit differencing a suppressed small org group from a
  // company-wide total. Suppress the ENTIRE breakdown if any cell is under 5.
  let units: PeopleIntelligenceSummary["units"] = null;
  if (!historical && current.headcount != null) {
    const unitNames = new Map(input.units.map((row) => [row.id, row.name]));
    const grouped = new Map<number | null, number>();
    for (const worker of input.workers) {
      if (current.states.get(worker.id) !== "present") continue;
      grouped.set(worker.orgUnitId, (grouped.get(worker.orgUnitId) ?? 0) + 1);
    }
    if ([...grouped.values()].every((value) => value >= 5)) {
      units = [...grouped.entries()].map(([id, headcount]) => ({
        orgUnit: id == null ? "Unassigned unit" : unitNames.get(id) ?? "Unknown unit",
        headcount,
      })).sort((a, b) => b.headcount - a.headcount || a.orgUnit.localeCompare(b.orgUnit));
    }
  }

  const warnings: string[] = [];
  if (current.unverified) warnings.push(
    `${current.unverified} worker records lack verifiable status at ${asOf}; headcount and turnover are withheld rather than inferred.`);
  if (starting.unverified) warnings.push(
    `${starting.unverified} worker records lack verifiable status at the window start; turnover is unavailable.`);
  if (historical) warnings.push(
    "Historical position status, open requisitions and compensation-cycle balances cannot be reconstructed from current-state ledgers; those metrics are not shown for past dates.");
  if (doubleAssigned || invalidFte) warnings.push(
    "Overlapping primary position assignments or invalid FTE prevent a trustworthy staffing FTE total.");
  if (!historical && units == null && current.headcount != null) warnings.push(
    "Unit-level headcounts are suppressed because at least one unit has fewer than five people; totals remain available.");
  if (releasedRuns.some((row) => money(row.grossPay) == null || money(row.netPay) == null)) warnings.push(
    "A released payroll run contains invalid recorded amounts; verify the payroll ledger before using cost totals.");
  if (avgHeadcount === 0) warnings.push("Turnover is unavailable where average verified headcount is zero.");
  if (activeCycles.some((row) => money(row.budgetPool) == null)) warnings.push(
    "A compensation cycle has invalid budget evidence; active review budgets are withheld.");

  return {
    asOf, windowStart, windowDays: input.windowDays, historical,
    coverage: {
      eligible: current.eligible, verified: current.verified, unverified: current.unverified,
      percent: current.coveragePct,
    },
    headcount: current.headcount, hires, completedExits, turnoverRate,
    assignedFte,
    vacantPositions: historical ? null : eligibleVacancies.length,
    activeRequisitions,
    recordedAnnualVacancyBudget,
    medianHireDays: median(hireDays),
    approvedCompensationDeltaAnnual, activeCycleBudget,
    releasedPayrollGross: safeGross, releasedPayrollNet: safeNet,
    releasedRunCount: releasedRuns.length,
    trends, units, warnings,
  };
}
