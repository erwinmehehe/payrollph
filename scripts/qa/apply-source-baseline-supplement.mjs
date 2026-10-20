import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { missingMigrationObjects, objectKey } from "../lib/migration-only-objects.mjs";

// Applies docs/sql/source-baseline-supplement.sql to an empty, freshly pushed
// disposable CI database (after drizzle/0109), then proves that every object the
// numbered migrations create is present, except the documented exclusions.
// It is NOT the production migration runner and never runs from the app.
const expectedUrl = "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
assert.equal(process.env.GITHUB_ACTIONS, "true", "GitHub Actions isolation is required");
assert.equal(process.env.CI, "true", "CI isolation is required");
assert.equal(process.env.DATABASE_URL, expectedUrl, "Only the disposable CI database is permitted");

// drizzle/0133 v2 audit guards are deferred to the restricted-role cutover: they
// only let payrollph_audit_sealing members fill chain fields, and the default
// sealer runs as the app login, so adding them without those roles breaks sealing.
export const EXCLUDED = new Set([
  "function:audit_events_protect_v2",
  "function:audit_events_insert_guard_v2",
  "function:audit_events_reject_truncate_v2",
  "trigger:audit_events_insert_guard_v2",
  "trigger:audit_events_reject_truncate_v2",
]);

const client = new pg.Client({ connectionString: expectedUrl });
try {
  await client.connect();
  const { rows: [state] } = await client.query(`
    SELECT current_database() AS database_name,
      (SELECT count(*) FROM organizations)::integer AS organizations,
      (SELECT count(*) FROM audit_events)::integer AS audit_events,
      to_regclass('public.audit_chain_heads')::text AS audit_heads
  `);
  assert.equal(state.database_name, "app_db");
  assert.equal(state.organizations, 0, "Refusing to alter a nonempty employer database");
  assert.equal(state.audit_events, 0, "Refusing to alter a populated audit trail");
  assert.equal(state.audit_heads, "audit_chain_heads", "Apply drizzle/0109 before the supplement");

  const sql = readFileSync("docs/sql/source-baseline-supplement.sql", "utf8");
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }

  const { files, scanned, missing } = await missingMigrationObjects(client);
  const unexpected = missing.map(objectKey).filter((key) => !EXCLUDED.has(key));
  assert.deepEqual(unexpected, [], "Migration-only objects missing from the baseline: " + unexpected.join(", "));
  const stale = [...EXCLUDED].filter((key) => !missing.some((o) => objectKey(o) === key));
  assert.deepEqual(stale, [], "Excluded objects are now present; remove them from EXCLUDED: " + stale.join(", "));

  process.stdout.write(JSON.stringify({
    kind: "source-baseline-supplement-proof",
    supplementSha256: createHash("sha256").update(sql).digest("hex"),
    migrationsScanned: files,
    createdObjectsChecked: scanned,
    excluded: [...EXCLUDED],
    productionApproved: false,
  }) + "\n");
} finally {
  await client.end();
}
