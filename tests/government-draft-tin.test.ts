import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../src/db";
import { employees, organizations, payrollEntries, payrollRuns } from "../src/db/schema";
import { generateGovernmentDraft } from "../src/lib/exporters";

// BIR's documented convention for the Alphalist/RELIEF TIN field is 9 digits
// plus a separate branch code, with no hyphens or spaces (see
// bir-excel-uploader.com's public field-formatting guide, which follows
// BIR's own published spec). This is the one part of the ADES layout safe to
// implement without the full byte-level spec in hand — everything else in
// this draft stays an honest DRAFT rather than a guessed byte layout.

test("Alphalist draft splits a hyphenated TIN into 9-digit TIN + branch code", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Gov Draft Test Co",
    legalName: "Gov Draft Test Corp",
    plan: "Core",
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
    tin: "123-456-789-0001",
  }).returning();

  const [run] = await db.insert(payrollRuns).values({
    organizationId: org.id,
    periodLabel: "Test Period",
    periodStart: "2026-01-01",
    periodEnd: "2026-01-15",
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

  const file = await generateGovernmentDraft(run.id, "bir-alphalist-2316");
  const dataLine = file.body.split("\n").find((line) => line.includes("Reyes"));

  assert.ok(dataLine, "expected a data row for the seeded employee");
  assert.ok(dataLine!.startsWith('"123456789","0001"'), `expected split TIN/branch code, got: ${dataLine}`);
});
