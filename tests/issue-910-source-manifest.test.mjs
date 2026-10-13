import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { sourceManifest } from "../scripts/issue-910-source-manifest.mjs";

test("#910: source SHA-256 matches independently hashed exact bytes and never certifies application", () => {
  const rows = sourceManifest();
  assert.equal(rows.length, 19);
  for (const additional of ["drizzle/0026_statutory_remittance_corrections.sql", "drizzle/0105_ess_self_service_profile.sql"]) {
    assert.ok(rows.some(row => row.path === additional), "track drift candidate source: " + additional);
  }
  assert.equal(new Set(rows.map(row => row.path)).size, rows.length);
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
