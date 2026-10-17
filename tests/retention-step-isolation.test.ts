import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { purgeExpiredOperationalData, RetentionPurgeIncompleteError } from "../src/lib/data-retention";

// A table that no migration creates (email_change_tokens) used to be able to halt
// the whole retention purge and, through scheduler.ts, every scheduled job after
// it. Verified on PostgreSQL 16: with the table absent the third DELETE threw 42P01,
// rate-limit rows, outbox history and marketing leads were never purged, and a full
// scheduler tick recorded nothing but its lease row.
const count = async (table: string, where: ReturnType<typeof sql>) =>
  Number(((await db.execute(sql`select count(*)::int as n from ${sql.raw(table)} where ${where}`)).rows[0] as { n: number }).n);

test("a failing retention step does not stop the other purges, and still fails visibly", async () => {
  const marker = "retention-isolation-" + randomUUID();
  const email = marker + "@example.test";
  await db.execute(sql`insert into rate_limit_hits (bucket_key, window_start, hits) values (${marker}, now() - interval '30 days', 1)`);
  await db.execute(sql`insert into outbox (recipient, subject, body, purpose, status, created_at)
    values (${email}, 's', 'b', ${marker}, 'sent', now() - interval '3000 days')`);
  await db.execute(sql`insert into marketing_leads (kind, name, email, company, source_path, created_at, updated_at)
    values ('demo', 'x', ${email}, 'x', '/x', '2020-01-01', '2020-01-01')`);
  await db.execute(sql`alter table email_change_tokens rename to email_change_tokens_hidden_for_test`);
  try {
    await assert.rejects(purgeExpiredOperationalData(), (error: unknown) => {
      assert.ok(error instanceof RetentionPurgeIncompleteError, "must be the typed aggregate error");
      assert.deepEqual(error.failures.map((f) => [f.step, f.code]), [["emailChangeTokens", "42P01"]]);
      assert.equal(error.result.emailChangeTokens, null, "a failed step is reported as null, not 0");
      assert.equal(typeof error.result.sessions, "number", "steps that ran keep their counts");
      assert.doesNotMatch(error.message, /delete from|params:/i, "no SQL or parameters in the message");
      return true;
    });
    assert.equal(await count("rate_limit_hits", sql`bucket_key = ${marker}`), 0, "rate-limit rows after the failed step were purged");
    assert.equal(await count("outbox", sql`purpose = ${marker}`), 0, "expired outbox history was purged");
    assert.equal(await count("marketing_leads", sql`email = ${email}`), 0, "expired marketing lead (personal data) was purged");
  } finally {
    await db.execute(sql`alter table email_change_tokens_hidden_for_test rename to email_change_tokens`);
    await db.execute(sql`delete from rate_limit_hits where bucket_key = ${marker}`);
    await db.execute(sql`delete from outbox where purpose = ${marker}`);
    await db.execute(sql`delete from marketing_leads where email = ${email}`);
  }
});

test("a healthy purge still resolves with numeric counts and the original shape", async () => {
  const result = await purgeExpiredOperationalData();
  for (const key of ["sessions", "passwordResetTokens", "emailChangeTokens", "rateLimitWindows",
    "outboxMessages", "webhookDeliveries", "marketingLeads"] as const) {
    assert.equal(typeof result[key], "number", key);
  }
  for (const key of ["pendingCoeObjectRecovery", "pendingSpendReceiptRecovery", "pendingVaultObjectRecovery"] as const) {
    assert.ok(result[key] && typeof result[key] === "object", key);
  }
});

test("the scheduler keeps running other jobs after a retention failure and rethrows before the receipt", () => {
  const source = readFileSync("src/lib/scheduler.ts", "utf8");
  assert.match(source, /import \{ purgeExpiredOperationalData, RetentionPurgeIncompleteError \} from "@\/lib\/data-retention"/);
  const caught = source.indexOf("error instanceof RetentionPurgeIncompleteError");
  const otherJob = source.indexOf("runDueApprovalChainEscalations(now)");
  const rethrow = source.indexOf("if (retentionFailure) throw retentionFailure");
  const receipt = source.indexOf("recordSchedulerCompletion(ownerToken, payload)");
  assert.ok(caught > 0 && otherJob > caught, "approval escalations run after the failure is caught");
  assert.ok(rethrow > otherJob && receipt > rethrow, "failure is rethrown after the other jobs and before the completion receipt");
  // Only the typed aggregate error is swallowed at the call site; anything else still propagates.
  assert.match(source, /if \(!\(error instanceof RetentionPurgeIncompleteError\)\) throw error;/);
  // The retention marker must not advance on failure, so the whole purge retries next tick.
  assert.match(source, /if \(retentionDue && !retentionFailure\) \{/);
});
