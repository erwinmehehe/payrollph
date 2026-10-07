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

export type ForecastEmployerBenefit = {
  employeeId: number;
  monthlyEmployerCost: number | string;
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

export function monthlyEquivalentPay(profile: ForecastPayProfile) {
  return round2(annualizePayProfile(profile) / 12);
}

export function monthlyEmployerStatutoryCost(monthlySalary: number) {
  if (!Number.isFinite(monthlySalary) || monthlySalary <= 0) return 0;
  const sss = computeSss(monthlySalary);
  const philHealth = computePhilHealth(monthlySalary);
  const pagIbig = computePagIbig(monthlySalary);
  return round2(sss.employerTotal + philHealth.employer + pagIbig.employer);
}

export function annualEmployerStatutoryCostFromAnnualSalary(annualSalary: number) {
  if (!Number.isFinite(annualSalary) || annualSalary <= 0) return 0;
  return round2(monthlyEmployerStatutoryCost(annualSalary / 12) * 12);
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
  employerBenefits?: ForecastEmployerBenefit[];
  positions: ForecastPosition[];
  staffingRequirements: ForecastStaffingRequirement[];
  shifts: ForecastShift[];
  laborAllocations: LaborAllocationRow[];
  costCenters: ForecastCostCenter[];
  jobProfiles?: ForecastJobProfile[];
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
  const annualStatutoryByEmployee = new Map<number, number>();
  const annualBenefitByEmployee = new Map<number, number>();
  const annualCapacityByEmployee = new Map<number, number>();
  const hourlyRates: number[] = [];
  const benefitMonthlyByEmployee = new Map(
    (input.employerBenefits ?? []).map((row) => [row.employeeId, number(row.monthlyEmployerCost, "employer benefit cost")]),
  );

  for (const employee of activeEmployees) {
    const profile = profileByEmployee.get(employee.id);
    if (!profile) {
      missingPayProfileEmployeeIds.push(employee.id);
      continue;
    }
    try {
      const annualBase = annualizePayProfile(profile);
      annualCostByEmployee.set(employee.id, annualBase);
      annualStatutoryByEmployee.set(employee.id, annualEmployerStatutoryCostFromAnnualSalary(annualBase));
      annualBenefitByEmployee.set(employee.id, round2((benefitMonthlyByEmployee.get(employee.id) ?? 0) * 12));
      annualCapacityByEmployee.set(employee.id, annualStandardCapacityHours(profile));
      hourlyRates.push(hourlyBaseRate(profile));
    } catch {
      invalidPayProfileEmployeeIds.push(employee.id);
    }
  }

  const annualizedBasePayroll = [...annualCostByEmployee.values()].reduce((sum, value) => sum + value, 0);
  const annualizedEmployerStatutory = [...annualStatutoryByEmployee.values()].reduce((sum, value) => sum + value, 0);
  const annualizedEmployerBenefits = [...annualBenefitByEmployee.values()].reduce((sum, value) => sum + value, 0);
  const currentPeriodBasePayroll = annualizedBasePayroll * windowDays / 365.25;
  const currentPeriodEmployerStatutory = annualizedEmployerStatutory * windowDays / 365.25;
  const currentPeriodEmployerBenefits = annualizedEmployerBenefits * windowDays / 365.25;
  const currentPeriodCapacityHours = [...annualCapacityByEmployee.values()]
    .reduce((sum, annualHours) => sum + annualHours * windowDays / 365.25, 0);
  const averageAnnualCapacityHours = annualCapacityByEmployee.size
    ? [...annualCapacityByEmployee.values()].reduce((sum, value) => sum + value, 0) / annualCapacityByEmployee.size
    : 0;
  const averageMonthlyEmployerBenefit = annualBenefitByEmployee.size
    ? [...annualBenefitByEmployee.values()].reduce((sum, value) => sum + value, 0) / annualBenefitByEmployee.size / 12
    : 0;

  const vacantPositions = input.positions.filter((position) => VACANT_POSITION_STATUSES.has(position.status));
  const vacantAnnualBudget = vacantPositions.reduce((sum, position) => sum + number(position.annualBudget, "position annual budget"), 0);
  const expectedVacancyAnnualCost = vacantAnnualBudget * vacancyFillPercent / 100;
  const expectedVacancyAnnualStatutory = vacantPositions.reduce((sum, position) =>
    sum + annualEmployerStatutoryCostFromAnnualSalary(number(position.annualBudget, "position annual budget")) * vacancyFillPercent / 100,
  0);
  const expectedVacancyAnnualBenefits = vacantPositions.reduce((sum, position) => {
    const annualBudget = number(position.annualBudget, "position annual budget");
    if (annualBudget <= 0) return sum;
    return sum + averageMonthlyEmployerBenefit * 12 * vacancyFillPercent / 100;
  }, 0);
  const expectedVacancyPeriodCost = vacantPositions.reduce((sum, position) => {
    const days = overlapDays(startDate, endDate, position.plannedStartDate);
    const periodBudget = number(position.annualBudget, "position annual budget") * days / 365.25;
    return sum + periodBudget * vacancyFillPercent / 100;
  }, 0);
  const expectedVacancyPeriodStatutory = vacantPositions.reduce((sum, position) => {
    const days = overlapDays(startDate, endDate, position.plannedStartDate);
    const annualStatutory = annualEmployerStatutoryCostFromAnnualSalary(number(position.annualBudget, "position annual budget"));
    return sum + annualStatutory * days / 365.25 * vacancyFillPercent / 100;
  }, 0);
  const expectedVacancyPeriodBenefits = vacantPositions.reduce((sum, position) => {
    const annualBudget = number(position.annualBudget, "position annual budget");
    if (annualBudget <= 0) return sum;
    const days = overlapDays(startDate, endDate, position.plannedStartDate);
    return sum + averageMonthlyEmployerBenefit * 12 * days / 365.25 * vacancyFillPercent / 100;
  }, 0);
  const expectedVacancyCapacityHours = vacantPositions.reduce((sum, position) => {
    const days = overlapDays(startDate, endDate, position.plannedStartDate);
    return sum + averageAnnualCapacityHours * days / 365.25 * vacancyFillPercent / 100;
  }, 0);

  const forecastPeriodBasePayroll = currentPeriodBasePayroll + expectedVacancyPeriodCost;
  const forecastPeriodEmployerStatutory = currentPeriodEmployerStatutory + expectedVacancyPeriodStatutory;
  const forecastPeriodEmployerBenefits = currentPeriodEmployerBenefits + expectedVacancyPeriodBenefits;
  const employerLoadCost = forecastPeriodBasePayroll * employerLoadPercent / 100;
  const forecastPeriodLaborCost = forecastPeriodBasePayroll
    + forecastPeriodEmployerStatutory
    + forecastPeriodEmployerBenefits
    + employerLoadCost;
  const annualRunRateBase = annualizedBasePayroll + expectedVacancyAnnualCost;
  const annualRunRateEmployerStatutory = annualizedEmployerStatutory + expectedVacancyAnnualStatutory;
  const annualRunRateEmployerBenefits = annualizedEmployerBenefits + expectedVacancyAnnualBenefits;
  const annualRunRateLaborCost = annualRunRateBase
    + annualRunRateEmployerStatutory
    + annualRunRateEmployerBenefits
    + annualRunRateBase * employerLoadPercent / 100;

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
  const activeAnnualLoadedCost = annualizedBasePayroll * (1 + employerLoadPercent / 100)
    + annualizedEmployerStatutory
    + annualizedEmployerBenefits;
  const activeAnnualCapacity = [...annualCapacityByEmployee.values()].reduce((sum, value) => sum + value, 0);
  const averageLoadedHourlyRate = activeAnnualCapacity > 0
    ? activeAnnualLoadedCost / activeAnnualCapacity
    : 0;
  const estimatedShiftDemandWageCost = forecastHeadcountHours * averageLoadedHourlyRate;

  const costCenterById = new Map(input.costCenters.map((center) => [center.id, center]));
  const costCenterBaseCost = new Map<number, number>();
  const costCenterLoadedCost = new Map<number, number>();
  let unallocatedCurrentPeriodBaseCost = 0;
  let unallocatedCurrentPeriodLoadedCost = 0;
  const allocationIssueEmployeeIds: number[] = [];

  for (const [employeeId, annualCost] of annualCostByEmployee) {
    const annualLoadedCost = annualCost * (1 + employerLoadPercent / 100)
      + (annualStatutoryByEmployee.get(employeeId) ?? 0)
      + (annualBenefitByEmployee.get(employeeId) ?? 0);
    const periodCost = annualCost * windowDays / 365.25;
    const periodLoadedCost = annualLoadedCost * windowDays / 365.25;
    try {
      const resolved = resolveLaborAllocation({
        employeeId,
        asOf: startDate,
        rows: input.laborAllocations,
      });
      if (resolved.status === "unallocated") {
        unallocatedCurrentPeriodBaseCost += periodCost;
        unallocatedCurrentPeriodLoadedCost += periodLoadedCost;
        continue;
      }
      for (const allocation of resolved.allocations) {
        costCenterBaseCost.set(
          allocation.costCenterId,
          (costCenterBaseCost.get(allocation.costCenterId) ?? 0) + periodCost * allocation.percent / 100,
        );
        costCenterLoadedCost.set(
          allocation.costCenterId,
          (costCenterLoadedCost.get(allocation.costCenterId) ?? 0) + periodLoadedCost * allocation.percent / 100,
        );
      }
    } catch {
      allocationIssueEmployeeIds.push(employeeId);
      unallocatedCurrentPeriodBaseCost += periodCost;
      unallocatedCurrentPeriodLoadedCost += periodLoadedCost;
    }
  }

  const costCenters = [...new Set([...costCenterBaseCost.keys(), ...costCenterLoadedCost.keys()])]
    .map((costCenterId) => {
      const center = costCenterById.get(costCenterId);
      return {
        costCenterId,
        code: center?.code ?? `#${costCenterId}`,
        name: center?.name ?? "Unknown cost center",
        currentPeriodBaseCost: round2(costCenterBaseCost.get(costCenterId) ?? 0),
        currentPeriodLoadedCost: round2(costCenterLoadedCost.get(costCenterId) ?? 0),
      };
    })
    .sort((a, b) => b.currentPeriodLoadedCost - a.currentPeriodLoadedCost || a.code.localeCompare(b.code));

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
      annualizedEmployerStatutory: round2(annualizedEmployerStatutory),
      annualizedEmployerBenefits: round2(annualizedEmployerBenefits),
      vacantAnnualBudget: round2(vacantAnnualBudget),
      annualRunRateEmployerStatutory: round2(annualRunRateEmployerStatutory),
      annualRunRateEmployerBenefits: round2(annualRunRateEmployerBenefits),
      annualRunRateLaborCost: round2(annualRunRateLaborCost),
      currentPeriodBasePayroll: round2(currentPeriodBasePayroll),
      currentPeriodEmployerStatutory: round2(currentPeriodEmployerStatutory),
      currentPeriodEmployerBenefits: round2(currentPeriodEmployerBenefits),
      expectedVacancyPeriodCost: round2(expectedVacancyPeriodCost),
      expectedVacancyPeriodStatutory: round2(expectedVacancyPeriodStatutory),
      expectedVacancyPeriodBenefits: round2(expectedVacancyPeriodBenefits),
      employerLoadCost: round2(employerLoadCost),
      forecastPeriodEmployerStatutory: round2(forecastPeriodEmployerStatutory),
      forecastPeriodEmployerBenefits: round2(forecastPeriodEmployerBenefits),
      forecastPeriodLaborCost: round2(forecastPeriodLaborCost),
      requiredHeadcountHours: round2(requiredHeadcountHours),
      forecastHeadcountHours: round2(forecastHeadcountHours),
      averageBaseHourlyRate: round2(averageBaseHourlyRate),
      averageLoadedHourlyRate: round2(averageLoadedHourlyRate),
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
      currentPeriodLoadedCost: round2(unallocatedCurrentPeriodLoadedCost),
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
