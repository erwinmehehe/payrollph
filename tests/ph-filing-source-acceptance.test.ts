import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { employees, legalEntities, organizations, payrollEntries, payrollRuns } from "../src/db/schema";
import { findFilingForm, parseFilingOutcome } from "../src/lib/filing-evidence";
import { recordFilingOutcome, recordGeneratedFiling } from "../src/lib/filing-evidence-store";

async function makeSyntheticRun(status: string) {
  const [org] = await db.insert(organizations).values({
    name: "Government Filing Source Gate Synthetic",
    legalName: "Synthetic Filing Source Gate Ltd.",
    plan: "Core",
  }).returning();
  const [entity] = await db.insert(legalEntities).values({
    organizationId: org.id, code: "PRIMARY", legalName: "Synthetic Filing Source Gate Ltd.",
    displayName: "Synthetic Filing Source Gate", primaryEntity: true, active: true,
  }).returning();
  const [employee] = await db.insert(employees).values({
    organizationId: org.id, legalEntityId: entity.id, employeeNo: "FSG-1",
    firstName: "Synthetic", middleName: "S", lastName: "Worker", title: "Staff",
    avatarInitials: "SW", sssNo: "34-1234567-8", basicRate: "20000", startDate: "2026-01-01",
  }).returning();
  const [run] = await db.insert(payrollRuns).values({
    organizationId: org.id, legalEntityId: entity.id,
    periodLabel: "September 2026", periodStart: "2026-09-01", periodEnd: "2026-09-30",
    payDate: "2026-09-30", status,
  }).returning();
  await db.insert(payrollEntries).values({
    payrollRunId: run.id, employeeId: employee.id,
    grossPay: "20000", deductions: "0", netPay: "20000",
  });
  return { org, employee, run };
}

function agencyAcceptance() {
  const outcome = parseFilingOutcome({
    outcome: "accepted", submissionMethod: "file_upload",
    agencyReference: "SSS-TEST-RECEIPT", submittedAt: new Date().toISOString(),
  });
  assert.ok(outcome.ok);
  return outcome.ok ? outcome.value : (undefined as never);
}

const SSS = findFilingForm("SSS", "R-3")!;

test("agency acceptance cannot be recorded for a payroll run still in Draft", async () => {
  const { org, run } = await makeSyntheticRun("Draft");
  try {
    const { record } = await recordGeneratedFiling({
      organizationId: org.id, runId: run.id, definition: SSS, actor: "Tester",
    });
    await assert.rejects(() => recordFilingOutcome({
      organizationId: org.id, id: record.id, actor: "Tester", outcome: agencyAcceptance(),
    }), /not released/);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("agency acceptance cannot use a worksheet whose source data changed", async () => {
  const { org, employee, run } = await makeSyntheticRun("Released");
  try {
    const { record } = await recordGeneratedFiling({
      organizationId: org.id, runId: run.id, definition: SSS, actor: "Tester",
    });
    await db.update(employees).set({ basicRate: "15000" }).where(eq(employees.id, employee.id));
    await assert.rejects(() => recordFilingOutcome({
      organizationId: org.id, id: record.id, actor: "Tester", outcome: agencyAcceptance(),
    }), /no longer matches/);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
