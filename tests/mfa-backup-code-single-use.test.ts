import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { findMatchingBackupCode } from "../src/lib/mfa-backup-code";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

test("matches the stored digest of a normalized MFA backup code", () => {
  const code = "SYNTHETIC-MFA-CODE-123";
  const stored = [digest("UNRELATED-CODE"), digest(code)];
  assert.equal(findMatchingBackupCode(stored, code, digest(code)), digest(code));
  assert.deepEqual(stored, [digest("UNRELATED-CODE"), digest(code)],
    "Matching must not mutate the stale session snapshot");
});

test("preserves legacy plaintext recovery-code matching until rotation", () => {
  const code = "SYNTHETIC-LEGACY-456";
  assert.equal(findMatchingBackupCode([code], code, digest(code)), code);
});

test("rejects empty, malformed, and nonmatching recovery code arrays", () => {
  const code = "SYNTHETIC-NO-MATCH";
  for (const value of [null, {}, "not-an-array", [null, 12, {}, false], [digest("OTHER")]]) {
    assert.equal(findMatchingBackupCode(value, code, digest(code)), null);
  }
  assert.equal(findMatchingBackupCode([""], "", digest("")), null);
});

test("login consumes backup codes using a conditional PostgreSQL JSONB update", () => {
  const source = readFileSync(
    new URL("../src/app/api/auth/login/route.ts", import.meta.url), "utf8",
  );

  // A single UPDATE checks that the matching code still exists and removes it;
  // two concurrent requests presenting the same one-time code cannot both
  // obtain a successful conditional UPDATE.
  assert.match(source, /backupCodes:\s*sql`\$\{users\.backupCodes\} - \$\{matchedCode\}::text`/);
  assert.match(source, /jsonb_typeof\(\$\{users\.backupCodes\}\) = 'array'/);
  assert.match(source, /\$\{users\.backupCodes\} @> jsonb_build_array\(\$\{matchedCode\}::text\)/);
  assert.match(source, /\.returning\(\{ id: users\.id \}\)/);
  assert.match(source, /totpOk = Boolean\(consumed\)/);
  assert.doesNotMatch(source, /backupCodes:\s*codes\.filter/);
});
