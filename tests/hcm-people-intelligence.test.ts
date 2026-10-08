import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  hcmAnalyticsDate,
  hcmDateOffset,
  hcmWorkerStatusAt,
  summarizeHcmPeopleIntelligence,
  type HcmAnalyticsWorker,
  type HcmAnalyticsEmploymentEvent,
  type HcmAnalyticsAssignment,
  type HcmAnalyticsPosition,
} from "../src/lib/hcm-people-intelligence";

const AS_OF = "2026-10-08";
const workers: HcmAnalyticsWorker[] = Array.from({ length: 12 }, (_, index) => ({
  id: index + 1,
  startDate: "2025-01-01",
  status: index === 0 ? "Separated" : "Active",
  orgUnitId: index < 6 ? 1 : 2,
  employmentType: "Regular",
})).concat([{ id: 13, startDate: "2026-09-25", status: "Active", orgUnitId: 1, employmentType: "Regular" }]);
const events: HcmAnalyticsEmploymentEvent[] = [
  ...workers.map((worker): HcmAnalyticsEmploymentEvent => ({
  id: worker.id,
  employeeId: worker.id,
  effectiveDate: worker.startDate,
  eventType: "hire",
  fromStatus: null,
  toStatus: "Active",
  fromOrgUnitId: null,
  toOrgUnitId: worker.orgUnitId,
  })),
  { id: 20, employeeId: 1, effectiveDate: "2026-09-14", eventType: "separation_started",
    fromStatus: "Active", toStatus: "Separating", fromOrgUnitId: 1, toOrgUnitId: 1 },
  { id: 21, employeeId: 1, effectiveDate: "2026-10-01", eventType: "separation_released",
    fromStatus: "Separating", toStatus: "Separated", fromOrgUnitId: 1, toOrgUnitId: 1 },
];
const positions: HcmAnalyticsPosition[] = [
  { id: 1, status: "approved", orgUnitId: 1, annualBudget: "500000.00" },
  { id: 2, status: "filled", orgUnitId: 1, annualBudget: "300000.00" },
  { id: 3, status: "planned", orgUnitId: 2, annualBudget: "200000.00" },
  { id: 4, status: "open", orgUnitId: 2, annualBudget: "350000.00" },
];
const assignments: HcmAnalyticsAssignment[] = [
  { employeeId: 2, positionId: 2, fte: "1.0000", assignmentType: "primary",
    effectiveFrom: "2025-01-01", effectiveUntil: null },
  { employeeId: 3, positionId: 9, fte: "0.5000", assignmentType: "primary",
    effectiveFrom: "2026-01-01", effectiveUntil: null },
];
const input = {
  asOf: AS_OF,
  today: AS_OF,
  windowDays: 30,
  workers, events, positions, assignments,
  requisitions: [
    { id: 1, positionId: 1, status: "open", createdAt: "2026-09-01T00:00:00.000Z" },
    { id: 2, positionId: 2, status: "interviewing", createdAt: "2026-08-30T00:00:00.000Z" },
    { id: 3, positionId: 3, status: "filled", createdAt: "2026-08-01T00:00:00.000Z" },
  ],
  applicants: [{ requisitionId: 2, hiredAt: "2026-10-05T09:00:00.000Z" }],
  separations: [
    { employeeId: 1, status: "released", lastDay: "2026-10-01" },
    { employeeId: 3, status: "approved", lastDay: "2026-10-05" },
  ],
  payrollRuns: [
    { status: "Released", payDate: "2026-09-30", grossPay: "100000.00", netPay: "80000.00" },
    { status: "Draft", payDate: "2026-10-05", grossPay: "200000.00", netPay: "150000.00" },
    { status: "Released", payDate: "2026-09-08", grossPay: "45000.00", netPay: "35000.00" },
  ],
  cycles: [
    { id: 1, status: "active", budgetPool: "30000.00" },
    { id: 2, status: "closed", budgetPool: "80000.00" },
  ],
  proposals: [
    { cycleId: 1, status: "approved", currentAnnual: "500000.00", proposedAnnual: "512000.00" },
    { cycleId: 1, status: "scheduled", currentAnnual: "400000.00", proposedAnnual: "403000.00" },
    { cycleId: 1, status: "proposed", currentAnnual: "300000.00", proposedAnnual: "305000.00" },
    { cycleId: 2, status: "applied", currentAnnual: "200000.00", proposedAnnual: "225000.00" },
  ],
  units: [{ id: 1, name: "Engineering" }, { id: 2, name: "Operations" }],
};

test("People Intelligence reconstructs hiring, released exits and payroll without draft leakage", () => {
  const report = summarizeHcmPeopleIntelligence(input);
  assert.equal(report.asOf, AS_OF);
  assert.equal(report.windowStart, "2026-09-09");
  assert.equal(report.headcount, 12);
  assert.equal(report.coverage.unverified, 0);
  assert.equal(report.hires, 1);
  assert.equal(report.completedExits, 1);
  assert.equal(report.turnoverRate, 8.3);
  assert.equal(report.assignedFte, 1.5);
  assert.equal(report.vacantPositions, 2);
  assert.equal(report.recordedAnnualVacancyBudget, 850000);
  assert.equal(report.activeRequisitions, 2);
  assert.equal(report.medianHireDays, 36);
  assert.equal(report.releasedRunCount, 1);
  assert.equal(report.releasedPayrollGross, 100000);
  assert.equal(report.releasedPayrollNet, 80000);
  assert.equal(report.activeCycleBudget, 30000);
  assert.equal(report.approvedCompensationDeltaAnnual, 15000);
  assert.deepEqual(report.units?.map((u) => u.headcount), [6, 6]);
  assert.equal(report.trends.length, 6);
  assert.equal(report.trends[5].date, AS_OF);
});

test("future hires do not appear in a prior snapshot; applied lifecycle events override present-day status", () => {
  const separated = workers[0];
  assert.equal(hcmWorkerStatusAt(separated, events, "2026-09-13", AS_OF), "present");
  assert.equal(hcmWorkerStatusAt(separated, events, "2026-09-14", AS_OF), "present");
  assert.equal(hcmWorkerStatusAt(separated, events, "2026-10-01", AS_OF), "absent");
  assert.equal(hcmWorkerStatusAt(separated, events, AS_OF, AS_OF), "absent");
  assert.equal(hcmWorkerStatusAt(workers[12], events, "2026-09-24", AS_OF), "not_started");
  assert.equal(hcmWorkerStatusAt(workers[12], events, "2026-09-25", AS_OF), "present");
  const historic = summarizeHcmPeopleIntelligence({ ...input, asOf: "2026-09-24" });
  assert.equal(historic.historical, true);
  assert.equal(historic.headcount, 12);
  assert.equal(historic.vacantPositions, null);
  assert.equal(historic.activeRequisitions, null);
  assert.equal(historic.recordedAnnualVacancyBudget, null);
  assert.equal(historic.activeCycleBudget, null);
  assert.equal(historic.approvedCompensationDeltaAnnual, null);
});

test("missing historical status is never replaced by today's active status", () => {
  const absentHistory = events.filter((row) => row.employeeId !== 2);
  assert.equal(hcmWorkerStatusAt(workers[1], absentHistory, "2026-09-01", AS_OF), "unverified");
  const historic = summarizeHcmPeopleIntelligence({
    ...input, events: absentHistory, asOf: "2026-09-24",
  });
  assert.equal(historic.headcount, null);
  assert.ok(historic.coverage.unverified > 0);
  assert.equal(historic.turnoverRate, null);
  assert.ok(historic.warnings.some((item) => item.includes("withheld rather than inferred")));
});

test("rejected dates and unsupported windows never yield a fabricated report", () => {
  assert.equal(hcmAnalyticsDate("2026-10-08", AS_OF), AS_OF);
  assert.equal(hcmDateOffset("2026-10-08", -29), "2026-09-09");
  for (const bad of ["2026-10-09", "2026-02-30", "2026-1-08", "today"]) {
    assert.throws(() => hcmAnalyticsDate(bad, AS_OF), /asOf must/);
  }
  for (const windowDays of [0, 29, 31, 366, -90]) {
    assert.throws(() => summarizeHcmPeopleIntelligence({ ...input, windowDays }), /window/);
  }
});

test("position FTE fails closed on overlaps and impossible values", () => {
  const overlapping = summarizeHcmPeopleIntelligence({
    ...input,
    assignments: [...assignments, { ...assignments[0], positionId: 88 }],
  });
  assert.equal(overlapping.assignedFte, null);
  assert.ok(overlapping.warnings.some((message) => message.includes("Overlapping")));

  const invalid = summarizeHcmPeopleIntelligence({
    ...input, assignments: [{ ...assignments[0], fte: "1.9000" }],
  });
  assert.equal(invalid.assignedFte, null);
});

test("unit-level breakdown suppresses the whole table if any group has fewer than five", () => {
  const few = summarizeHcmPeopleIntelligence({
    ...input,
    workers: input.workers.map((worker) => worker.id === 2
      ? { ...worker, orgUnitId: 2 } : worker),
  });
  assert.equal(few.units, null);
  assert.ok(few.warnings.some((message) => message.includes("suppressed")));
});

test("audit report is explicitly company-wide, with same as-of scope in CSV and response", () => {
  const api = readFileSync("src/app/api/reports/route.ts", "utf8");
  const reports = readFileSync("src/lib/reports.ts", "utf8");
  const server = readFileSync("src/lib/hcm-people-intelligence-server.ts", "utf8");
  const component = readFileSync("src/components/workspace/analytics.tsx", "utf8");
  const overview = readFileSync("src/components/workspace/people-intelligence.tsx", "utf8");

  assert.match(api, /assertOrganizationRole\(/);
  assert.match(api, /PEOPLE_PAYROLL_ROLES/);
  assert.match(api, /!access\?\.companyWide/);
  assert.match(api, /hcmAnalyticsDate\(/);
  assert.match(api, /runReport\(key, organizationId, \{ asOf, windowDays \}\)/);
  assert.match(api, /metadata: \{ format: "csv", rows: report.rows.length, \...\(key === "people"/);
  assert.match(reports, /key === "people"/);
  for (const ledger of ["workerEmploymentEvents", "separationRecords", "positionAssignments", "jobRequisitions", "compensationProposals", "payrollRuns"]) {
    assert.ok(server.includes(ledger), `Missing authoritative source ${ledger}`);
  }
  assert.match(server, /eq\(employees.organizationId, input.organizationId\)/);
  assert.match(server, /eq\(payrollRuns.organizationId, input.organizationId\)/);
  assert.match(server, /asOf, today, windowDays/);
  assert.match(component, /PeopleIntelligenceOverview/);
  assert.match(component, /query.set\("asOf", peopleAsOf\)/);
  assert.match(component, /query.set\("windowDays", String\(peopleWindowDays\)\)/);
  assert.match(overview, /Headcount by org unit/);
  assert.doesNotMatch(overview, /bankAccount|taxId|ssn|employeeNo/);
});
