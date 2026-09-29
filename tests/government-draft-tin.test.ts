import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../src/db";
import { employees, organizations, payrollEntries, payrollRuns } from "../src/db/schema";
import { generateGovernmentDraft } from "../src/lib/exporters";

// BIR annual exports stay fail-closed: this test covers the source extract
// fields Linaw can verify without pretending a cutoff CSV is the exact
// 1604-C DAT contract accepted by the current Alphalist validation module.

test("Alphalist draft keeps employer and employee TIN/branch fields separate", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Gov Draft Test Co",
    legalName: "Gov Draft Test Corp",
    plan: "Core",
    birTin: "987654321",
    birBranchCode: "0000",
  }).returning();

  const [employee] = await db.insert(employees).values({
    organizationId: org.id,
    employeeNo: "GD-001",
    firstName: "Ana",
    lastName: "Reyes",
    title: "Staff",
    avatarInitials: "AR",
    basicRate: "30000",
    startDate: "2026-01-01",
    tin: "123456789",
    tinBranchCode: "0001",
  }).returning();

  const [run] = await db.insert(payrollRuns).values({
    organizationId: org.id,
    periodLabel: "Sep 16–30, 2026",
    periodStart: "2026-09-16",
    periodEnd: "2026-09-30",
    payDate: "2026-09-30",
  }).returning();

  await db.insert(payrollEntries).values({
    payrollRunId: run.id,
    employeeId: employee.id,
    grossPay: "30000.00",
    deductions: "2000.00",
    netPay: "28000.00",
    lineItems: [{ code: "WHT", amount: "-500.00" }],
  });

  const file = await generateGovernmentDraft(run.id, "bir-1604c-source");
  const dataLine = file.body.split("\n").find((line) => line.includes("Reyes"));

  assert.ok(dataLine, "expected a data row for the seeded employee");
  assert.ok(
    dataLine!.startsWith('"987654321","0000","123456789","0001"'),
    `expected explicit employer and employee TIN/branch fields, got: ${dataLine}`,
  );
});


test("government exporter refuses unknown display labels instead of guessing a BIR file", async () => {
  await assert.rejects(
    () => generateGovernmentDraft(1, "Alphalist/2316"),
    /Unsupported government export/,
  );
});
