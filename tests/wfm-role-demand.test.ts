import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { computeCoverage } from "../src/lib/workforce-coverage";
import { buildWorkforceDemandForecast } from "../src/lib/workforce-forecast";
import { computeWorkforceLaborVariance } from "../src/lib/workforce-labor-variance";
import {
  assertUnambiguousRoleDemand,
  resolveEmployeeJobProfileAtDate,
} from "../src/lib/workforce-role-demand";

test("effective-dated position evidence resolves one authoritative job profile", () => {
  const positions = [
    { id: 1, jobProfileId: 10 },
    { id: 2, jobProfileId: 20 },
  ];
  const assignments = [
    { employeeId: 7, positionId: 1, effectiveFrom: "2026-01-01", effectiveUntil: null },
  ];

  assert.deepEqual(resolveEmployeeJobProfileAtDate({
    employeeId: 7,
    date: "2026-10-06",
    assignments,
    positions,
  }), {
    jobProfileId: 10,
    ambiguous: false,
    positionIds: [1],
  });

  assert.deepEqual(resolveEmployeeJobProfileAtDate({
    employeeId: 8,
    date: "2026-10-06",
    assignments,
    positions,
  }), {
    jobProfileId: null,
    ambiguous: false,
    positionIds: [],
  });
});

test("multiple distinct active roles fail role attribution visibly", () => {
  const result = resolveEmployeeJobProfileAtDate({
    employeeId: 7,
    date: "2026-10-06",
    assignments: [
      { employeeId: 7, positionId: 1, effectiveFrom: "2026-01-01", effectiveUntil: null },
      { employeeId: 7, positionId: 2, effectiveFrom: "2026-06-01", effectiveUntil: null },
    ],
    positions: [
      { id: 1, jobProfileId: 10 },
      { id: 2, jobProfileId: 20 },
    ],
  });

  assert.equal(result.jobProfileId, null);
  assert.equal(result.ambiguous, true);
  assert.deepEqual(result.positionIds, [1, 2]);
});

test("generic and role-specific demand cannot coexist for the same site/date/shift", () => {
  assert.throws(() => assertUnambiguousRoleDemand([
    { worksiteId: 1, workDate: "2026-10-06", shiftDefinitionId: 3, jobProfileId: null },
    { worksiteId: 1, workDate: "2026-10-06", shiftDefinitionId: 3, jobProfileId: 10 },
  ]), /Ambiguous staffing demand/);

  assert.doesNotThrow(() => assertUnambiguousRoleDemand([
    { worksiteId: 1, workDate: "2026-10-06", shiftDefinitionId: 3, jobProfileId: 10 },
    { worksiteId: 1, workDate: "2026-10-06", shiftDefinitionId: 3, jobProfileId: 20 },
  ]));
});

test("role-specific coverage counts only scheduled workers with the required job profile", () => {
  const rows = computeCoverage({
    requirements: [{
      id: 1,
      worksiteId: 50,
      workDate: "2026-10-06",
      shiftDefinitionId: 3,
      jobProfileId: 10,
      requiredHeadcount: 2,
    }],
    scheduled: [
      { employeeId: 1, workDate: "2026-10-06", worksiteId: 50, jobProfileId: 10, shiftDefinitionIds: [3] },
      { employeeId: 2, workDate: "2026-10-06", worksiteId: 50, jobProfileId: 20, shiftDefinitionIds: [3] },
    ],
  });

  assert.equal(rows[0].scheduledHeadcount, 1);
  assert.equal(rows[0].availableScheduledHeadcount, 1);
  assert.equal(rows[0].gap, 1);
  assert.equal(rows[0].jobProfileId, 10);
});

test("legacy generic coverage remains backward compatible and counts all roles", () => {
  const rows = computeCoverage({
    requirements: [{
      id: 1,
      worksiteId: 50,
      workDate: "2026-10-06",
      shiftDefinitionId: 3,
      requiredHeadcount: 2,
    }],
    scheduled: [
      { employeeId: 1, workDate: "2026-10-06", worksiteId: 50, jobProfileId: 10, shiftDefinitionIds: [3] },
      { employeeId: 2, workDate: "2026-10-06", worksiteId: 50, jobProfileId: 20, shiftDefinitionIds: [3] },
    ],
  });

  assert.equal(rows[0].scheduledHeadcount, 2);
  assert.equal(rows[0].gap, 0);
  assert.equal(rows[0].jobProfileId, null);
});

test("role-specific labor variance excludes the wrong role from scheduled and actual coverage", () => {
  const result = computeWorkforceLaborVariance({
    requirements: [{
      id: 1,
      worksiteId: 50,
      workDate: "2026-10-06",
      shiftDefinitionId: 3,
      jobProfileId: 10,
      requiredHeadcount: 1,
    }],
    shifts: [{
      id: 3,
      startTime: "08:00",
      endTime: "17:00",
      breakMinutes: 60,
      spansMidnight: false,
    }],
    scheduled: [
      { employeeId: 1, worksiteId: 50, workDate: "2026-10-06", shiftDefinitionId: 3, jobProfileId: 10, paidMinutes: 480, hourlyRate: 100 },
      { employeeId: 2, worksiteId: 50, workDate: "2026-10-06", shiftDefinitionId: 3, jobProfileId: 20, paidMinutes: 480, hourlyRate: 100 },
    ],
    actual: [
      { employeeId: 1, worksiteId: 50, workDate: "2026-10-06", shiftDefinitionId: 3, jobProfileId: 10, workedMinutes: 480, hourlyRate: 100, matchedToSchedule: true },
      { employeeId: 2, worksiteId: 50, workDate: "2026-10-06", shiftDefinitionId: 3, jobProfileId: 20, workedMinutes: 480, hourlyRate: 100, matchedToSchedule: true },
    ],
    benchmarkHourlyRate: 100,
  });

  assert.equal(result.rows[0].scheduledHeadcount, 1);
  assert.equal(result.rows[0].actualHeadcount, 1);
  assert.equal(result.rows[0].scheduledHours, 8);
  assert.equal(result.rows[0].actualHours, 8);
  assert.equal(result.summary.scheduledOutsideRequirementHours, 8);
  assert.equal(result.summary.unmatchedActualHours, 8);
});

test("workforce forecast reports demand and projected capacity by job profile", () => {
  const result = buildWorkforceDemandForecast({
    assumptions: {
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      demandGrowthPercent: 0,
      vacancyFillPercent: 100,
      employerLoadPercent: 0,
    },
    employees: [
      { id: 1, status: "Active", jobProfileId: 10 },
      { id: 2, status: "Active", jobProfileId: 20 },
    ],
    payProfiles: [
      { employeeId: 1, payBasis: "monthly", rateAmount: 30000, standardWorkDaysPerMonth: 22, standardHoursPerDay: 8 },
      { employeeId: 2, payBasis: "monthly", rateAmount: 40000, standardWorkDaysPerMonth: 22, standardHoursPerDay: 8 },
    ],
    positions: [
      { id: 1, status: "filled", jobProfileId: 10, annualBudget: 360000, plannedStartDate: "2026-01-01" },
      { id: 2, status: "open", jobProfileId: 10, annualBudget: 360000, plannedStartDate: "2026-01-01" },
      { id: 3, status: "filled", jobProfileId: 20, annualBudget: 480000, plannedStartDate: "2026-01-01" },
    ],
    staffingRequirements: [
      { workDate: "2026-10-06", shiftDefinitionId: 1, jobProfileId: 10, requiredHeadcount: 2 },
      { workDate: "2026-10-06", shiftDefinitionId: 1, jobProfileId: 20, requiredHeadcount: 1 },
    ],
    shifts: [{
      id: 1,
      startTime: "08:00",
      endTime: "17:00",
      breakMinutes: 60,
      spansMidnight: false,
    }],
    laborAllocations: [],
    costCenters: [],
    jobProfiles: [
      { id: 10, title: "Support Agent", family: "Operations", level: "IC1" },
      { id: 20, title: "Team Lead", family: "Operations", level: "Lead" },
    ],
  });

  assert.equal(result.roleDemand.length, 2);
  const agent = result.roleDemand.find((row) => row.jobProfileId === 10);
  const lead = result.roleDemand.find((row) => row.jobProfileId === 20);
  assert.ok(agent);
  assert.ok(lead);
  assert.equal(agent.title, "Support Agent");
  assert.equal(agent.requiredHours, 16);
  assert.equal(agent.activeHeadcount, 1);
  assert.equal(agent.vacantPositions, 1);
  assert.equal(agent.expectedVacancyFills, 1);
  assert.ok(agent.projectedCapacityHours > agent.currentCapacityHours);
  assert.equal(lead.title, "Team Lead");
  assert.equal(lead.requiredHours, 8);
  assert.equal(lead.activeHeadcount, 1);
  assert.equal(lead.vacantPositions, 0);
});

test("schema, routes, open shifts and scenario UI carry the role dimension end to end", () => {
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const migration = readFileSync("drizzle/0049_wfm_role_demand.sql", "utf8");
  const route = readFileSync("src/app/api/workforce/coverage/route.ts", "utf8");
  const forecastServer = readFileSync("src/lib/workforce-forecast-server.ts", "utf8");
  const scenarioRoute = readFileSync("src/app/api/workforce-planning/scenarios/route.ts", "utf8");
  const coveragePanel = readFileSync("src/components/workspace/workforce-coverage-panel.tsx", "utf8");
  const planningPanel = readFileSync("src/components/workforce-planning-panel.tsx", "utf8");

  assert.ok(schema.includes('jobProfileId: integer("job_profile_id")'));
  assert.ok(schema.includes('staffing_requirement_role_unique'));
  assert.ok(schema.includes('open_shifts_role_idx'));
  assert.ok(migration.includes('ADD COLUMN IF NOT EXISTS "job_profile_id"'));
  assert.ok(route.includes("employeeJobProfileOnDate"));
  assert.ok(route.includes("assertUnambiguousRoleDemand"));
  assert.ok(route.includes("The employee does not hold the job profile required by this open shift"));
  assert.ok(route.includes("The employee no longer has unambiguous active position evidence"));
  assert.ok(route.includes("Any job profile requirement"));
  assert.ok(forecastServer.includes("resolveEmployeeJobProfileAtDate"));
  assert.ok(forecastServer.includes("visibleRequirementRows"));
  assert.ok(scenarioRoute.includes('version: "wfm-staffing-scenario-v3"'));
  assert.ok(coveragePanel.includes("Job profile"));
  assert.ok(coveragePanel.includes("Any job profile"));
  assert.ok(coveragePanel.includes("jobProfileById"));
  assert.ok(planningPanel.includes("forecast.roleDemand"));
  assert.ok(planningPanel.includes("ambiguous role evidence"));
});
