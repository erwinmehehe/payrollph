import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  recurringComponentAmountForCutoff,
  rangePosition,
  selectCompensationBand,
} from "../src/lib/compensation";

const schema = readFileSync("src/db/schema.ts", "utf8");
const migration = readFileSync("drizzle/0054_hcm_compensation_architecture.sql", "utf8");
const baseline = readFileSync("drizzle/baseline.sql", "utf8");
const route = readFileSync("src/app/api/compensation/route.ts", "utf8");
const governance = readFileSync("src/lib/hcm-compensation.ts", "utf8");
const payroll = readFileSync("src/lib/payroll-engine.ts", "utf8");
const scheduler = readFileSync("src/lib/scheduler.ts", "utf8");
const panel = readFileSync("src/components/compensation-panel.tsx", "utf8");
const employeesRoute = readFileSync("src/app/api/employees/route.ts", "utf8");

test("HCM Core 2.3 stores grade-aware salary structures and compensation history", () => {
  assert.ok(schema.includes('gradeId: integer("grade_id")'));
  assert.ok(schema.includes('effectiveFrom: date("effective_from").notNull()'));
  assert.ok(schema.includes('export const compensationComponents = pgTable('));
  assert.ok(schema.includes('export const employeeCompensationComponents = pgTable('));
  assert.ok(schema.includes('export const compensationEvents = pgTable('));
  assert.ok(schema.includes('workerEffectiveChangeId: integer("worker_effective_change_id")'));
  assert.ok(schema.includes('scheduledAt: timestamp("scheduled_at"'));
  assert.ok(schema.includes('appliedAt: timestamp("applied_at"'));
});

test("migration and baseline include recurring compensation and history tables", () => {
  for (const source of [migration, baseline]) {
    assert.ok(source.includes('CREATE TABLE IF NOT EXISTS "compensation_components"'));
    assert.ok(source.includes('CREATE TABLE IF NOT EXISTS "employee_compensation_components"'));
    assert.ok(source.includes('CREATE TABLE IF NOT EXISTS "compensation_events"'));
    assert.ok(source.includes('"worker_effective_change_id"'));
    assert.ok(source.includes("compensation_bands_org_scope_effective_unique"));
  }
});

test("salary band resolution prefers job profile then employer/location specificity", () => {
  const bands = [
    {
      id: 1,
      jobProfileId: null,
      gradeId: 9,
      legalEntityId: null,
      locationCode: "PH",
      effectiveFrom: "2026-01-01",
      effectiveUntil: null,
      active: true,
    },
    {
      id: 2,
      jobProfileId: 20,
      gradeId: 9,
      legalEntityId: 3,
      locationCode: "NCR",
      effectiveFrom: "2026-01-01",
      effectiveUntil: null,
      active: true,
    },
  ];
  const match = selectCompensationBand(bands, {
    effectiveDate: "2026-10-06",
    jobProfileId: 20,
    gradeId: 9,
    legalEntityId: 3,
    locationCode: "NCR",
  });
  assert.equal(match?.id, 2);
});

test("range position and recurring semi-monthly components are deterministic", () => {
  assert.equal(rangePosition(500000, 400000, 600000), 50);
  assert.equal(recurringComponentAmountForCutoff({
    amount: 6000,
    amountFrequency: "monthly",
    effectiveFrom: "2026-10-01",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-15",
  }), 3000);
  assert.equal(recurringComponentAmountForCutoff({
    amount: 6000,
    amountFrequency: "monthly",
    effectiveFrom: "2026-10-08",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-15",
  }), 1600);
  assert.equal(recurringComponentAmountForCutoff({
    amount: 1500,
    amountFrequency: "per_cutoff",
    effectiveFrom: "2026-10-01",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-15",
  }), 1500);
});

test("salary approval is maker-checker and schedules future pay without mutating current profile early", () => {
  assert.ok(route.includes("Maker-checker control: the person who submitted this compensation proposal cannot approve it."));
  assert.ok(route.includes('status: "scheduled"'));
  assert.ok(route.includes("employeePayRevisions"));
  const revisionInsert = route.indexOf("tx.insert(employeePayRevisions)");
  const proposalScheduled = route.indexOf('status: "scheduled"', revisionInsert);
  assert.ok(revisionInsert >= 0 && proposalScheduled > revisionInsert);
  assert.ok(!route.slice(revisionInsert, proposalScheduled).includes("tx.update(employeePayProfiles)"));
  assert.ok(governance.includes("applyScheduledCompensationProposal"));
  assert.ok(governance.includes("The worker's current pay changed after this compensation proposal was scheduled."));
});

test("linked promotion compensation never activates ahead of the worker movement", () => {
  assert.ok(route.includes("workerEffectiveChangeId"));
  assert.ok(route.includes("Compensation effective date must match the linked promotion effective date."));
  assert.ok(governance.includes("The linked promotion has not been successfully applied."));
  assert.ok(governance.includes('linkedPromotion.status !== "applied"'));
});

test("recurring compensation is payroll-native and date-prorated", () => {
  assert.ok(payroll.includes("employeeCompensationComponents"));
  assert.ok(payroll.includes('inArray(employeeCompensationComponents.status, ["scheduled", "active", "ended"])'));
  assert.ok(payroll.includes("recurringComponentAmountForCutoff"));
  assert.ok(payroll.includes("Recurring component"));
  assert.ok(payroll.includes("COMP-"));
});

test("compensation changes fail closed around released or busy payroll", () => {
  assert.ok(governance.includes("BUSY_PAYROLL_STATUSES"));
  assert.ok(governance.includes("already released"));
  assert.ok(governance.includes("invalidatePayrollRunsForCompensationChange"));
  assert.ok(route.includes("invalidatedPayrollRunIds"));
});

test("scheduler synchronizes current compensation only when dates become effective", () => {
  assert.ok(scheduler.includes("runScheduledCompensationGovernance"));
  assert.ok(scheduler.includes("hcmCompensation"));
  assert.ok(governance.includes('eq(compensationProposals.status, "scheduled")'));
  assert.ok(governance.includes('eq(employeeCompensationComponents.status, "scheduled")'));
  assert.ok(governance.includes('status: "applied"'));
  assert.ok(governance.includes('status: "active"'));
});

test("compensation workspace exposes salary structures recurring pay and immutable history", () => {
  assert.ok(panel.includes("HCM COMPENSATION"));
  assert.ok(panel.includes("Grade-linked range"));
  assert.ok(panel.includes("Salary or promotion pay"));
  assert.ok(panel.includes("Recurring cash components"));
  assert.ok(panel.includes("Employee pay against salary structure"));
  assert.ok(panel.includes("COMPENSATION HISTORY"));
  assert.ok(panel.includes("compa-ratio"));
  assert.ok(panel.includes("range position"));
});

test("direct Edit pay cannot bypass governed future compensation", () => {
  assert.ok(employeesRoute.includes("compensationProposals"));
  assert.ok(employeesRoute.includes("has a governed compensation change that has not finished applying"));
  assert.ok(employeesRoute.includes("already has a future pay change effective"));
  assert.ok(employeesRoute.includes('["scheduled", "failed"].includes(governedCompensation.status)'));
});

test("compensation budget UI uses only the selected cycle and refreshes concurrent decision conflicts", () => {
  assert.ok(panel.includes("proposal.cycleId === activeCycle?.id"));
  assert.ok(panel.includes("[proposals, activeCycle?.id]"));
  assert.ok(panel.includes("response.status === 409) await load()"));
  assert.ok(panel.includes("Only proposals in your assigned scope are shown"));
  assert.ok(panel.includes("remaining of"));
});

test("salary cancellation is an audited and locked financial transaction", () => {
  assert.ok(route.includes("cancelGovernedCompensationProposal({"));
  assert.ok(governance.includes("export async function cancelGovernedCompensationProposal("));
  const cancellation = governance.slice(
    governance.indexOf("export async function cancelGovernedCompensationProposal("),
    governance.indexOf("export async function applyScheduledCompensationProposal("),
  );
  const proposalLock = cancellation.indexOf("pg_advisory_xact_lock(4220");
  const cycleLock = cancellation.indexOf("pg_advisory_xact_lock(4230");
  const employeeLock = cancellation.indexOf("pg_advisory_xact_lock(4221");
  const payrollReset = cancellation.indexOf("invalidatePayrollRunsForCompensationChange(");
  const proposalDecision = cancellation.indexOf("tx.update(compensationProposals)");
  const revisionDelete = cancellation.indexOf("tx.delete(employeePayRevisions)");
  const auditWrite = cancellation.indexOf("tx.insert(auditEvents)");
  assert.ok(proposalLock >= 0 && proposalLock < cycleLock && cycleLock < employeeLock);
  assert.ok(payrollReset > employeeLock && proposalDecision > payrollReset);
  assert.ok(revisionDelete > proposalDecision && auditWrite > revisionDelete);
  assert.ok(cancellation.includes("COMPENSATION_CANCELLATION_DOWNSTREAM_REVISION"));
  assert.ok(cancellation.includes("COMPENSATION_CANCELLATION_RETROACTIVE"));
});

test("compensation workspace confirms approved pay cancellation and gives recalculation instructions", () => {
  assert.ok(panel.includes('window.confirm('));
  assert.ok(panel.includes("Calculated payroll and checker approvals for affected periods may be reset."));
  assert.ok(panel.includes("Cancel pay revision"));
  assert.ok(panel.includes("Review affected payroll and recalculate before release."));
});
