#!/usr/bin/env node
/**
 * Issue #910: deterministic REVIEW-ONLY forward-only schema candidate.
 * Never connects to a DB, never applies migrations, never backfills employer
 * history. Requires canonical 0115-0120 objects in disposable PG CI fixture.
 */
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sources = Object.freeze([
  { key: "missing-historical-predecessors", path: "docs/sql/issue-910-review-only-forward-predecessor.sql" },
  { key: "0121-schema-only", path: "docs/sql/issue-910-review-only-0121-schema.sql" },
  { key: "post-0121-tenant-integrity", path: "docs/sql/issue-910-review-only-post-0121-tenant-integrity.sql" },
]);
const digest = text => createHash("sha256").update(text, "utf8").digest("hex");

function extractBody({ key }, text) {
  if (key === "missing-historical-predecessors") {
    const start = "-- SOURCE BEGIN\n";
    const end = "-- SOURCE COMPLETE";
    if (text.indexOf(start) < 0 || text.lastIndexOf(end) < 0) throw new Error("Missing predecessor stage boundary");
    return text.slice(text.indexOf(start) + start.length, text.lastIndexOf(end)).trim();
  }
  if (key === "0121-schema-only") {
    const start = "-- BEGIN_SOURCE_0121_STAGE --\n";
    const end = "-- END_SOURCE_0121_STAGE --";
    if (text.indexOf(start) < 0 || text.lastIndexOf(end) < 0) throw new Error("Missing reviewed 0121 schema boundary");
    return text.slice(text.indexOf(start) + start.length, text.lastIndexOf(end)).trim();
  }
  if (!text.startsWith("-- ISSUE #910")) throw new Error("Unexpected tenant-integrity source");
  return text.trim();
}

const preflight = [
  "DO $issue910_preflight$",
  "DECLARE missing_objects text;",
  "BEGIN",
  "  -- Prerequisites 0115-0120 must exist before additive 0121 columns/FKs.",
  "  SELECT string_agg(object_name, ', ' ORDER BY object_name)",
  "    INTO missing_objects FROM (VALUES",
  "      ('public.organizations'), ('public.users'), ('public.user_organizations'),",
  "      ('public.legal_entities'), ('public.org_units'), ('public.employees'),",
  "      ('public.payroll_runs'), ('public.payroll_entries'), ('public.payslips'),",
  "      ('public.payroll_jobs'), ('public.bank_file_validations'),",
  "      ('public.historical_payroll_entries'), ('public.year_end_adjustments'),",
  "      ('public.separation_records'), ('public.payout_batches'),",
  "      ('public.payout_transfers')",
  "    ) AS required(object_name) WHERE to_regclass(object_name) IS NULL;",
  "  IF missing_objects IS NOT NULL THEN",
  "    RAISE EXCEPTION 'ISSUE910_MISSING_SCHEMA_PREREQUISITES: %', missing_objects",
  "      USING ERRCODE = 'P0001';",
  "  END IF;",
  "  IF EXISTS (SELECT 1 FROM public.user_organizations",
  "             GROUP BY organization_id, user_id HAVING count(*) > 1) THEN",
  "    RAISE EXCEPTION 'ISSUE910_DUPLICATE_USER_ORGANIZATION_MEMBERSHIP'",
  "      USING ERRCODE = 'P0001';",
  "  END IF;",
  "END $issue910_preflight$;",
].join("\n");

export function buildReviewOnlyForwardSchema() {
  const parts = sources.map(({ key, path }) => {
    const raw = readFileSync(resolve(root, path), "utf8");
    const body = extractBody({ key }, raw);
    if (body.length < 500) throw new Error("Incomplete forward schema source: " + path);
    const executable = body.replace(/--[^\n]*/g, "");
    if (/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|MERGE\s+INTO|EXECUTE)\b/i.test(executable))
      throw new Error("Data mutation forbidden in review-only schema source: " + path);
    if (/\b(?:COMMIT|ROLLBACK)\s*;/i.test(executable))
      throw new Error("Source owns transaction boundary: " + path);
    return { key, path, body, source_sha256: digest(raw) };
  });
  const sql = [
    "-- ISSUE #910 GENERATED REVIEW-ONLY FORWARD SCHEMA CANDIDATE.",
    "-- UNNUMBERED. DO NOT APPLY ON NEON, STAGING, CLONES OR REAL EMPLOYERS.",
    "-- NO historical row mutations; NO inferred employee-current-employer backfill.",
    "-- Caller owns atomic BEGIN/ROLLBACK inside an isolated fictional PG fixture.",
    "-- Expects separately installed 0115-0120 canonical objects; NOT standalone.",
    "-- This checksum is NOT an applied-production-migration receipt.",
    preflight,
    ...parts.flatMap(p => [
      "",
      "-- ISSUE910 SOURCE " + p.key + " [" + p.path + "] SHA256 " + p.source_sha256,
      p.body,
    ]),
    "",
  ].join("\n");
  return { sql, manifest: {
    schema: "issue910-review-only-forward-schema-v1",
    source_only: true,
    production_applied: "UNPROVEN",
    includes_historical_backfill: false,
    prerequisite_train: "0115-0120 canonical objects in disposable fixture",
    sql_sha256: digest(sql),
    parts: parts.map(({ key, path, source_sha256 }) => ({ key, path, source_sha256 })),
  } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { sql, manifest } = buildReviewOnlyForwardSchema();
  if (process.argv.includes("--write-review-artifacts")) {
    const out = resolve(root, "qa-artifacts", "issue-910");
    mkdirSync(out, { recursive: true });
    writeFileSync(resolve(out, "review-only-forward-schema.sql"), sql);
    writeFileSync(resolve(out, "review-only-forward-schema-manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n");
    process.stdout.write("Review-only schema and checksum written under qa-artifacts/issue-910\n");
  } else {
    process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
  }
}
