import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { employees, organizations, payrollEntries, payrollRuns } from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { evaluatePayrollAssurance } from "../src/lib/payroll-assurance";
import { buildPayrollAssurance } from "../src/lib/payroll-assurance-server";
import { buildPayrollReleaseChecklist } from "../src/lib/payroll-release-checklist";
import { seedMonthlyPayProfilesForRun } from "./helpers/pay-profiles";

test("low-gross payroll prints actual collected deductions, keeps shortfall visible and blocks approval", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Mandatory Shortfall Synthetic",
    legalName: "Mandatory Shortfall Synthetic Inc.",
    plan: "Core",
  }).returning();
  try {
    await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: `M8-LOW-${org.id}`,
      firstName: "Low",
      lastName: "Gross",
      title: "Associate",
      avatarInitials: "LG",
      basicRate: "100.00", // Synthetic extreme to force SSS/PHIC/HDMF shortfall.
      startDate: "2025-01-01",
    });
    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 1-15 2026 mandatory shortfall test",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-15",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-09-15",
    }).returning();

    await seedMonthlyPayProfilesForRun(run.id);

    await enqueuePayrollRun(run.id);
    await drainPayrollQueue(10, run.id);
    const entries = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
    assert.equal(entries.length, 1);
    const entry = entries[0];
    assert.equal(entry.status, "Exception");
    const trace = entry.trace as { flags?: string[]; inputs?: string[] };
    assert.ok(trace.flags?.some(flag => flag.startsWith("PAYROLL_MANDATORY_SHORTFALL:")));
    const raw = trace.inputs?.find(value => value.startsWith("mandatoryUncollected="));
    assert.ok(raw && Number(raw.slice("mandatoryUncollected=".length)) > 0);

    const lines = entry.lineItems as Array<{ code: string; amount: string; label: string }>;
    const unpaid = lines.find(line => line.code === "UNPAID_MANDATORY");
    assert.ok(unpaid, "uncollected liability must be displayed, including when its monetary line is zero");
    assert.equal(Number(unpaid.amount), 0, "uncollected debt must not masquerade as an earning");
    const printedNetCents = lines.reduce((sum, line) => sum + Math.round(Number(line.amount) * 100), 0);
    assert.equal(printedNetCents, Math.round(Number(entry.netPay) * 100),
      "printed positive and negative amounts must foot exactly to stored net pay");
    assert.equal(Math.round((Number(entry.grossPay) - Number(entry.deductions)) * 100),
      Math.round(Number(entry.netPay) * 100));
    const assurance = evaluatePayrollAssurance(entries);
    assert.ok(assurance.findings.some(f =>
      f.code === "MANDATORY_DEDUCTIONS_UNCOLLECTED" && f.blocking),
      "an operator cannot waive a mandatory debt exception by acknowledging warnings");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});


const isolated = (() => {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return process.env.CI === "true"
      && process.env.GITHUB_ACTIONS === "true"
      && ["127.0.0.1", "localhost"].includes(url.hostname)
      && url.pathname === "/app_db" && url.port === "5432"
      && url.username === "postgres" && !url.search && !url.hash;
  } catch { return false; }
})();

test("two isolated synthetic employers retain separate shortfall and release evidence", {
  skip: !isolated,
}, async () => {
  const orgs = await db.insert(organizations).values([
    { name: "M8 Tenant A Synthetic", legalName: "M8 Tenant A Inc.", plan: "Core" },
    { name: "M8 Tenant B Synthetic", legalName: "M8 Tenant B Inc.", plan: "Core" },
  ]).returning();
  const [a, b] = orgs;
  try {
    await db.insert(employees).values([
      {
        organizationId: a.id, employeeNo: `M8-A-${a.id}`,
        firstName: "Low", lastName: "Income", title: "Associate",
        avatarInitials: "LI", basicRate: "100.00", startDate: "2025-01-01",
      },
      {
        organizationId: b.id, employeeNo: `M8-B-${b.id}`,
        firstName: "Normal", lastName: "Income", title: "Associate",
        avatarInitials: "NI", basicRate: "30000.00", startDate: "2025-01-01",
      },
    ]);
    const runs = await db.insert(payrollRuns).values([
      {
        organizationId: a.id, periodLabel: "Tenant A Sep 1-15 2026 synthetic",
        periodStart: "2026-09-01", periodEnd: "2026-09-15",
        scopeLabel: "All locations", status: "Draft", payDate: "2026-09-15",
      },
      {
        organizationId: b.id, periodLabel: "Tenant B Sep 1-15 2026 synthetic",
        periodStart: "2026-09-01", periodEnd: "2026-09-15",
        scopeLabel: "All locations", status: "Draft", payDate: "2026-09-15",
      },
    ]).returning();
    for (const run of runs) {
      await seedMonthlyPayProfilesForRun(run.id);
      await enqueuePayrollRun(run.id);
      await drainPayrollQueue(10, run.id);
    }
    const [entryA] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, runs[0].id));
    const [entryB] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, runs[1].id));
    assert.ok(entryA && entryB && entryA.id !== entryB.id);
    assert.notEqual(entryA.employeeId, entryB.employeeId);
    const auditA = await buildPayrollAssurance(runs[0].id);
    const auditB = await buildPayrollAssurance(runs[1].id);
    assert.ok(auditA && auditB);
    assert.ok(auditA.assurance.findings.some(f =>
      f.code === "MANDATORY_DEDUCTIONS_UNCOLLECTED" && f.blocking
      && f.employeeId === entryA.employeeId
    ));
    assert.ok(auditA.assurance.findings.every(f =>
      f.employeeId === undefined || f.employeeId === entryA.employeeId
    ), "Tenant A payroll findings must not contain tenant B worker data");
    assert.ok(auditB.assurance.findings.every(f =>
      f.employeeId === undefined || f.employeeId === entryB.employeeId
    ), "Tenant B payroll findings must not contain tenant A worker data");

    // Even when the operator acknowledges all reviewable exceptions and is
    // allowed to use synthetic-only bank destinations, the mandatory shortage
    // stays an unwaivable statutory release blocker.
    const checklistA = await buildPayrollReleaseChecklist(runs[0].id, {
      acknowledgeExceptions: true, allowRedactedDemoPayout: true,
    });
    assert.ok(checklistA);
    const exceptions = checklistA.items.find(item => item.key === "exceptions");
    assert.ok(exceptions && exceptions.blocking && !exceptions.passed);
    assert.equal(exceptions.acknowledgeable, false);
    assert.equal(checklistA.ready, false);
  } finally {
    for (const org of orgs) {
      await db.delete(organizations).where(eq(organizations.id, org.id));
    }
  }
});
