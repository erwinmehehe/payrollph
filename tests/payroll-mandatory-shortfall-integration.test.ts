import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { employees, organizations, payrollEntries, payrollRuns } from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { evaluatePayrollAssurance } from "../src/lib/payroll-assurance";

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
