import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const generator = "scripts/generate-issue-1015-catalog-inventory.mjs";

test("#1015 ordered migration catalog inventory stays source-only and read-only", () => {
  const child = spawnSync(process.execPath, [generator], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 512 * 1024,
    env: { ...process.env, DATABASE_URL: "", PRODUCTION_MIGRATION_AUDIT_DATABASE_URL: "" },
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, "");
  const sql = child.stdout;
  assert.match(sql, /^-- #1015 fixed-source, read-only catalog evidence/);
  assert.match(sql, /CATALOG_EVIDENCE_ONLY_NOT_HISTORICAL_RECEIPT_OR_RELEASE_APPROVAL/);

  const sourceRecords = sql.split("\n").filter(line =>
    /^\s*\('01(?:1\d|2[0-4])',\s*'drizzle\/01/.test(line));
  assert.equal(sourceRecords.length, 169);
  const prefixes = [...new Set(sourceRecords.map(line => line.match(/'(\d{4})'/)[1]))];
  assert.deepEqual(prefixes, Array.from({ length: 15 }, (_, i) => String(110 + i).padStart(4, "0")));
  assert.equal(new Set(sourceRecords).size, 169);

  // Actual query body must never contain database mutations or read app rows.
  const executable = sql.replace(/^--.*$/gm, "");
  assert.doesNotMatch(executable, /^\s*(?:CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|DO|CALL|GRANT|REVOKE)\b/gim);
  assert.doesNotMatch(executable, /\b(?:FROM|JOIN)\s+(?:public\.)?(?:employees|payroll_runs|payroll_entries|users|organizations|bank_accounts)\b/i);
  assert.match(executable, /FROM pg_catalog\.pg_class/);
  assert.match(executable, /FROM pg_catalog\.pg_constraint/);
  assert.match(executable, /FROM pg_catalog\.pg_attribute/);
  assert.match(executable, /FROM pg_catalog\.pg_index/);
});

test("#1015 catalog generator rejects executable options", () => {
  const child = spawnSync(process.execPath, [generator, "--apply"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 128 * 1024,
  });
  assert.notEqual(child.status, 0);
  assert.equal(child.stdout, "");
});
