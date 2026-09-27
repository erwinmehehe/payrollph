import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../src/db";
import { employees, organizations, payrollEntries, payrollRuns } from "../src/db/schema";
import { generateGovernmentDraft } from "../src/lib/exporters";

// Regression test for two real bugs found while cross-checking payroll-rules.ts
// against an independent PH payroll reference package:
//   1. EC was hardcoded to ₱10.00 for every employee, regardless of their
//      actual MSC. Correct EC is ₱30 once MSC reaches ₱15,000 — which is most
//      employees earning above roughly ₱15,000/month basic pay.
//   2. The exporter read SSS from a single payroll run's stored line item,
//      which is only half the monthly amount by design (payroll-engine.ts
//      splits SSS evenly across the two semi-monthly cutoffs). SSS R-3 is a
//      monthly filing, so the draft now recomputes full monthly figures from
//      computeSss() directly instead of reading (and silently under-reporting)
//      a half-month deduction.

test("SSS R-3 draft reports correct EC and full monthly SSS for an employee above the EC threshold", async () => {
  const [org] = await db.insert(organizations).values({
    name: "SSS Draft Test Co",
    legalName: "SSS Draft Test Corp",
    plan: "Core",
  }).returning();

  const [employee] = await db.insert(employees).values({
    organizationId: org.id,
    employeeNo: "SS-001",
    firstName: "Rico",
    lastName: "Bautista",
    title: "Staff",
    avatarInitials: "RB",
    basicRate: "30000", // MSC clamps to 30,000 -> EC must be ₱30, not the old hardcoded ₱10
    startDate: "2026-01-01",
  }).returning();

  const [run] = await db.insert(payrollRuns).values({
    organizationId: org.id,
    periodLabel: "Test Period",
    payDate: "2026-09-30",
  }).returning();

  // Stored line item deliberately holds only the half-month SSS amount, the
  // way the real payroll engine actually stores it, to prove the exporter no
  // longer reads (and doubles or under-reports) this half-month figure.
  await db.insert(payrollEntries).values({
    payrollRunId: run.id,
    employeeId: employee.id,
    grossPay: "15000.00",
    deductions: "750.00",
    netPay: "14250.00",
    lineItems: [{ code: "SSS", amount: "-750.00" }],
  });

  const file = await generateGovernmentDraft(run.id, "sss-r3");
  const dataLine = file.body.split("\n").find((line) => line.includes("Bautista"));
  assert.ok(dataLine, "expected a data row for the seeded employee");

  // MSC 30,000 -> employee 5% = 1,500.00 (full month, not the stored 750 half-month figure).
  assert.ok(dataLine!.includes("1500.00"), `expected full monthly SSS employee share of 1500.00, got: ${dataLine}`);
  // MSC 30,000 >= 15,000 -> EC must be 30.00, not the old hardcoded 10.00.
  assert.ok(dataLine!.includes("30.00"), `expected EC of 30.00 at this MSC, got: ${dataLine}`);
  assert.ok(!dataLine!.includes(",\"10.00\","), `EC must not fall back to the old hardcoded 10.00: ${dataLine}`);
});
