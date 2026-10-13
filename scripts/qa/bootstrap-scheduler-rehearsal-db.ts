import assert from "node:assert/strict";
import { Client } from "pg";
import { assertIsolatedSchedulerRehearsal } from "../../tests/helpers/scheduler-isolated-guard";

/**
 * A deliberately minimal, ephemeral PostgreSQL schema for the scheduler
 * lease/receipt tests. Never push the application schema or create employers.
 * Run only against localhost:5432/app_db with the explicit CI rehearsal opt-in.
 */
async function main() {
  assertIsolatedSchedulerRehearsal(process.env);
  for (const key of [
    "CENTRAL_SCHEDULER_ENABLED",
    "WORKER_ENABLED",
    "PAYROLL_SCHEDULER_DISPATCH_ENABLED",
    "PAYMONGO_DISBURSEMENTS_ENABLED",
    "XENDIT_PAYOUTS_ENABLED",
  ]) {
    assert.notEqual(process.env[key], "true", key + " must remain disabled");
  }

  const command = process.argv[2];
  assert.ok(command === "bootstrap" || command === "verify", "Expected bootstrap or verify");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const tables = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    if (command === "bootstrap") {
      assert.deepEqual(tables.rows, [], "Synthetic scheduler database must start empty");
      await client.query(`
        CREATE TABLE scheduler_state (
          id SERIAL PRIMARY KEY,
          job_name VARCHAR(80) NOT NULL UNIQUE,
          last_run_at TIMESTAMPTZ,
          last_result JSONB NOT NULL DEFAULT '{}'::jsonb
        )
      `);
      process.stdout.write("Rehearsal: created one isolated scheduler_state table; no employer data.\n");
      return;
    }

    assert.deepEqual(tables.rows.map((row) => row.tablename), ["scheduler_state"],
      "Rehearsal must never create employer or payroll tables");
    const { rows } = await client.query<{ remaining: number }>(
      "SELECT COUNT(*)::integer AS remaining FROM scheduler_state",
    );
    assert.equal(rows[0]?.remaining, 0, "Scheduler tests must remove all synthetic lease/receipt rows");
    process.stdout.write("Rehearsal: all synthetic lease/receipt rows cleaned; no employer data.\n");
  } finally {
    await client.end();
  }
}

main().catch(() => {
  // Never print connection strings or test payloads into untrusted CI logs.
  console.error("Isolated scheduler PostgreSQL bootstrap/verification failed.");
  process.exitCode = 1;
});
