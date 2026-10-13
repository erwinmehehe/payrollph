import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { employees, organizations, payrollEntries, payrollJobs, payrollRuns, timePunches } from "../../src/db/schema";
import { enqueuePayrollRun } from "../../src/lib/payroll-engine";
import { assertIsolatedSchedulerRehearsal } from "../../tests/helpers/scheduler-isolated-guard";

/**
 * Creates one fictional, unreleased payroll. No API call processes this job.
 * A SEPARATE autonomous worker must pick it up after GitHub starts the
 * scheduled-tick acceptance workflow.
 */
async function main() {
  assertIsolatedSchedulerRehearsal(process.env);
  assert.equal(process.env.UNATTENDED_SCHEDULER_SYNTHETIC_PROOF, "true");
  assert.equal(process.env.DEMO_MODE, "false");
  for (const flag of ["PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED", "XENDIT_PAYOUTS_LIVE_APPROVED"]) {
    assert.notEqual(process.env[flag], "true", flag + " must remain OFF");
  }
  for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "OPENAI_API_KEY"]) {
    assert.equal(process.env[key] ?? "", "", key + " must not exist in synthetic acceptance");
  }

  const [org] = await db.insert(organizations).values({
    name: "CI Scheduler Fictional Employer",
    legalName: "CI Scheduler Fictional Employer (TEST ONLY)",
    plan: "Core",
  }).returning({ id: organizations.id });
  const [employee] = await db.insert(employees).values({
    organizationId: org.id,
    employeeNo: "CI-SCHED-001",
    firstName: "Fictional",
    lastName: "Worker",
    title: "Synthetic payroll fixture",
    avatarInitials: "FW",
    basicRate: "30000.00",
    startDate: "2026-01-01",
    status: "Active",
    region: "NCR",
  }).returning({ id: employees.id });
  for (const date of ["2026-09-22", "2026-09-24"]) {
    await db.insert(timePunches).values({
      organizationId: org.id,
      employeeId: employee.id,
      workDate: date,
      timeIn: new Date(date + "T09:00:00+08:00"),
      timeOut: new Date(date + "T18:00:00+08:00"),
      shiftStart: "09:00",
      shiftEnd: "18:00",
      status: "Complete",
    });
  }

  const [run] = await db.insert(payrollRuns).values({
    organizationId: org.id,
    periodLabel: "Sep 16-30 2026 synthetic scheduler proof",
    periodStart: "2026-09-16",
    periodEnd: "2026-09-30",
    payDate: "2026-09-30",
    scopeLabel: "Fictional staff",
    status: "Draft",
  }).returning({ id: payrollRuns.id });
  await enqueuePayrollRun(run.id);
  const [queued] = await db.select().from(payrollJobs).where(eq(payrollJobs.payrollRunId, run.id));
  assert.equal(queued?.status, "queued");
  assert.equal((await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id))).length, 0);
  mkdirSync("qa-artifacts", { recursive: true });
  writeFileSync("qa-artifacts/p0-1-unattended-seed.json", JSON.stringify({
    synthetic: true, organizationId: org.id, runId: run.id, employeeId: employee.id,
    seeded: "queued", at: new Date().toISOString(),
  }, null, 2));
  process.stdout.write("PASS fictional payroll queued; no manual payroll processing or endpoint call\n");
}
main().catch(() => {
  console.error("P0-1 synthetic payroll seeding failed (sensitive details suppressed).");
  process.exitCode = 1;
}).finally(() => pool.end());
