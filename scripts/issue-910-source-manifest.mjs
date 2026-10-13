#!/usr/bin/env node
/**
 * #910: deterministic SOURCE manifest, not an applied-migration journal.
 * Reads exact Git checkout bytes. No database connection, writes or secrets.
 * The SHA-256 values below identify source content only, NEVER execution.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative, sep } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sources = [
  "drizzle/0022_job_architecture_positions.sql",
  "drizzle/0050_hcm_core_worker_history.sql",
  "drizzle/0051_hcm_org_job_architecture.sql",
  "drizzle/0052_hcm_effective_dated_changes.sql",
  "drizzle/0110_provider_events_inbox.sql",
  "drizzle/0112_wfm_operational_demand_observations.sql",
  "drizzle/0113_wfm_issued_demand_forecasts.sql",
  "drizzle/0114_wfm_demand_staffing_policies.sql",
  "drizzle/0115_payout_profiles_foundation.sql",
  "drizzle/0116_payout_ledger_foundation.sql",
  "drizzle/0117_inline_first_payroll_journey.sql",
  "drizzle/0118_wfm_roster_scale_rules.sql",
  "drizzle/0119_xendit_payout_provider.sql",
  "drizzle/0120_wfm_punch_evidence.sql",
  "drizzle/0121_multi_entity_v2_scope_transfer.sql",
  "docs/sql/issue-910-review-only-forward-predecessor.sql",
  "docs/sql/issue-910-review-only-post-0121-tenant-integrity.sql",
];
export function sourceManifest(paths = sources) {
  return paths.map(path => {
    const absolute = resolve(root, path);
    if (relative(root, absolute).startsWith(".."+sep) || !absolute.startsWith(root + sep)) {
      throw new Error("Source path outside repository");
    }
    const bytes = readFileSync(absolute);
    return {
      path,
      source_sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      production_applied: "UNPROVEN",
      source_only: true,
    };
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = sourceManifest();
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ schema: "issue910-source-manifest-v1", rows }, null, 2) + "\n");
  } else {
    process.stdout.write("SOURCE SHA-256 (not proof of deployment)\n");
    for (const x of rows) process.stdout.write(x.source_sha256 + "  " + x.path + "\n");
  }
}
