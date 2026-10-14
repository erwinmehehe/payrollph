import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { sourceManifest } from "../scripts/issue-910-source-manifest.mjs";

test("#910: source SHA-256 matches independently hashed exact bytes and never certifies application", () => {
  const rows = sourceManifest();
  assert.equal(rows.length, 22);
  for (const additional of ["drizzle/0026_statutory_remittance_corrections.sql", "drizzle/0105_ess_self_service_profile.sql"]) {
    assert.ok(rows.some(row => row.path === additional), "track drift candidate source: " + additional);
  }
  const manifestPaths = new Set(rows.map(row => row.path));
  assert.equal(manifestPaths.size, rows.length);
  // A merged, numbered source file is evidence of bytes ONLY, not application.
  // Fail CI if the canonical 0115-0123 migration train gains a member that
  // the operator SHA-256 inventory does not cover.
  const train = readdirSync("drizzle")
    .filter(name => /^01(?:1[5-9]|2[0-3])_.*\.sql$/.test(name))
    .map(name => "drizzle/" + name).sort();
  assert.equal(train.length, 9, "0115-0123 must stay fully represented in the source manifest");
  for (const sourcePath of train) {
    assert.ok(manifestPaths.has(sourcePath), "omitted canonical migration: " + sourcePath);
  }
  assert.ok(manifestPaths.has("docs/sql/issue-910-review-only-0121-schema.sql"),
    "0123 additive candidate must also track its 0121 schema-only predecessor");
  for (const row of rows) {
    assert.match(row.source_sha256, /^[a-f0-9]{64}$/);
    assert.equal(row.source_sha256, createHash("sha256").update(readFileSync(row.path)).digest("hex"));
    assert.equal(row.production_applied, "UNPROVEN");
    assert.equal(row.source_only, true);
    assert.ok(row.bytes > 100);
  }
});
test("#910: source manifest refuses path traversal and does not require a database", () => {
  assert.throws(() => sourceManifest(["../../../../etc/passwd"]), /outside repository/);
  assert.throws(() => sourceManifest(["nonexistent.sql"]), /ENOENT/);
});
