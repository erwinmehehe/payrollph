import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildReviewOnlyForwardSchema } from "../scripts/issue-910-build-forward-schema.mjs";

const path = "drizzle/0123_multi_entity_forward_schema_repair.sql";
const candidate = readFileSync(new URL("../" + path, import.meta.url), "utf8");
const sourceParts = [
  { key: "missing-historical-predecessors", path: "docs/sql/issue-910-review-only-forward-predecessor.sql",
    start: "-- SOURCE BEGIN\n", end: "-- SOURCE COMPLETE" },
  { key: "0121-schema-only", path: "docs/sql/issue-910-review-only-0121-schema.sql",
    start: "-- BEGIN_SOURCE_0121_STAGE --\n", end: "-- END_SOURCE_0121_STAGE --" },
  { key: "post-0121-tenant-integrity", path: "docs/sql/issue-910-review-only-post-0121-tenant-integrity.sql" },
];

test("#910 0123 remains the next forward-only numbered SQL, with no row changes", () => {
  assert.match(candidate, /^-- 0123: Issue #910 additive multi-entity forward schema repair \(DRAFT; NOT applied\)\./);
  assert.doesNotMatch(candidate.replace(/--[^\n]*/g, ""),
    /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|MERGE\s+INTO|EXECUTE)\b/i);
  assert.doesNotMatch(candidate.replace(/--[^\n]*/g, ""),
    /\b(?:BEGIN|COMMIT|ROLLBACK)\s*;/i);
  assert.match(candidate, /ISSUE910_MISSING_SCHEMA_PREREQUISITES/);
  assert.match(candidate, /ISSUE910_DUPLICATE_USER_ORGANIZATION_MEMBERSHIP/);
  assert.ok(candidate.indexOf("DO $issue910_preflight$") <
    candidate.indexOf("-- ISSUE910 SOURCE missing-historical-predecessors"));
  assert.ok(candidate.includes("NOT standalone"));
});

test("#910 0123 matches the canonical exact-byte source builder after its six numbered header lines", () => {
  // The #958 builder is already merged into main. Use it as one source of
  // truth for all three reviewed bodies, SHA-256 markers and preflight text;
  // duplicated per-stage parsing here could silently drift from the builder.
  const generated = buildReviewOnlyForwardSchema();
  assert.equal(generated.manifest.source_only, true);
  assert.equal(generated.manifest.production_applied, "UNPROVEN");
  assert.equal(generated.manifest.includes_historical_backfill, false);
  assert.deepEqual(generated.manifest.parts.map(p => p.key),
    sourceParts.map(p => p.key));
  const numberedHeader = candidate.split("\n").slice(0, 6);
  assert.equal(numberedHeader.length, 6);
  const expected = [...numberedHeader, ...generated.sql.split("\n").slice(6)].join("\n");
  assert.equal(candidate, expected,
    "Numbered 0123 DDL and every provenance SHA marker must match the merged source-only #958 builder byte-for-byte");
  for (const { path: sourcePath, key } of sourceParts) {
    const raw = readFileSync(new URL("../" + sourcePath, import.meta.url));
    const sha256 = createHash("sha256").update(raw).digest("hex");
    const part = generated.manifest.parts.find(p => p.key === key);
    assert.equal(part?.source_sha256, sha256, "Source file changed since builder hash: " + sourcePath);
  }
});

test("#910 0123 only adds schema and 13 cross-tenant/employer guards", () => {
  for (const token of [
    'CREATE TABLE IF NOT EXISTS "worker_employment_events"',
    "CREATE TABLE IF NOT EXISTS user_legal_entity_grants",
    "CREATE TABLE IF NOT EXISTS employee_entity_assignments",
    "CREATE TABLE IF NOT EXISTS entity_transfer_requests",
    "FOREIGN KEY (organization_id,employee_id) REFERENCES employees(organization_id,id)",
    "FOREIGN KEY (payroll_run_id,legal_entity_id) REFERENCES payroll_runs(id,legal_entity_id)",
  ]) assert.ok(candidate.includes(token), "Missing schema requirement: " + token);
  assert.ok((candidate.match(/\bADD CONSTRAINT\s+[a-z_]+/g) ?? [])
    .filter(s => /(?:tenant|employer|membership)/.test(s)).length >= 13);
  assert.equal(candidate.includes("SET legal_entity_id ="), false,
    "No implicit employer provenance inferred from current employee state");
});
