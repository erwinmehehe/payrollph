import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../src/db";
import { employees, organizations, payrollEntries, payrollRuns } from "../src/db/schema";
import { generateGovernmentDraft } from "../src/lib/exporters";

// Regression test for two real bugs found while cross-checking payroll-rules.ts
// against an independent PH payroll reference package:
//   1. EC was hardcoded to ₱10.00 for every employee, regardless of their
//      actual MSC. Correct EC is ₱30 once MSC reaches ₱15,000, which is most
//      employees earning above roughly ₱15,000/month basic pay.
//   2. The exporter must report full monthly SSS/MPF/EC components regardless
//      of the employer's configured cutoff deduction timing. It recomputes the
//      monthly figures from the payroll statutory remuneration trace instead of
//      treating a single cutoff's deduction as the monthly filing amount.

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
    middleName: "M",
    lastName: "Bautista",
    title: "Staff",
    avatarInitials: "RB",
    sssNo: "34-1234567-8",
    basicRate: "30000", // MSC clamps to 30,000 -> EC must be ₱30, not the old hardcoded ₱10
    startDate: "2026-01-01",
  }).returning();

  const [run] = await db.insert(payrollRuns).values({
    organizationId: org.id,
    periodLabel: "Sep 16–30, 2026",
    periodStart: "2026-09-16",
    periodEnd: "2026-09-30",
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

  // MSC 30,000 -> EE Regular SS 1,000 + EE MPF 500 = 1,500 full-month employee share.
  assert.ok(dataLine!.includes("34-1234567-8"), "expected the real SSS number, not the internal employee number");
  const fields = [...dataLine!.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
  assert.equal(fields[4], "30000.00");
  assert.equal(Number(fields[7]) + Number(fields[8]), 1500);
  assert.equal(Number(fields[9]) + Number(fields[10]), 3000);
  // MSC 30,000 >= 15,000 -> EC must be 30.00, not the old hardcoded 10.00.
  assert.equal(fields[11], "30.00");
  assert.equal(fields[12], "4530.00");
});
