import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildReviewOnlyForwardSchema } from "../scripts/issue-910-build-forward-schema.mjs";

test("#910: forward schema assembler is deterministic, exact-byte-hashed and source-only", () => {
  const a = buildReviewOnlyForwardSchema();
  const b = buildReviewOnlyForwardSchema();
  assert.deepEqual(a, b, "same reviewed source bytes must produce same candidate/checksum");
  assert.equal(a.manifest.schema, "issue910-review-only-forward-schema-v1");
  assert.equal(a.manifest.source_only, true);
  assert.equal(a.manifest.production_applied, "UNPROVEN");
  assert.equal(a.manifest.includes_historical_backfill, false);
  assert.equal(a.manifest.parts.length, 3);
  assert.equal(a.manifest.sql_sha256,
    createHash("sha256").update(a.sql, "utf8").digest("hex"));
  for (const p of a.manifest.parts) {
    const raw = readFileSync(new URL("../" + p.path, import.meta.url));
    assert.equal(p.source_sha256, createHash("sha256").update(raw).digest("hex"),
      "exact bytes must match source checksum: " + p.path);
    assert.ok(a.sql.includes(p.source_sha256));
  }
});

test("#910: predecessor, 0121 additive DDL and 13 tenant guards are ordered", () => {
  const { sql, manifest } = buildReviewOnlyForwardSchema();
  const expectedKeys = [
    "missing-historical-predecessors",
    "0121-schema-only",
    "post-0121-tenant-integrity",
  ];
  assert.deepEqual(manifest.parts.map(p => p.key), expectedKeys);
  const pos = expectedKeys.map(p => sql.indexOf("-- ISSUE910 SOURCE " + p + " ["));
  assert.ok(pos.every((x, i) => x >= 0 && (i === 0 || pos[i-1] < x)));
  assert.ok(sql.indexOf("DO $issue910_preflight$") < pos[0]);
  for (const s of [
    'CREATE TABLE IF NOT EXISTS "worker_employment_events"',
    "CREATE TABLE IF NOT EXISTS user_legal_entity_grants",
    "FOREIGN KEY (organization_id,employee_id) REFERENCES employees(organization_id,id)",
    "FOREIGN KEY (payroll_run_id,legal_entity_id) REFERENCES payroll_runs(id,legal_entity_id)",
    "ISSUE910_MISSING_SCHEMA_PREREQUISITES",
    "ISSUE910_DUPLICATE_USER_ORGANIZATION_MEMBERSHIP",
  ]) assert.ok(sql.includes(s), "missing critical precondition or scope constraint: " + s);
  assert.equal((sql.match(/\bADD CONSTRAINT\s+[a-z_]+/g) ?? [])
    .filter(x => /(?:tenant|employer|membership)/.test(x)).length >= 13, true);
});

test("#910: composed candidate cannot mutate worker/payroll history or own a transaction", () => {
  const { sql } = buildReviewOnlyForwardSchema();
  const executable = sql.replace(/--[^\n]*/g, "");
  assert.match(sql, /GENERATED REVIEW-ONLY FORWARD SCHEMA CANDIDATE/);
  assert.match(sql, /DO NOT APPLY ON NEON/);
  assert.doesNotMatch(executable,
    /\b(?:INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|MERGE\s+INTO)\b/i);
  assert.doesNotMatch(executable, /\b(?:COMMIT|ROLLBACK)\s*;/i);
  assert.doesNotMatch(sql, /SET "legal_entity_id" = e\."legal_entity_id"/);
});
