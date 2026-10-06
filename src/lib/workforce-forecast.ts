import { resolveLaborAllocation, type LaborAllocationRow } from "./labor-costing";

export type ForecastPayProfile = {
  employeeId: number;
  payBasis: string;
  rateAmount: number | string;
  standardWorkDaysPerMonth: number | string;
  standardHoursPerDay: number | string;
};

export type ForecastEmployee = {
  id: number;
  status: string;
};

export type ForecastPosition = {
  id: number;
  status: string;
  annualBudget: number | string;
  plannedStartDate: string | null;
};

export type ForecastStaffingRequirement = {
  workDate: string;
  shiftDefinitionId: number;
  requiredHeadcount: number;
};

export type ForecastShift = {
  id: number;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  spansMidnight: boolean;
};

export type ForecastCostCenter = {
  id: number;
  code: string;
  name: string;
};

export type WorkforceForecastAssumptions = {
  startDate: string;
  endDate: string;
  demandGrowthPercent: number;
  vacancyFillPercent: number;
  employerLoadPercent: number;
};

const VACANT_POSITION_STATUSES = new Set(["planned", "approved", "open"]);

function number(value: number | string, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label}.`);
  }
  return parsed;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function dateValue(dateText: string) {
  const value = new Date(`${dateText}T00:00:00Z`).getTime();
  if (!Number.isFinite(value)) throw new Error(`Invalid forecast date "${dateText}".`);
  return value;
}

export function inclusiveDays(startDate: string, endDate: string) {
  const start = dateValue(startDate);
  const end = dateValue(endDate);
  if (end < start) throw new Error("Forecast end date cannot be earlier than start date.");
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function annualizePayProfile(profile: ForecastPayProfile) {
  const rate = number(profile.rateAmount, "rate amount");
  const workDays = number(profile.standardWorkDaysPerMonth, "standard work days");
  const hours = number(profile.standardHoursPerDay, "standard hours");
  const basis = profile.payBasis.trim().toLowerCase();

  if (basis === "monthly") return round2(rate * 12);
  if (basis === "daily") return round2(rate * workDays * 12);
  if (basis === "hourly") return round2(rate * hours * workDays * 12);
  throw new Error(`Unsupported pay basis "${profile.payBasis}".`);
}

export function hourlyBaseRate(profile: ForecastPayProfile) {
  const rate = number(profile.rateAmount, "rate amount");
  const workDays = number(profile.standardWorkDaysPerMonth, "standard work days");
  const hours = number(profile.standardHoursPerDay, "standard hours");
  if (hours <= 0 || workDays <= 0) throw new Error("Standard work days and hours must be greater than zero.");

  const basis = profile.payBasis.trim().toLowerCase();
  if (basis === "monthly") return round2(rate / workDays / hours);
  if (basis === "daily") return round2(rate / hours);
  if (basis === "hourly") return round2(rate);
  throw new Error(`Unsupported pay basis "${profile.payBasis}".`);
}

function minuteOfDay(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) throw new Error(`Invalid shift time "${value}".`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Invalid shift time "${value}".`);
  return hours * 60 + minutes;
}

export function paidShiftHours(shift: ForecastShift) {
  const start = minuteOfDay(shift.startTime);
  let end = minuteOfDay(shift.endTime);
  if (shift.spansMidnight || end <= start) end += 24 * 60;
  const paidMinutes = end - start - Math.max(0, shift.breakMinutes);
  if (paidMinutes <= 0 || paidMinutes > 24 * 60) {
    throw new Error(`Shift #${shift.id} has an invalid paid duration.`);
  }
  return Math.round((paidMinutes / 60) * 1000) / 1000;
}

function overlapDays(startDate: string, endDate: string, plannedStartDate: string | null) {
  const effectiveStart = plannedStartDate && plannedStartDate > startDate ? plannedStartDate : startDate;
  if (effectiveStart > endDate) return 0;
  return inclusiveDays(effectiveStart, endDate);
}

export function buildWorkforceDemandForecast(input: {
  assumptions: WorkforceForecastAssumptions;
  employees: ForecastEmployee[];
  payProfiles: ForecastPayProfile[];
  positions: ForecastPosition[];
  staffingRequirements: ForecastStaffingRequirement[];
  shifts: ForecastShift[];
  laborAllocations: LaborAllocationRow[];
  costCenters: ForecastCostCenter[];
}) {
  const {
    startDate,
    endDate,
    demandGrowthPercent,
    vacancyFillPercent,
    employerLoadPercent,
  } = input.assumptions;

  const windowDays = inclusiveDays(startDate, endDate);
  if (windowDays > 366) throw new Error("Forecast window cannot exceed 366 days.");
  if (demandGrowthPercent < -50 || demandGrowthPercent > 200) {
    throw new Error("Demand growth must be between -50% and 200%.");
  }
  if (vacancyFillPercent < 0 || vacancyFillPercent > 100) {
    throw new Error("Vacancy fill must be between 0% and 100%.");
  }
  if (employerLoadPercent < 0 || employerLoadPercent > 100) {
    throw new Error("Employer load must be between 0% and 100%.");
  }

  const profileByEmployee = new Map(input.payProfiles.map((profile) => [profile.employeeId, profile]));
  const activeEmployees = input.employees.filter((employee) => employee.status.trim().toLowerCase() === "active");
  const missingPayProfileEmployeeIds: number[] = [];
  const invalidPayProfileEmployeeIds: number[] = [];
  const annualCostByEmployee = new Map<number, number>();
  const hourlyRates: number[] = [];

  for (const employee of activeEmployees) {
    const profile = profileByEmployee.get(employee.id);
    if (!profile) {
      missingPayProfileEmployeeIds.push(employee.id);
      continue;
    }
    try {
      annualCostByEmployee.set(employee.id, annualizePayProfile(profile));
      hourlyRates.push(hourlyBaseRate(profile));
    } catch {
      invalidPayProfileEmployeeIds.push(employee.id);
    }
  }

  const annualizedBasePayroll = [...annualCostByEmployee.values()].reduce((sum, value) => sum + value, 0);
  const currentPeriodBasePayroll = annualizedBasePayroll * windowDays / 365.25;

  const vacantPositions = input.positions.filter((position) => VACANT_POSITION_STATUSES.has(position.status));
  const vacantAnnualBudget = vacantPositions.reduce((sum, position) => sum + number(position.annualBudget, "position annual budget"), 0);
  const expectedVacancyAnnualCost = vacantAnnualBudget * vacancyFillPercent / 100;
  const expectedVacancyPeriodCost = vacantPositions.reduce((sum, position) => {
    const days = overlapDays(startDate, endDate, position.plannedStartDate);
    const periodBudget = number(position.annualBudget, "position annual budget") * days / 365.25;
    return sum + periodBudget * vacancyFillPercent / 100;
  }, 0);

  const forecastPeriodBasePayroll = currentPeriodBasePayroll + expectedVacancyPeriodCost;
  const employerLoadCost = forecastPeriodBasePayroll * employerLoadPercent / 100;
  const forecastPeriodLaborCost = forecastPeriodBasePayroll + employerLoadCost;
  const annualRunRateBase = annualizedBasePayroll + expectedVacancyAnnualCost;
  const annualRunRateLaborCost = annualRunRateBase * (1 + employerLoadPercent / 100);

  const shiftById = new Map(input.shifts.map((shift) => [shift.id, shift]));
  let requiredHeadcountHours = 0;
  let requirementsMissingShift = 0;
  for (const requirement of input.staffingRequirements) {
    if (requirement.workDate < startDate || requirement.workDate > endDate) continue;
    const shift = shiftById.get(requirement.shiftDefinitionId);
    if (!shift) {
      requirementsMissingShift += 1;
      continue;
    }
    try {
      requiredHeadcountHours += paidShiftHours(shift) * Math.max(0, requirement.requiredHeadcount);
    } catch {
      requirementsMissingShift += 1;
    }
  }
  const forecastHeadcountHours = requiredHeadcountHours * (1 + demandGrowthPercent / 100);
  const averageBaseHourlyRate = hourlyRates.length
    ? hourlyRates.reduce((sum, value) => sum + value, 0) / hourlyRates.length
    : 0;
  const estimatedShiftDemandWageCost = forecastHeadcountHours
    * averageBaseHourlyRate
    * (1 + employerLoadPercent / 100);

  const costCenterById = new Map(input.costCenters.map((center) => [center.id, center]));
  const costCenterCost = new Map<number, number>();
  let unallocatedCurrentPeriodBaseCost = 0;
  const allocationIssueEmployeeIds: number[] = [];

  for (const [employeeId, annualCost] of annualCostByEmployee) {
    const periodCost = annualCost * windowDays / 365.25;
    try {
      const resolved = resolveLaborAllocation({
        employeeId,
        asOf: startDate,
        rows: input.laborAllocations,
      });
      if (resolved.status === "unallocated") {
        unallocatedCurrentPeriodBaseCost += periodCost;
        continue;
      }
      for (const allocation of resolved.allocations) {
        costCenterCost.set(
          allocation.costCenterId,
          (costCenterCost.get(allocation.costCenterId) ?? 0) + periodCost * allocation.percent / 100,
        );
      }
    } catch {
      allocationIssueEmployeeIds.push(employeeId);
      unallocatedCurrentPeriodBaseCost += periodCost;
    }
  }

  const costCenters = [...costCenterCost.entries()]
    .map(([costCenterId, currentPeriodBaseCost]) => {
      const center = costCenterById.get(costCenterId);
      return {
        costCenterId,
        code: center?.code ?? `#${costCenterId}`,
        name: center?.name ?? "Unknown cost center",
        currentPeriodBaseCost: round2(currentPeriodBaseCost),
        currentPeriodLoadedCost: round2(currentPeriodBaseCost * (1 + employerLoadPercent / 100)),
      };
    })
    .sort((a, b) => b.currentPeriodBaseCost - a.currentPeriodBaseCost || a.code.localeCompare(b.code));

  return {
    assumptions: {
      startDate,
      endDate,
      windowDays,
      demandGrowthPercent,
      vacancyFillPercent,
      employerLoadPercent,
    },
    summary: {
      activeHeadcount: activeEmployees.length,
      costedHeadcount: annualCostByEmployee.size,
      vacantPositions: vacantPositions.length,
      expectedVacancyFills: round2(vacantPositions.length * vacancyFillPercent / 100),
      annualizedBasePayroll: round2(annualizedBasePayroll),
      vacantAnnualBudget: round2(vacantAnnualBudget),
      annualRunRateLaborCost: round2(annualRunRateLaborCost),
      currentPeriodBasePayroll: round2(currentPeriodBasePayroll),
      expectedVacancyPeriodCost: round2(expectedVacancyPeriodCost),
      employerLoadCost: round2(employerLoadCost),
      forecastPeriodLaborCost: round2(forecastPeriodLaborCost),
      requiredHeadcountHours: round2(requiredHeadcountHours),
      forecastHeadcountHours: round2(forecastHeadcountHours),
      averageBaseHourlyRate: round2(averageBaseHourlyRate),
      estimatedShiftDemandWageCost: round2(estimatedShiftDemandWageCost),
    },
    costCenters,
    unallocated: {
      currentPeriodBaseCost: round2(unallocatedCurrentPeriodBaseCost),
      plannedVacancyPeriodCost: round2(expectedVacancyPeriodCost),
    },
    quality: {
      missingPayProfileEmployeeIds,
      invalidPayProfileEmployeeIds,
      allocationIssueEmployeeIds,
      staffingRequirements: input.staffingRequirements.length,
      requirementsMissingShift,
    },
  };
}
