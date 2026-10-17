import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { organizations, payrollRuns } from "../src/db/schema";
import { SchedulerJobsIncompleteError, tickScheduler } from "../src/lib/scheduler";
import { assertIsolatedSchedulerRehearsal } from "./helpers/scheduler-isolated-guard";

const isolatedCiOnly = process.env.CI === "true"
  ? {} : { skip: "Fault injection requires a disposable PG16 CI database." };

// These fault-injection tests use the same disposable PG fixture as the other
// scheduler integration tests. They never submit filings, transfer funds, or
// enable any production scheduler release flag.
async function withCentralScheduler(run: () => Promise<void>) {
  const prior = process.env.CENTRAL_SCHEDULER_ENABLED;
  process.env.CENTRAL_SCHEDULER_ENABLED = "true";
  try { await run(); }
  finally {
    if (prior === undefined) delete process.env.CENTRAL_SCHEDULER_ENABLED;
    else process.env.CENTRAL_SCHEDULER_ENABLED = prior;
  }
}

async function receipt() {
  return (await db.execute<{ completed_at: string; payload: string }>(sql`
    SELECT last_run_at::text AS completed_at, last_result::text AS payload
      FROM scheduler_state WHERE job_name = 'delivery-drain'
  `)).rows;
}

async function expectFailedTick(job: string) {
  const before = await receipt();
  let caught: unknown;
  try { await tickScheduler(true); } catch (error) { caught = error; }
  assert.ok(caught instanceof SchedulerJobsIncompleteError,
    "Expected visible scheduler failure for " + job + ", got " + String(caught));
  assert.ok(caught.failures.some((failure) => failure.job === job),
    "Missing failing job " + job + ": " + caught.failures.map((failure) => failure.job).join(", "));
  for (const failure of caught.failures) {
    assert.ok(failure.message.length <= 160, "scheduler error details must be bounded");
    assert.doesNotMatch(failure.message, /(?:select|insert|update|delete)\s+|params:|\$1/i,
      "scheduler failure details must not expose SQL or parameters");
  }
  assert.deepEqual(await receipt(), before, "a partial tick must not advance the completion receipt");
  const lease = await db.execute<{ status: string }>(sql`
    SELECT last_result->>'status' AS status
      FROM scheduler_state WHERE job_name = 'central-scheduler-lease'
  `);
  assert.equal(lease.rows[0]?.status, "failed", "watchdog must see a failed lease");
}

test("failed audit sealing is reported, while later compliance work is still attempted", isolatedCiOnly, async () => {
  assertIsolatedSchedulerRehearsal(process.env);
  const oldFlag = process.env.AUDIT_ROLE_ISOLATION_PROOF_ENABLED;
  const oldSealer = process.env.AUDIT_SEALER_DATABASE_URL;
  process.env.AUDIT_ROLE_ISOLATION_PROOF_ENABLED = "true";
  delete process.env.AUDIT_SEALER_DATABASE_URL;
  try {
    await withCentralScheduler(async () => {
      await db.execute(sql`DELETE FROM scheduler_state WHERE job_name = 'compliance-deadline-alerts'`);
      await expectFailedTick("auditChainSeal");
      const compliance = await db.execute(sql`
        SELECT id FROM scheduler_state WHERE job_name = 'compliance-deadline-alerts'
      `);
      assert.equal(compliance.rows.length, 1, "a failed audit sealer cannot skip the later compliance job");
    });
  } finally {
    if (oldFlag === undefined) delete process.env.AUDIT_ROLE_ISOLATION_PROOF_ENABLED;
    else process.env.AUDIT_ROLE_ISOLATION_PROOF_ENABLED = oldFlag;
    if (oldSealer === undefined) delete process.env.AUDIT_SEALER_DATABASE_URL;
    else process.env.AUDIT_SEALER_DATABASE_URL = oldSealer;
  }
});

test("missing compensation outbox schema fails the tick, not a silently successful drain", isolatedCiOnly, async () => {
  assertIsolatedSchedulerRehearsal(process.env);
  const hidden = "compensation_automation_intents_hidden_for_scheduler_test";
  const exists = await db.execute<{ name: string | null }>(sql`
    SELECT to_regclass('public.compensation_automation_intents')::text AS name
  `);
  assert.ok(exists.rows[0]?.name, "the disposable test DB must have the compensation automation outbox");
  await db.execute(sql.raw(`ALTER TABLE compensation_automation_intents RENAME TO ${hidden}`));
  try {
    await withCentralScheduler(() => expectFailedTick("compensationAutomationDelivery"));
  } finally {
    await db.execute(sql.raw(`ALTER TABLE ${hidden} RENAME TO compensation_automation_intents`));
  }
});

test("failed compliance alerts retain their due marker for retry and fail the tick", isolatedCiOnly, async () => {
  assertIsolatedSchedulerRehearsal(process.env);
  const marker = randomUUID().slice(0, 12);
  const [organization] = await db.insert(organizations).values({
    name: "Scheduler alert fault " + marker, legalName: "Scheduler alert fault " + marker,
  }).returning();
  let renamed = false;
  try {
    await db.insert(payrollRuns).values({
      organizationId: organization.id,
      periodLabel: "Scheduler alert fault fixture",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-15",
      payDate: "2026-09-15",
      scopeLabel: "Fictional only",
      status: "Released",
      employeeCount: 1,
      processedChunks: 1,
      totalChunks: 1,
      grossPay: "100.00",
      netPay: "90.00",
    });
    // This read is exclusive to the compliance calendar on the test path.
    // Earlier scheduler jobs may also fail, but later jobs must still run.
    await db.execute(sql.raw(
      "ALTER TABLE government_filing_validations RENAME TO government_filing_validations_hidden_for_scheduler_test",
    ));
    renamed = true;
    await withCentralScheduler(async () => {
      await db.execute(sql`DELETE FROM scheduler_state WHERE job_name = 'compliance-deadline-alerts'`);
      await expectFailedTick("complianceDeadlineAlerts");
      const state = await db.execute(sql`
        SELECT id FROM scheduler_state WHERE job_name = 'compliance-deadline-alerts'
      `);
      assert.equal(state.rows.length, 0, "failed deadline alerts cannot advance the hourly retry marker");
    });
  } finally {
    if (renamed) {
      await db.execute(sql.raw(
        "ALTER TABLE government_filing_validations_hidden_for_scheduler_test RENAME TO government_filing_validations",
      ));
    }
    await db.delete(organizations).where(eq(organizations.id, organization.id));
  }
});

test("every previously swallowed scheduled error is aggregated without bypassing the lease", () => {
  const source = readFileSync("src/lib/scheduler.ts", "utf8");
  for (const job of ["compensationAutomationDelivery", "auditChainSeal", "complianceDeadlineAlerts"]) {
    assert.match(source, new RegExp('isolate\\("' + job + '"\\)\\(error\\)'),
      job + " exceptions must be visible to scheduler failure aggregation");
  }
  assert.match(source, /intent\.reason === "dispatch_error_unconfirmed"/,
    "per-intent unconfirmed errors must fail a tick, not become apparent success");
  const alertStart = source.indexOf("if (complianceAlertsDue) {");
  const alertEnd = source.indexOf("const [hcmLifecycleNotificationState]", alertStart);
  const alertBlock = source.slice(alertStart, alertEnd);
  assert.match(alertBlock, /await assertLeaseOwnership\(\);[\s\S]*runScheduledComplianceDeadlineAlerts/,
    "compliance delivery requires a live lease before side effects");
  assert.match(alertBlock, /if \(Array\.isArray\(complianceDeadlineAlerts\)\) \{[\s\S]*lastRunAt: now/,
    "only successful deadline delivery may advance the throttle");
  const aggregate = source.indexOf("throw new SchedulerJobsIncompleteError(failures)");
  const receipt = source.indexOf("await recordSchedulerCompletion(ownerToken, payload)");
  assert.ok(aggregate > alertEnd && receipt > aggregate,
    "all background work must run before the failed tick is rejected without a success receipt");
});
