import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  acquireSchedulerLease,
  refreshSchedulerLease,
  releaseSchedulerLease,
} from "../src/lib/scheduler-lease";

test("a scheduler lease serializes workers and fences stale owners", async () => {
  const jobName = `scheduler-test-${randomUUID().slice(0, 18)}`;
  const first = randomUUID();
  const second = randomUUID();

  try {
    assert.equal(await acquireSchedulerLease(first, jobName), true);
    assert.equal(await acquireSchedulerLease(second, jobName), false);
    assert.equal(await refreshSchedulerLease(first, jobName), true);
    assert.equal(await releaseSchedulerLease(second, "completed", jobName), false);

    // An abandoned lease can be recovered, but its previous owner cannot
    // release or refresh a replacement owner's live lease.
    await db.execute(sql`
      UPDATE scheduler_state
         SET last_run_at = NOW() - INTERVAL '16 minutes'
       WHERE job_name = ${jobName}
    `);
    assert.equal(await acquireSchedulerLease(second, jobName), true);
    assert.equal(await refreshSchedulerLease(first, jobName), false);
    assert.equal(await releaseSchedulerLease(first, "completed", jobName), false);
    assert.equal(await refreshSchedulerLease(second, jobName), true);
    assert.equal(await releaseSchedulerLease(second, "completed", jobName), true);
    assert.equal(await acquireSchedulerLease(first, jobName), true);
  } finally {
    await releaseSchedulerLease(first, "failed", jobName);
    await releaseSchedulerLease(second, "failed", jobName);
    await db.execute(sql`DELETE FROM scheduler_state WHERE job_name = ${jobName}`);
  }
});


test("simultaneous competing scheduler starts admit exactly one owner", async () => {
  const jobName = `scheduler-parallel-${randomUUID().slice(0, 18)}`;
  const tokens = Array.from({ length: 12 }, () => randomUUID());
  try {
    const acquired = await Promise.all(tokens.map((token) => acquireSchedulerLease(token, jobName)));
    assert.equal(acquired.filter(Boolean).length, 1, "competing workers must share a database-enforced single owner");
    const winner = tokens[acquired.indexOf(true)];
    assert.equal(await refreshSchedulerLease(winner, jobName), true);
    assert.equal(await releaseSchedulerLease(winner, "completed", jobName), true);
    const next = await Promise.all(tokens.map((token) => acquireSchedulerLease(token, jobName)));
    assert.equal(next.filter(Boolean).length, 1, "a completed lease can have one new owner, never several");
  } finally {
    for (const token of tokens) await releaseSchedulerLease(token, "failed", jobName);
    await db.execute(sql`DELETE FROM scheduler_state WHERE job_name = ${jobName}`);
  }
});

test("the central scheduler revalidates lease ownership before financial transitions", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/lib/scheduler.ts", "utf8");
  assert.ok(source.includes("leaseLost || !(await refreshSchedulerLease(ownerToken))"));
  for (const method of [
    "runScheduledWorkerEffectiveChanges",
    "runScheduledEmploymentTerms",
    "runScheduledEmploymentTermDecisions",
    "runScheduledCompensationGovernance",
  ]) {
    assert.match(source, new RegExp("await assertLeaseOwnership\\(\\);\\s+const \\w+ = await " + method + "\\("));
  }
});

test("lease ownership is checked before every separately invoked high-impact scheduler task", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/lib/scheduler.ts", "utf8");
  for (const functionName of [
    "drainWebhookRetries",
    "drainOutboxRetries",
    "drainMarketingLeadNotifications",
    "runScheduledStatutoryRemittanceSync",
    "runScheduledContributionCaseEscalations",
    "resumeDueAutomationExecutions",
    "runScheduledAutomationTemporalEvents",
    "runScheduledWorkerEffectiveChanges",
    "runScheduledEmploymentTerms",
    "runScheduledEmploymentTermDecisions",
    "runScheduledCompensationGovernance",
  ]) {
    const pattern = new RegExp("await assertLeaseOwnership\\(\\);\\s+const \\w+ = await " + functionName + "\\(");
    assert.match(source, pattern, functionName + " must be preceded by live lease fencing");
  }
  for (const functionName of [
    "purgeExpiredOperationalData",
    "runScheduledHcmDocumentExpiry",
    "runScheduledHcmLifecycleNotifications",
    "runScheduledPerformanceReminders",
    "runScheduledPerformanceActionReminders",
    "runScheduledPerformanceEvidenceSealing",
  ]) {
    const callAt = source.indexOf("await " + functionName + "(");
    assert.ok(callAt > 0, functionName + " must be scheduled");
    const lastFence = source.lastIndexOf("await assertLeaseOwnership();", callAt);
    const previousTask = source.slice(lastFence, callAt);
    assert.ok(lastFence >= 0 && previousTask.length < 550, functionName + " needs a nearby lease check");
  }
  assert.match(source, /await assertLeaseOwnership\(\);\s+if \(row\) \{\s+await db\.update\(schedulerState\)/);
});

test("a stale scheduler cannot falsely acknowledge success after losing the lease", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/lib/scheduler.ts", "utf8");
  assert.ok(source.includes('const released = await releaseSchedulerLease(ownerToken, completed ? "completed" : "failed")'));
  assert.ok(source.includes("if (completed && !released)"));
  assert.ok(source.includes("Central scheduler completed work but no longer owned the lease"));
  assert.ok(source.includes("const completedAt = new Date();"));
  assert.ok(source.includes("lastRunAt: completedAt"));
  assert.ok(!source.includes("lastRunAt: now, lastResult: payload"));
});
