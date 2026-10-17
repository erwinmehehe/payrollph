import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { SchedulerJobsIncompleteError, tickScheduler } from "../src/lib/scheduler";

const HIDDEN = "hcm_employment_terms_hidden_for_test";

test("a failing scheduler job does not stop the jobs after it, and the tick still fails visibly", async () => {
  const flagEnv = "CENTRAL_SCHEDULER_ENABLED";
  const prior = process.env[flagEnv];
  process.env[flagEnv] = "true";
  const regclass = await db.execute<{ r: string | null }>(sql`SELECT to_regclass('public.hcm_employment_terms')::text AS r`);
  assert.ok(regclass.rows[0]?.r, "hcm_employment_terms must exist on the test database");
  await db.execute(sql.raw(`ALTER TABLE hcm_employment_terms RENAME TO ${HIDDEN}`));
  try {
    const startedAt = new Date(Date.now() - 1000);
    await db.execute(sql`DELETE FROM scheduler_state WHERE job_name = 'compliance-deadline-alerts'`);
    let caught: unknown;
    try { await tickScheduler(true); } catch (error) { caught = error; }
    assert.notEqual(caught, undefined, "the tick must fail visibly, not skip or succeed");
    assert.ok(caught instanceof SchedulerJobsIncompleteError, "expected aggregate error, got " + String(caught));
    const jobs = caught.failures.map((f) => f.job);
    assert.ok(jobs.includes("hcmEmploymentTerms"), "the broken job is reported: " + jobs.join(","));
    // compliance alerts are scheduled AFTER hcmEmploymentTerms; they must have run.
    const after = await db.execute<{ job_name: string }>(
      sql`SELECT job_name FROM scheduler_state WHERE job_name = 'compliance-deadline-alerts' AND last_run_at >= ${startedAt}`,
    );
    assert.equal(after.rows.length, 1, "jobs after the failing one must still run");
    for (const f of caught.failures) {
      assert.ok(f.message.length <= 160 && !/select |insert |update |\$1/i.test(f.message), "no SQL or parameters: " + f.message);
    }
  } finally {
    await db.execute(sql.raw(`ALTER TABLE ${HIDDEN} RENAME TO hcm_employment_terms`));
    if (prior === undefined) delete process.env[flagEnv]; else process.env[flagEnv] = prior;
  }
});

test("every scheduler job call is isolated or fenced, and lease loss is never swallowed", () => {
  const source = readFileSync("src/lib/scheduler.ts", "utf8");
  assert.match(source, /if \(error instanceof SchedulerLeaseLostError\) throw error;/);
  assert.match(source, /throw new SchedulerLeaseLostError\("Central scheduler lease lost before scheduled side effect/);
  for (const job of [
    "approvalEscalations", "statutoryRemittanceActions", "contributionCaseEscalations", "hrCaseSlaEscalations",
    "automationResumes", "automationTemporalEvents", "hcmEffectiveChanges", "hcmEmploymentTerms",
    "hcmEmploymentTermDecisions", "hcmCompensation", "hcmDocumentExpiry", "hcmLifecycleNotifications",
    "performanceReminders", "performanceActionReminders", "performanceEvidenceSealing", "punchPhotoPurge",
  ]) assert.ok(source.includes('isolate("' + job + '")'), job + " must be isolated");
  // Failed due-jobs return null; their markers must only advance on success.
  assert.match(source, /if \(hcmDocumentDue && hcmDocumentExpiry\) \{/);
  assert.match(source, /if \(retentionDue && !retentionFailure && !punchPhotoFailed\) \{/);
  const aggregate = source.indexOf("throw new SchedulerJobsIncompleteError(failures)");
  const receipt = source.indexOf("await recordSchedulerCompletion(ownerToken, payload)");
  assert.ok(aggregate > 0 && aggregate < receipt, "failure must surface before the completion receipt");
});
