import "dotenv/config";
import { pool } from "../src/db";
import { scanAllPiiRotationStores, validatePiiRotationOperator } from "./lib/pii-rotation-backfill";

/**
 * S-2 dry-run-first legacy PII rotation. No production data is touched by
 * source merge; --apply additionally requires explicit, external approval.
 */
const apply = process.argv.includes("--apply");

async function main() {
  const env = process.env;
  const { organizationId, expectedDatabase } = validatePiiRotationOperator(env, apply);
  const identity = await pool.query<{ matches: boolean }>(
    "SELECT current_database() = $1::text AS matches", [expectedDatabase],
  );
  if (identity.rows[0]?.matches !== true) {
    throw new Error("Incorrect database target.");
  }
  const tenant = await pool.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM organizations WHERE id = $1) AS exists",
    [organizationId],
  );
  if (tenant.rows[0]?.exists !== true) {
    throw new Error("The approved tenant does not exist on this database target.");
  }

  // Complete read/authentication pass across ALL five stores before ANY write.
  await scanAllPiiRotationStores(pool, organizationId, env, false, summary => {
    console.log(JSON.stringify({ phase: "preflight", ...summary }));
  });
  if (!apply) {
    console.log("PII rewrap dry-run completed; no rows changed.");
    return;
  }
  await scanAllPiiRotationStores(pool, organizationId, env, true, summary => {
    console.log(JSON.stringify({ phase: "apply", ...summary }));
  });

  // Never report success while any in-scope row still depends on an old key.
  const currentOnly: NodeJS.ProcessEnv = { NODE_ENV: env.NODE_ENV ?? "test", PII_ENCRYPTION_KEY: env.PII_ENCRYPTION_KEY };
  const currentSummaries = await scanAllPiiRotationStores(
    pool, organizationId, currentOnly, false,
  );
  if (currentSummaries.some(summary => summary.rewrapped !== 0 || summary.conflicts !== 0)) {
    throw new Error("Some PII envelopes still require rewrap after apply.");
  }
  console.log("Tenant completed current-key-only authentication. Reconcile backup copies before key retirement.");
}

void main().catch(() => {
  // Never log PostgreSQL diagnostics, stored values, keys, or employee IDs.
  console.error("PII rotation stopped; reconcile store counts and key provenance.");
  process.exitCode = 1;
}).finally(() => pool.end());
