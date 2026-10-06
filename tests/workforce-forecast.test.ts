import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  annualizePayProfile,
  buildWorkforceDemandForecast,
  hourlyBaseRate,
  paidShiftHours,
} from "../src/lib/workforce-forecast";

test("pay profiles annualize consistently across monthly, daily, and hourly bases", () => {
  assert.equal(annualizePayProfile({
    employeeId: 1,
    payBasis: "monthly",
    rateAmount: 30000,
    standardWorkDaysPerMonth: 22,
    standardHoursPerDay: 8,
  }), 360000);

  assert.equal(annualizePayProfile({
    employeeId: 1,
    payBasis: "daily",
    rateAmount: 1000,
    standardWorkDaysPerMonth: 22,
    standardHoursPerDay: 8,
  }), 264000);

  assert.equal(annualizePayProfile({
    employeeId: 1,
    payBasis: "hourly",
    rateAmount: 200,
    standardWorkDaysPerMonth: 22,
    standardHoursPerDay: 8,
  }), 422400);

  assert.equal(hourlyBaseRate({
    employeeId: 1,
    payBasis: "monthly",
    rateAmount: 35200,
    standardWorkDaysPerMonth: 22,
    standardHoursPerDay: 8,
  }), 200);
});

test("paid shift hours handle breaks and cross-midnight shifts", () => {
  assert.equal(paidShiftHours({
    id: 1,
    startTime: "08:00",
    endTime: "17:00",
    breakMinutes: 60,
    spansMidnight: false,
  }), 8);

  assert.equal(paidShiftHours({
    id: 2,
    startTime: "22:00",
    endTime: "06:00",
    breakMinutes: 60,
    spansMidnight: true,
  }), 7);
});

test("forecast combines current payroll, vacancy budget, staffing demand, and cost centers without double counting", () => {
  const result = buildWorkforceDemandForecast({
    assumptions: {
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      demandGrowthPercent: 25,
      vacancyFillPercent: 50,
      employerLoadPercent: 10,
    },
    employees: [
      { id: 1, status: "Active" },
      { id: 2, status: "Active" },
    ],
    payProfiles: [
      { employeeId: 1, payBasis: "monthly", rateAmount: 30000, standardWorkDaysPerMonth: 22, standardHoursPerDay: 8 },
      { employeeId: 2, payBasis: "hourly", rateAmount: 200, standardWorkDaysPerMonth: 22, standardHoursPerDay: 8 },
    ],
    positions: [
      { id: 11, status: "open", annualBudget: 600000, plannedStartDate: "2026-01-01" },
      { id: 12, status: "filled", annualBudget: 500000, plannedStartDate: "2025-01-01" },
    ],
    staffingRequirements: [
      { workDate: "2026-01-10", shiftDefinitionId: 1, requiredHeadcount: 2 },
    ],
    shifts: [
      { id: 1, startTime: "08:00", endTime: "17:00", breakMinutes: 60, spansMidnight: false },
    ],
    laborAllocations: [
      {
        id: 1,
        employeeId: 1,
        costCenterId: 10,
        effectiveFrom: "2025-01-01",
        effectiveUntil: null,
        allocationPercent: 100,
        allocationBasis: "percentage",
      },
    ],
    costCenters: [{ id: 10, code: "OPS", name: "Operations" }],
  });

  assert.equal(result.summary.activeHeadcount, 2);
  assert.equal(result.summary.costedHeadcount, 2);
  assert.equal(result.summary.vacantPositions, 1);
  assert.equal(result.summary.expectedVacancyFills, 0.5);
  assert.equal(result.summary.requiredHeadcountHours, 16);
  assert.equal(result.summary.forecastHeadcountHours, 20);
  assert.equal(result.summary.annualizedBasePayroll, 782400);
  assert.equal(result.summary.vacantAnnualBudget, 600000);
  assert.ok(result.summary.forecastPeriodLaborCost > result.summary.currentPeriodBasePayroll);
  assert.ok(result.summary.estimatedShiftDemandWageCost > 0);
  assert.equal(result.costCenters.length, 1);
  assert.equal(result.costCenters[0]?.code, "OPS");
  assert.ok(result.costCenters[0]!.currentPeriodBaseCost > 0);
  assert.ok(result.unallocated.currentPeriodBaseCost > 0);
  assert.equal(result.unallocated.plannedVacancyPeriodCost, result.summary.expectedVacancyPeriodCost);
});

test("forecast surfaces missing pay and invalid allocation evidence instead of inventing cost", () => {
  const result = buildWorkforceDemandForecast({
    assumptions: {
      startDate: "2026-02-01",
      endDate: "2026-02-28",
      demandGrowthPercent: 0,
      vacancyFillPercent: 100,
      employerLoadPercent: 0,
    },
    employees: [
      { id: 1, status: "Active" },
      { id: 2, status: "Active" },
    ],
    payProfiles: [
      { employeeId: 1, payBasis: "monthly", rateAmount: 30000, standardWorkDaysPerMonth: 22, standardHoursPerDay: 8 },
    ],
    positions: [],
    staffingRequirements: [],
    shifts: [],
    laborAllocations: [
      {
        id: 1,
        employeeId: 1,
        costCenterId: 10,
        effectiveFrom: "2026-01-01",
        effectiveUntil: null,
        allocationPercent: 80,
        allocationBasis: "percentage",
      },
    ],
    costCenters: [{ id: 10, code: "OPS", name: "Operations" }],
  });

  assert.deepEqual(result.quality.missingPayProfileEmployeeIds, [2]);
  assert.deepEqual(result.quality.allocationIssueEmployeeIds, [1]);
  assert.equal(result.costCenters.length, 0);
  assert.ok(result.unallocated.currentPeriodBaseCost > 0);
});

test("forecast assumptions fail closed outside the governed range", () => {
  assert.throws(() => buildWorkforceDemandForecast({
    assumptions: {
      startDate: "2026-01-01",
      endDate: "2027-12-31",
      demandGrowthPercent: 0,
      vacancyFillPercent: 100,
      employerLoadPercent: 0,
    },
    employees: [],
    payProfiles: [],
    positions: [],
    staffingRequirements: [],
    shifts: [],
    laborAllocations: [],
    costCenters: [],
  }), /cannot exceed 366 days/);

  assert.throws(() => buildWorkforceDemandForecast({
    assumptions: {
      startDate: "2026-01-01",
      endDate: "2026-03-31",
      demandGrowthPercent: 250,
      vacancyFillPercent: 100,
      employerLoadPercent: 0,
    },
    employees: [],
    payProfiles: [],
    positions: [],
    staffingRequirements: [],
    shifts: [],
    laborAllocations: [],
    costCenters: [],
  }), /Demand growth must be between/);
});

test("forecast API is read-only, salary-sensitive, and scoped to tenant/org unit", () => {
  const source = readFileSync("src/app/api/workforce-planning/forecast/route.ts", "utf8");
  assert.ok(source.includes("PEOPLE_PAYROLL_ROLES"));
  assert.ok(source.includes("getAccess(user.id, organizationId)"));
  assert.ok(source.includes("employee.orgUnitId === access.orgUnitId"));
  assert.ok(source.includes("position.orgUnitId === access.orgUnitId"));
  assert.ok(source.includes("visibleWorksiteIds"));
  assert.ok(source.includes("Planning estimate only"));
  assert.ok(!source.includes("export async function POST"));
  assert.ok(!source.includes("export async function PATCH"));
});

test("planning UI exposes explicit scenario assumptions and quality boundaries", () => {
  const source = readFileSync("src/components/workforce-planning-panel.tsx", "utf8");
  assert.ok(source.includes("/api/workforce-planning/forecast"));
  assert.ok(source.includes("DEMAND & LABOR-COST FORECAST"));
  assert.ok(source.includes("Demand growth %"));
  assert.ok(source.includes("Vacancy fill %"));
  assert.ok(source.includes("Employer load %"));
  assert.ok(source.includes("Forecast quality needs review"));
  assert.ok(source.includes("not a statutory contribution calculation"));
  assert.ok(source.includes("It is not added to the labor plan again."));
});
