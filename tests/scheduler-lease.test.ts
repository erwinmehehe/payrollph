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
