import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluatePayrollMonthClose } from "../src/lib/payroll-month-close";

const readyInput = {
  applicableMonth: "2026-09",
  runs: [{
    id: 10,
    periodLabel: "Sep 1-15",
    payDate: "2026-09-15",
    status: "Released",
    payoutCompleted: true,
    payoutReference: "BANK-123",
    journalExported: true,
    closeCompleted: true,
    closeActor: "Bookkeeper A",
  }],
  bir1601c: {
    proven: true,
    agencyReference: "BIR-1601C-SEP",
    submittedAt: "2026-10-10T00:00:00.000Z",
    recordedBy: "Tax A",
    generatorVersion: "bir-1601c-monthly-v1",
  },
  remittance: {
    certificationValid: true,
    snapshotHash: "a".repeat(64),
    certifiedByName: "Checker B",
    certifiedAt: "2026-10-25T00:00:00.000Z",
    blockerCount: 0,
  },
  inspection: {
    highFindingCount: 0,
    findingKeys: [],
    recordedExposure: 0,
    screeningExposure: 0,
  },
};

test("payroll month close becomes ready only when every evidence gate is complete", () => {
  const result = evaluatePayrollMonthClose(readyInput);
  assert.equal(result.ready, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.runCount, 1);
  assert.match(result.snapshotHash, /^[a-f0-9]{64}$/);
});

test("unsettled payout, missing journal and missing cutoff close all block month certification", () => {
  const result = evaluatePayrollMonthClose({
    ...readyInput,
    runs: [{
      ...readyInput.runs[0],
      payoutCompleted: false,
      journalExported: false,
      closeCompleted: false,
    }],
  });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((item) => /payout is not confirmed/i.test(item)));
  assert.ok(result.blockers.some((item) => /journal has not been exported/i.test(item)));
  assert.ok(result.blockers.some((item) => /accounting close has not been completed/i.test(item)));
});

test("BIR, remittance certification and high inspection findings are hard month-close gates", () => {
  const result = evaluatePayrollMonthClose({
    ...readyInput,
    bir1601c: { ...readyInput.bir1601c, proven: false },
    remittance: { ...readyInput.remittance, certificationValid: false, blockerCount: 2 },
    inspection: {
      highFindingCount: 1,
      findingKeys: ["PAYSLIP_MISSING:run:10:employee:3"],
      recordedExposure: 0,
      screeningExposure: 0,
    },
  });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((item) => /1601-C/i.test(item)));
  assert.ok(result.blockers.some((item) => /2 live blocker/i.test(item)));
  assert.ok(result.blockers.some((item) => /1 high labor-inspection/i.test(item)));
});

test("month close snapshot changes when underlying evidence changes", () => {
  const first = evaluatePayrollMonthClose(readyInput);
  const second = evaluatePayrollMonthClose({
    ...readyInput,
    runs: [{ ...readyInput.runs[0], payoutReference: "BANK-456" }],
  });
  assert.notEqual(first.snapshotHash, second.snapshotHash);
});

test("no payroll runs cannot produce a false green month certificate", () => {
  const result = evaluatePayrollMonthClose({ ...readyInput, runs: [] });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((item) => /No payroll runs/i.test(item)));
});

test("month close route enforces prior-month independent MFA certification", () => {
  const route = readFileSync("src/app/api/compliance/payroll-month-close/route.ts", "utf8");
  assert.ok(route.includes('const CERTIFY_ROLES = ["owner", "admin", "checker"]'));
  assert.ok(route.includes("company-wide"));
  assert.ok(route.includes("applicableMonth >= currentManilaMonth()"));
  assert.ok(route.includes("requireSensitiveActionMfa(user)"));
  assert.ok(route.includes("enforceSameOriginMutation(request)"));
  assert.ok(route.includes("enforceSensitiveActionRateLimit(request"));
  assert.ok(route.includes("current.evidenceActors.includes(user.name)"));
  assert.ok(route.includes("participated in payout, journal, payroll close, BIR evidence, or remittance certification"));
});

test("month certification preserves the full evidence snapshot and immutable history", () => {
  const route = readFileSync("src/app/api/compliance/payroll-month-close/route.ts", "utf8");
  const schema = readFileSync("src/db/schema.ts", "utf8");
  assert.ok(schema.includes("export const payrollMonthClosures = pgTable("));
  assert.ok(schema.includes('evidenceSnapshot: jsonb("evidence_snapshot").notNull()'));
  assert.ok(schema.includes('uniqueIndex("payroll_month_closure_snapshot_unique")'));
  assert.ok(route.includes("evidenceSnapshot: current.evaluation.evidence"));
  assert.ok(route.includes("existingSnapshot"));
  assert.ok(route.includes("certificationHistoryPreserved: true"));
  assert.ok(!route.includes("db.update(payrollMonthClosures)"));
});

test("server rechecks live remittance certification, BIR evidence, payout and inspection evidence", () => {
  const server = readFileSync("src/lib/payroll-month-close-server.ts", "utf8");
  assert.ok(server.includes("evaluateRemittanceMonthClose"));
  assert.ok(server.includes("closure.snapshotHash === evaluation.snapshotHash"));
  assert.ok(server.includes('findFilingForm("BIR", "1601-C")'));
  assert.ok(server.includes("provesOperationalFiling"));
  assert.ok(server.includes("derivePayrollPayoutState"));
  assert.ok(server.includes("buildLaborInspectionReadiness"));
  assert.ok(server.includes('finding.severity === "high"'));
});

test("month close self-initializes schema and is visible in Compliance Center", () => {
  const guard = readFileSync("src/lib/payroll-month-close-schema.ts", "utf8");
  const panels = readFileSync("src/components/workspace/panels.tsx", "utf8");
  const ui = readFileSync("src/components/workspace/payroll-month-close-panel.tsx", "utf8");
  assert.ok(guard.includes("CREATE TABLE IF NOT EXISTS payroll_month_closures"));
  assert.ok(guard.includes("pg_advisory_xact_lock"));
  assert.ok(panels.includes("PayrollMonthClosePanel"));
  assert.ok(ui.includes("One certificate for the month, backed by every underlying control."));
  assert.ok(ui.includes("not a government certification"));
});
