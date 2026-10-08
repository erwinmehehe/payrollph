import { resolveLaborAllocation, type LaborAllocationRow } from "./labor-costing";
import { computePagIbig, computePhilHealth, computeSss } from "./payroll-rules";

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
  jobProfileId?: number | null;
};

export type ForecastPosition = {
  id: number;
  status: string;
  jobProfileId?: number;
  annualBudget: number | string;
  plannedStartDate: string | null;
};

export type ForecastStaffingRequirement = {
  workDate: string;
  shiftDefinitionId: number;
  jobProfileId?: number | null;
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

export type ForecastJobProfile = {
  id: number;
  title: string;
  family: string;
  level: string;
};

export type ForecastEmployerCost = {
  employeeId: number;
  annualStatutoryEmployer: number;
  annualBenefitEmployer: number;
  annualRecurringCompensation: number;
};

export type WorkforceForecastAssumptions = {
  startDate: string;
  endDate: string;
  demandGrowthPercent: number;
  vacancyFillPercent: number;
  employerLoadPercent: number;
  annualAttritionPercent: number;
  attritionBackfillPercent: number;
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

export function annualEmployerStatutoryCost(annualBasePay: number) {
  const annual = number(annualBasePay, "annual base pay");
  const monthly = annual / 12;
  const sss = computeSss(monthly).employerTotal;
  const philHealth = computePhilHealth(monthly).employer;
  const pagIbig = computePagIbig(monthly).employer;
  return round2((sss + philHealth + pagIbig) * 12);
}

export function annualStandardCapacityHours(profile: ForecastPayProfile) {
  const workDays = number(profile.standardWorkDaysPerMonth, "standard work days");
  const hours = number(profile.standardHoursPerDay, "standard hours");
  if (hours <= 0 || workDays <= 0) {
    throw new Error("Standard work days and hours must be greater than zero.");
  }
  return round2(hours * workDays * 12);
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
  jobProfiles?: ForecastJobProfile[];
  employerCosts?: ForecastEmployerCost[];
}) {
  const {
    startDate,
    endDate,
    demandGrowthPercent,
    vacancyFillPercent,
    employerLoadPercent,
    annualAttritionPercent,
    attritionBackfillPercent,
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
  if (annualAttritionPercent < 0 || annualAttritionPercent > 100) {
    throw new Error("Annual attrition must be between 0% and 100%.");
  }
  if (attritionBackfillPercent < 0 || attritionBackfillPercent > 100) {
    throw new Error("Attrition backfill must be between 0% and 100%.");
  }

  const windowAttritionRate = Math.min(
    1,
    annualAttritionPercent / 100 * windowDays / 365.25,
  );
  const backfillRate = attritionBackfillPercent / 100;

  const profileByEmployee = new Map(input.payProfiles.map((profile) => [profile.employeeId, profile]));
  const activeEmployees = input.employees.filter((employee) => employee.status.trim().toLowerCase() === "active");
  const expectedAttritionExits = activeEmployees.length * windowAttritionRate;
  const plannedAttritionBackfills = expectedAttritionExits * backfillRate;
  const netAttritionRate = windowAttritionRate * (1 - backfillRate);
  // Attrition is modeled as evenly distributed through the window. Approved
  // backfill is treated as same-role replacement for planning only.
  const averageNetAttritionRate = netAttritionRate / 2;
  const missingPayProfileEmployeeIds: number[] = [];
  const invalidPayProfileEmployeeIds: number[] = [];
  const annualCostByEmployee = new Map<number, number>();
  const annualCapacityByEmployee = new Map<number, number>();
  const hourlyRates: number[] = [];

  for (const employee of activeEmployees) {
    const profile = profileByEmployee.get(employee.id);
    if (!profile) {
      missingPayProfileEmployeeIds.push(employee.id);
      continue;
    }
    try {
      annualCostByEmployee.set(employee.id, annualizePayProfile(profile));
      annualCapacityByEmployee.set(employee.id, annualStandardCapacityHours(profile));
      hourlyRates.push(hourlyBaseRate(profile));
    } catch {
      invalidPayProfileEmployeeIds.push(employee.id);
    }
  }

  const annualizedBasePayroll = [...annualCostByEmployee.values()].reduce((sum, value) => sum + value, 0);
  const currentPeriodBasePayroll = annualizedBasePayroll * windowDays / 365.25;

  const employerCostByEmployee = new Map((input.employerCosts ?? []).map((row) => [row.employeeId, row]));
  let annualStatutoryEmployer = 0;
  let annualBenefitEmployer = 0;
  let annualRecurringCompensation = 0;
  const loadedAnnualCostByEmployee = new Map<number, number>();
  for (const [employeeId, annualBase] of annualCostByEmployee) {
    const known = employerCostByEmployee.get(employeeId);
    const statutory = known?.annualStatutoryEmployer ?? 0;
    const benefits = known?.annualBenefitEmployer ?? 0;
    const recurring = known?.annualRecurringCompensation ?? 0;
    annualStatutoryEmployer += statutory;
    annualBenefitEmployer += benefits;
    annualRecurringCompensation += recurring;
    loadedAnnualCostByEmployee.set(employeeId, annualBase + statutory + benefits + recurring);
  }
  const currentPeriodStatutoryEmployer = annualStatutoryEmployer * windowDays / 365.25;
  const currentPeriodBenefitEmployer = annualBenefitEmployer * windowDays / 365.25;
  const currentPeriodRecurringCompensation = annualRecurringCompensation * windowDays / 365.25;
  const currentPeriodCapacityHours = [...annualCapacityByEmployee.values()]
    .reduce((sum, annualHours) => sum + annualHours * windowDays / 365.25, 0);
  const averageAnnualCapacityHours = annualCapacityByEmployee.size
    ? [...annualCapacityByEmployee.values()].reduce((sum, value) => sum + value, 0) / annualCapacityByEmployee.size
    : 0;

  const vacantPositions = input.positions.filter((position) => VACANT_POSITION_STATUSES.has(position.status));
  const vacantAnnualBudget = vacantPositions.reduce((sum, position) => sum + number(position.annualBudget, "position annual budget"), 0);
  const expectedVacancyAnnualCost = vacantAnnualBudget * vacancyFillPercent / 100;
  const expectedVacancyAnnualStatutory = vacantPositions.reduce(
    (sum, position) => sum + annualEmployerStatutoryCost(number(position.annualBudget, "position annual budget")) * vacancyFillPercent / 100,
    0,
  );
  const expectedVacancyPeriodCost = vacantPositions.reduce((sum, position) => {
    const days = overlapDays(startDate, endDate, position.plannedStartDate);
    const periodBudget = number(position.annualBudget, "position annual budget") * days / 365.25;
    return sum + periodBudget * vacancyFillPercent / 100;
  }, 0);
  const expectedVacancyPeriodStatutory = vacantPositions.reduce((sum, position) => {
    const days = overlapDays(startDate, endDate, position.plannedStartDate);
    const annualStatutory = annualEmployerStatutoryCost(number(position.annualBudget, "position annual budget"));
    return sum + annualStatutory * days / 365.25 * vacancyFillPercent / 100;
  }, 0);

  const expectedVacancyCapacityHours = vacantPositions.reduce((sum, position) => {
    const days = overlapDays(startDate, endDate, position.plannedStartDate);
    return sum + averageAnnualCapacityHours * days / 365.25 * vacancyFillPercent / 100;
  }, 0);

  const forecastPeriodBasePayroll = currentPeriodBasePayroll + expectedVacancyPeriodCost;
  const sourceGroundedEmployerCost =
    currentPeriodStatutoryEmployer
    + currentPeriodBenefitEmployer
    + currentPeriodRecurringCompensation
    + expectedVacancyPeriodStatutory;
  const additionalScenarioLoadCost = forecastPeriodBasePayroll * employerLoadPercent / 100;
  const employerLoadCost = sourceGroundedEmployerCost + additionalScenarioLoadCost;
  const forecastPeriodLaborCost = forecastPeriodBasePayroll + employerLoadCost;
  const annualRunRateBase = annualizedBasePayroll + expectedVacancyAnnualCost;
  const annualRunRateKnownLoad =
    annualStatutoryEmployer
    + annualBenefitEmployer
    + annualRecurringCompensation
    + expectedVacancyAnnualStatutory;
  const annualRunRateLaborCost =
    annualRunRateBase + annualRunRateKnownLoad + annualRunRateBase * employerLoadPercent / 100;

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

  const profileById = new Map((input.jobProfiles ?? []).map((profile) => [profile.id, profile]));
  const roleDemandMinutes = new Map<number | null, number>();
  for (const requirement of input.staffingRequirements) {
    if (requirement.workDate < startDate || requirement.workDate > endDate) continue;
    const shift = shiftById.get(requirement.shiftDefinitionId);
    if (!shift) continue;
    try {
      const hours = paidShiftHours(shift) * Math.max(0, requirement.requiredHeadcount);
      const roleId = requirement.jobProfileId ?? null;
      roleDemandMinutes.set(
        roleId,
        (roleDemandMinutes.get(roleId) ?? 0) + hours,
      );
    } catch {
      // The aggregate quality counter already records invalid shift evidence.
    }
  }

  const periodCapacityByEmployee = new Map<number, number>();
  for (const [employeeId, annualHours] of annualCapacityByEmployee) {
    periodCapacityByEmployee.set(employeeId, annualHours * windowDays / 365.25);
  }

  const roleDemand = [...roleDemandMinutes.entries()]
    .map(([jobProfileId, requiredHours]) => {
      const activeRoleEmployees = activeEmployees.filter((employee) =>
        jobProfileId == null || employee.jobProfileId === jobProfileId
      );
      const currentCapacityHoursForRole = activeRoleEmployees.reduce(
        (sum, employee) => sum + (periodCapacityByEmployee.get(employee.id) ?? 0),
        0,
      );
      const vacantRolePositions = vacantPositions.filter((position) =>
        jobProfileId == null || position.jobProfileId === jobProfileId
      );
      const expectedVacancyCapacityHoursForRole = vacantRolePositions.reduce((sum, position) => {
        const days = overlapDays(startDate, endDate, position.plannedStartDate);
        return sum + averageAnnualCapacityHours * days / 365.25 * vacancyFillPercent / 100;
      }, 0);
      const forecastHours = requiredHours * (1 + demandGrowthPercent / 100);
      const projectedHours = currentCapacityHoursForRole + expectedVacancyCapacityHoursForRole;
      const profile = jobProfileId == null ? null : profileById.get(jobProfileId) ?? null;
      return {
        jobProfileId,
        title: profile?.title ?? (jobProfileId == null ? "Any job profile" : `Job profile #${jobProfileId}`),
        family: profile?.family ?? (jobProfileId == null ? "All roles" : "Inactive / unavailable profile"),
        level: profile?.level ?? (jobProfileId == null ? "Mixed" : "Unknown"),
        requiredHours: round2(requiredHours),
        forecastHours: round2(forecastHours),
        activeHeadcount: activeRoleEmployees.length,
        vacantPositions: vacantRolePositions.length,
        expectedVacancyFills: round2(vacantRolePositions.length * vacancyFillPercent / 100),
        currentCapacityHours: round2(currentCapacityHoursForRole),
        expectedVacancyCapacityHours: round2(expectedVacancyCapacityHoursForRole),
        projectedCapacityHours: round2(projectedHours),
        capacityGapHours: round2(forecastHours - projectedHours),
        coveragePercent: round2(forecastHours > 0 ? projectedHours / forecastHours * 100 : 100),
      };
    })
    .sort((a, b) =>
      (a.jobProfileId == null ? 1 : 0) - (b.jobProfileId == null ? 1 : 0)
      || a.family.localeCompare(b.family)
      || a.title.localeCompare(b.title)
    );

  const projectedCapacityHours = currentPeriodCapacityHours + expectedVacancyCapacityHours;
  const capacityGapBeforeFills = forecastHeadcountHours - currentPeriodCapacityHours;
  const capacityGapAfterFills = forecastHeadcountHours - projectedCapacityHours;
  const capacityCoveragePercent = forecastHeadcountHours > 0
    ? projectedCapacityHours / forecastHeadcountHours * 100
    : 100;
  const averageBaseHourlyRate = hourlyRates.length
    ? hourlyRates.reduce((sum, value) => sum + value, 0) / hourlyRates.length
    : 0;
  const knownLoadRatio = annualizedBasePayroll > 0
    ? (annualStatutoryEmployer + annualBenefitEmployer + annualRecurringCompensation) / annualizedBasePayroll
    : 0;
  const estimatedShiftDemandWageCost = forecastHeadcountHours
    * averageBaseHourlyRate
    * (1 + knownLoadRatio + employerLoadPercent / 100);

  const costCenterById = new Map(input.costCenters.map((center) => [center.id, center]));
  const costCenterCost = new Map<number, number>();
  let unallocatedCurrentPeriodBaseCost = 0;
  const allocationIssueEmployeeIds: number[] = [];

  for (const [employeeId, annualCost] of annualCostByEmployee) {
    const periodCost = annualCost * windowDays / 365.25;
    const periodLoadedCost = (loadedAnnualCostByEmployee.get(employeeId) ?? annualCost) * windowDays / 365.25;
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
          (costCenterCost.get(allocation.costCenterId) ?? 0) + periodLoadedCost * allocation.percent / 100,
        );
      }
    } catch {
      allocationIssueEmployeeIds.push(employeeId);
      unallocatedCurrentPeriodBaseCost += periodCost;
    }
  }

  const costCenters = [...costCenterCost.entries()]
    .map(([costCenterId, currentPeriodLoadedCost]) => {
      const center = costCenterById.get(costCenterId);
      const baseCost = [...annualCostByEmployee.entries()].reduce((sum, [employeeId, annualCost]) => {
        try {
          const resolved = resolveLaborAllocation({ employeeId, asOf: startDate, rows: input.laborAllocations });
          const allocation = resolved.allocations.find((item) => item.costCenterId === costCenterId);
          return sum + (allocation ? annualCost * windowDays / 365.25 * allocation.percent / 100 : 0);
        } catch {
          return sum;
        }
      }, 0);
      return {
        costCenterId,
        code: center?.code ?? `#${costCenterId}`,
        name: center?.name ?? "Unknown cost center",
        currentPeriodBaseCost: round2(baseCost),
        currentPeriodLoadedCost: round2(currentPeriodLoadedCost + baseCost * employerLoadPercent / 100),
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
      currentPeriodStatutoryEmployerCost: round2(currentPeriodStatutoryEmployer),
      currentPeriodBenefitEmployerCost: round2(currentPeriodBenefitEmployer),
      currentPeriodRecurringCompensationCost: round2(currentPeriodRecurringCompensation),
      expectedVacancyEmployerStatutoryCost: round2(expectedVacancyPeriodStatutory),
      sourceGroundedEmployerCost: round2(sourceGroundedEmployerCost),
      additionalScenarioLoadCost: round2(additionalScenarioLoadCost),
      employerLoadCost: round2(employerLoadCost),
      forecastPeriodLaborCost: round2(forecastPeriodLaborCost),
      requiredHeadcountHours: round2(requiredHeadcountHours),
      forecastHeadcountHours: round2(forecastHeadcountHours),
      averageBaseHourlyRate: round2(averageBaseHourlyRate),
      estimatedShiftDemandWageCost: round2(estimatedShiftDemandWageCost),
      currentPeriodCapacityHours: round2(currentPeriodCapacityHours),
      expectedVacancyCapacityHours: round2(expectedVacancyCapacityHours),
      projectedCapacityHours: round2(projectedCapacityHours),
      capacityGapBeforeFills: round2(capacityGapBeforeFills),
      capacityGapAfterFills: round2(capacityGapAfterFills),
      capacityCoveragePercent: round2(capacityCoveragePercent),
    },
    roleDemand,
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
      employerCostRows: input.employerCosts?.length ?? 0,
      vacanciesWithoutBenefitCost: vacantPositions.length,
    },
  };
}
