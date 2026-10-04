import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employeePayProfiles,
  employees,
  organizations,
  orgUnits,
  payrollRuns,
} from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { settlePayrollRun } from "../src/lib/payroll-settlement";
import { generateGovernmentDraft } from "../src/lib/exporters";

async function addEmployee(input: {
  organizationId: number;
  orgUnitId: number;
  employeeNo: string;
  lastName: string;
}) {
  const [employee] = await db.insert(employees).values({
    organizationId: input.organizationId,
    orgUnitId: input.orgUnitId,
    employeeNo: input.employeeNo,
    firstName: "Monthly",
    lastName: input.lastName,
    title: "Associate",
    avatarInitials: "MW",
    basicRate: "30000.00",
    startDate: "2025-01-01",
    mobile: input.employeeNo === "SEP-001" ? "09171111111" : "09172222222",
    sssNo: `34-${input.employeeNo === "SEP-001" ? "1111111" : "2222222"}-1`,
    philHealthNo: input.employeeNo === "SEP-001" ? "12-111111111-1" : "12-222222222-2",
    pagIbigNo: input.employeeNo === "SEP-001" ? "111111111111" : "222222222222",
  }).returning();

  await db.insert(employeePayProfiles).values({
    organizationId: input.organizationId,
    employeeId: employee.id,
    payBasis: "monthly",
    rateAmount: "30000.00",
    standardWorkDaysPerMonth: "22",
    standardHoursPerDay: "8",
  });
  return employee;
}

async function calculateScopedRun(input: {
  organizationId: number;
  orgUnitId: number;
  label: string;
  start: string;
  end: string;
  payDate: string;
}) {
  const [run] = await db.insert(payrollRuns).values({
    organizationId: input.organizationId,
    scopeOrgUnitId: input.orgUnitId,
    periodLabel: input.label,
    periodStart: input.start,
    periodEnd: input.end,
    scopeLabel: input.label,
    status: "Draft",
    payDate: input.payDate,
  }).returning();
  await enqueuePayrollRun(run.id);
  await drainPayrollQueue(20, run.id);
  const [fresh] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, run.id));
  assert.equal(fresh.status, "Needs review");
  return fresh;
}

async function releaseRun(runId: number) {
  await db.update(payrollRuns).set({ status: "Releasing" }).where(eq(payrollRuns.id, runId));
  await settlePayrollRun(runId, { actor: "P0 QA", resource: `Run #${runId}` });
}

test("monthly SSS, PhilHealth and Pag-IBIG worksheets retain a first-cutoff employee who separates before the final cutoff", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Monthly Population P0 QA",
    legalName: "Monthly Population P0 QA Inc.",
    plan: "Core",
  }).returning();

  try {
    const [unitA, unitB] = await db.insert(orgUnits).values([
      { organizationId: org.id, type: "Department", name: "Unit A", code: "UA" },
      { organizationId: org.id, type: "Department", name: "Unit B", code: "UB" },
    ]).returning();

    const separated = await addEmployee({
      organizationId: org.id,
      orgUnitId: unitA.id,
      employeeNo: "SEP-001",
      lastName: "SeparatedWorker",
    });
    await addEmployee({
      organizationId: org.id,
      orgUnitId: unitB.id,
      employeeNo: "ACT-001",
      lastName: "ActiveWorker",
    });

    // Two independently scoped first-cutoff payrolls prove that the monthly
    // population is organization-wide rather than tied to one run or org unit.
    const firstA = await calculateScopedRun({
      organizationId: org.id,
      orgUnitId: unitA.id,
      label: "Unit A Aug 1-15",
      start: "2026-08-01",
      end: "2026-08-15",
      payDate: "2026-08-15",
    });
    const firstB = await calculateScopedRun({
      organizationId: org.id,
      orgUnitId: unitB.id,
      label: "Unit B Aug 1-15",
      start: "2026-08-01",
      end: "2026-08-15",
      payDate: "2026-08-15",
    });
    await releaseRun(firstA.id);
    await releaseRun(firstB.id);

    // Employee in Unit A separates before the month-final payroll and therefore
    // is intentionally absent from the Aug 16-31 active payroll population.
    await db.update(employees)
      .set({ status: "Separated" })
      .where(eq(employees.id, separated.id));

    const finalB = await calculateScopedRun({
      organizationId: org.id,
      orgUnitId: unitB.id,
      label: "Unit B Aug 16-31",
      start: "2026-08-16",
      end: "2026-08-31",
      payDate: "2026-08-31",
    });

    for (const kind of ["sss-r3", "philhealth-rf1", "pagibig-mcrf"] as const) {
      const draft = await generateGovernmentDraft(finalB.id, kind);
      assert.match(
        draft.body,
        /SeparatedWorker/,
        `${kind} must retain the employee paid in the first cutoff even after separation`,
      );
      assert.match(draft.body, /ActiveWorker/);
    }
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
