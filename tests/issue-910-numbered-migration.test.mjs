import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

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

test("#910 0123 contains exact reviewed source fragments and SHA-256 of the true source bytes", () => {
  const canonicalMarkers = [];
  const sourceBodies = [];
  for (const { key, path: sourcePath, start, end } of sourceParts) {
    const raw = readFileSync(new URL("../" + sourcePath, import.meta.url), "utf8");
    const sha256 = createHash("sha256").update(raw).digest("hex");
    const markerPrefix = "-- ISSUE910 SOURCE " + key + " [" + sourcePath + "] SHA256 ";
    const marker = markerPrefix + sha256;
    const candidateLines = candidate.split("\n").filter(line => line.startsWith(markerPrefix));
    assert.equal(candidateLines.length, 1, "Expected one source marker for " + key +
      "; observed candidate markers: " + candidateLines.join(" | "));
    assert.equal(candidateLines[0], marker,
      "Source hash mismatch for " + key + ". Rebuild 0123 from this checkout's exact reviewed raw SQL bytes; " +
      "never relax the source checksum assertion.");
    let body;
    if (start && end) {
      const beginning = raw.indexOf(start), ending = raw.lastIndexOf(end);
      assert.ok(beginning >= 0 && ending > beginning, "Source boundaries: " + sourcePath);
      body = raw.slice(beginning + start.length, ending).trim();
    } else {
      assert.ok(raw.startsWith("-- ISSUE #910"));
      body = raw.trim();
    }
    assert.ok(body.length > 500);
    canonicalMarkers.push(marker);
    sourceBodies.push(body);
  }
  const indexes = canonicalMarkers.map(marker => candidate.indexOf("\n" + marker + "\n"));
  assert.ok(indexes.every((n, i) => n >= 0 && (i === 0 || n > indexes[i-1])),
    "Exact source SHA markers must appear in fixed DDL dependency order");
  for (let index = 0; index < canonicalMarkers.length; index += 1) {
    const start = candidate.indexOf("\n" + canonicalMarkers[index] + "\n") +
      canonicalMarkers[index].length + 2;
    const end = index + 1 < canonicalMarkers.length
      ? candidate.indexOf("\n" + canonicalMarkers[index+1] + "\n")
      : candidate.length;
    assert.equal(candidate.slice(start, end).trim(), sourceBodies[index],
      "Canonical DDL must match exact reviewed source stage " + sourceParts[index].key);
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
