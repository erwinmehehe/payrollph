#!/usr/bin/env node
/**
 * Idempotent disposable-CI baseline: after `npm run db:push`, apply the same objects the
 * clean-baseline cutover adds, so the app runs exactly as it does in production, where request
 * code only VERIFIES the schema and never creates or alters it.
 *
 *   1. drizzle/0109_tamper_evident_audit_chain.sql   (skipped if audit_chain_heads exists)
 *   2. docs/sql/source-baseline-supplement.sql       (skipped if no migration-only object is missing)
 *
 * It delegates to the two reviewed one-shot runners, so their guards still apply unchanged
 * (GitHub Actions only, 127.0.0.1 app_db only, empty employer and audit tables, payouts disabled).
 * Never used for Neon, production, or any non-disposable target.
 */
import { spawnSync } from "node:child_process";
import pg from "pg";
import { missingMigrationObjects, objectKey } from "../lib/migration-only-objects.mjs";

const url = process.env.DATABASE_URL ?? "";
if (process.env.GITHUB_ACTIONS !== "true" || process.env.CI !== "true" ||
    url !== "postgresql://postgres:postgres@127.0.0.1:5432/app_db") {
  console.error("APPLY_ISOLATED_BASELINE_REFUSED: disposable GitHub Actions app_db on 127.0.0.1 only.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
let major, hasAuditHeads, needsSupplement;
try {
  const { rows: [server] } = await client.query(
    "SELECT current_setting('server_version_num')::int AS v, to_regclass('public.audit_chain_heads')::text AS heads");
  major = String(Math.floor(server.v / 10000));
  hasAuditHeads = server.heads === "audit_chain_heads";
  if (hasAuditHeads) {
    // The supplement intentionally leaves these v2 audit guards for the restricted-role cutover.
    const EXCLUDED = new Set([
      "function:audit_events_protect_v2", "function:audit_events_insert_guard_v2",
      "function:audit_events_reject_truncate_v2", "trigger:audit_events_insert_guard_v2",
      "trigger:audit_events_reject_truncate_v2",
    ]);
    const { missing } = await missingMigrationObjects(client);
    needsSupplement = missing.map(objectKey).some((key) => !EXCLUDED.has(key));
  } else {
    needsSupplement = true;
  }
} finally {
  await client.end();
}

const env = {
  ...process.env,
  // Unset means disabled; the 0109 runner still refuses anything other than "false".
  PAYMONGO_DISBURSEMENTS_ENABLED: process.env.PAYMONGO_DISBURSEMENTS_ENABLED ?? "false",
  XENDIT_PAYOUTS_ENABLED: process.env.XENDIT_PAYOUTS_ENABLED ?? "false",
  NINE_STAGE_PG_MAJOR: process.env.NINE_STAGE_PG_MAJOR ?? major,
};
const steps = [];
if (!hasAuditHeads) steps.push(["scripts/qa/apply-audit-0109-isolated.mjs", "0109 audit chain"]);
if (needsSupplement) steps.push(["scripts/qa/apply-source-baseline-supplement.mjs", "reviewed supplement"]);
if (!steps.length) console.log("Baseline already applied: audit chain and reviewed supplement present; nothing to do.");
for (const [script, label] of steps) {
  const result = spawnSync(process.execPath, [script], { env, stdio: ["ignore", "inherit", "inherit"] });
  if (result.status !== 0) {
    console.error("APPLY_ISOLATED_BASELINE_FAILED at " + label);
    process.exit(result.status ?? 1);
  }
  console.log("applied: " + label);
}
