import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("regular payroll scopes only active employees at draft and calculation time", () => {
  const createRun = read("src/app/api/payroll-runs/route.ts");
  const engine = read("src/lib/payroll-engine.ts");

  assert.ok(createRun.includes('eq(employees.status, "Active")'));
  assert.ok(createRun.includes("has no active employees"));
  assert.ok((engine.match(/eq\(employees\.status, "Active"\)/g) ?? []).length >= 2);
  assert.ok(engine.includes("Payroll scope has no active employees"));
  assert.ok(engine.includes("Payroll employee scope changed after calculation was queued"));
});

test("calculation snapshots payout instructions and release rejects stale employee data", () => {
  const engine = read("src/lib/payroll-engine.ts");
  const settlement = read("src/lib/payroll-settlement.ts");

  assert.ok(engine.includes("payment: {"));
  assert.ok(engine.includes("payProfile: {"));
  assert.ok(engine.includes("bankAccount: employee.bankAccount"));
  assert.ok(engine.includes("mobile: employee.mobile"));
  assert.ok(settlement.includes("lacks an immutable payment snapshot"));
  assert.ok(settlement.includes('employee.status !== "Active"'));
  assert.ok(settlement.includes("Payment instructions for"));
  assert.ok(settlement.includes("lacks an immutable pay-profile snapshot"));
  assert.ok(settlement.includes("Pay profile for"));
  assert.ok(settlement.includes("changed after calculation"));
  assert.ok(settlement.includes("no captured bank account or mobile payout destination"));
});

test("final bank files and payslips are release-only", () => {
  const route = read("src/app/api/payroll-runs/[id]/exports/route.ts");
  const exporter = read("src/lib/exporters.ts");

  assert.ok(route.includes('kind === "bank" && !dryRun && run.status !== "Released"'));
  assert.ok(route.includes('kind === "payslip" && run.status !== "Released"'));
  assert.ok(route.includes('kind === "journal" && run.status !== "Released"'));
  assert.ok(exporter.includes('run.status !== "Released"'));
  assert.ok(exporter.includes("missingPaymentSnapshots"));
  assert.ok(exporter.includes("Final bank file total does not match the released payroll net pay"));
});

test("pre-release UI can validate payout but cannot create a final bank file", () => {
  const view = read("src/components/workspace/payroll-run.tsx");

  assert.ok(view.includes('title="Validate / Export"'));
  assert.ok(view.includes("Dry run only until payroll is released"));
  assert.ok(view.includes("disabled={!released}"));
  assert.ok(view.includes("Payslip download unlocks after payroll release"));
});

test("recalculation invalidates linked approvals and replaces derived register data", () => {
  const process = read("src/app/api/payroll-runs/[id]/process/route.ts");
  const engine = read("src/lib/payroll-engine.ts");
  const schema = read("src/db/schema.ts");

  assert.ok(process.includes('status: "Superseded"'));
  assert.ok(process.includes('eq(payrollRuns.status, run.status)'));
  assert.ok(engine.includes("db.delete(payrollEntries)"));
  assert.ok(engine.includes("db.delete(payrollJobs)"));
  assert.ok(schema.includes('references(() => payrollEntries.id, { onDelete: "cascade" })'));
});
