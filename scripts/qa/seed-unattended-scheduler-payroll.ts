import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { employeePayProfiles, employees, organizations, payrollEntries, payrollJobs, payrollRuns, timePunches } from "../../src/db/schema";
import { enqueuePayrollRun } from "../../src/lib/payroll-engine";

/**
 * Recovery-rehearsal tests intentionally forbid running the central scheduler.
 * This *different* end-to-end proof explicitly runs it only inside an
 * auto-triggered GitHub workflow and disposable local PostgreSQL. Do NOT
 * weaken assertIsolatedSchedulerRehearsal to allow the scheduler globally.
 */
function assertDisposableUnattendedSeed(env: NodeJS.ProcessEnv) {
  assert.equal(env.CI, "true");
  assert.equal(env.GITHUB_ACTIONS, "true");
  assert.ok(env.GITHUB_EVENT_NAME === "pull_request" || env.GITHUB_EVENT_NAME === "push");
  assert.ok(env.GITHUB_RUN_ID, "Only automatic GitHub CI runs may seed test payroll");
  assert.equal(env.SCHEDULER_REHEARSAL_MODE, "isolated-ci-only");
  assert.equal(env.UNATTENDED_SCHEDULER_SYNTHETIC_PROOF, "true");
  assert.equal(env.CENTRAL_SCHEDULER_ENABLED, "true", "Central scheduler may run ONLY in disposable CI");
  assert.equal(env.WORKER_ENABLED, "false", "App payroll worker must be separate");
  assert.equal(env.PAYROLL_SCHEDULER_DISPATCH_ENABLED, "false");
  assert.equal(env.DEMO_MODE, "false");
  assert.match(env.VERCEL_GIT_COMMIT_SHA ?? "", /^[0-9a-f]{40}$/);
  assert.ok((env.WORKER_TOKEN ?? "").length >= 32);
  const target = new URL(env.DATABASE_URL ?? "");
  assert.ok(target.protocol === "postgres:" || target.protocol === "postgresql:");
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.port, "5432");
  assert.equal(target.pathname, "/app_db");
  assert.equal(target.username, "postgres");
  assert.equal(target.password, "postgres");
  assert.equal(target.search, "");
  assert.equal(target.hash, "");
  for (const flag of [
    "PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED",
    "XENDIT_PAYOUTS_LIVE_APPROVED",
  ]) assert.equal(env[flag], "false", flag + " must be explicitly disabled");
  for (const key of [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "RESEND_API_KEY",
    "POSTMARK_SERVER_TOKEN", "OPENAI_API_KEY",
  ]) assert.equal(env[key] ?? "", "", key + " must be absent");
}

/**
 * Creates one fictional, unreleased payroll. No API call processes this job.
 * A SEPARATE autonomous worker must pick it up after GitHub starts the
 * scheduled-tick acceptance workflow.
 */
async function main() {
  assertDisposableUnattendedSeed(process.env);

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
  // Synthetic employees are inserted directly, bypassing the usual employee
  // creation route. Supply the explicit monthly pay profile at fixture-seed
  // time; production payroll rightly refuses missing profiles rather than
  // silently backfilling or changing employee compensation at calculation time.
  await db.insert(employeePayProfiles).values({
    organizationId: org.id,
    employeeId: employee.id,
    payBasis: "monthly",
    rateAmount: "30000.00",
    standardWorkDaysPerMonth: "22.00",
    standardHoursPerDay: "8.00",
  });
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
