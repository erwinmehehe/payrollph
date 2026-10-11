import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { bankBackfillColumns, bankBackfillSchemaGaps } from "../src/lib/bank-backfill-preflight";

const good = [
  { name: "employees.bank_account", typeName: "varchar", maxLength: 160 },
  { name: "payroll_entries.trace", typeName: "jsonb", maxLength: null },
  { name: "legal_entities.disbursement_account", typeName: "varchar", maxLength: 160 },
  { name: "employee_payout_change_requests.proposed_bank_account", typeName: "text", maxLength: null },
];

test("four bank stores require exact catalog columns, jsonb trace and 160-character envelopes", () => {
  assert.deepEqual(bankBackfillSchemaGaps(good), []);
  assert.deepEqual(bankBackfillSchemaGaps([]), [...bankBackfillColumns]);
  for (const name of bankBackfillColumns) {
    const missing = good.filter(row => row.name !== name);
    assert.deepEqual(bankBackfillSchemaGaps(missing), [name]);
  }
  const tooNarrow = good.map(row => row.name === "employees.bank_account" ? { ...row, maxLength: 40 } : row);
  assert.deepEqual(bankBackfillSchemaGaps(tooNarrow), ["employees.bank_account"]);
  const wrongTrace = good.map(row => row.name === "payroll_entries.trace" ? { ...row, typeName: "json" } : row);
  assert.deepEqual(bankBackfillSchemaGaps(wrongTrace), ["payroll_entries.trace"]);
  const invalidType = good.map(row => row.name === "legal_entities.disbursement_account" ? { ...row, typeName: "int4" } : row);
  assert.deepEqual(bankBackfillSchemaGaps(invalidType), ["legal_entities.disbursement_account"]);
});

test("DB preflight uses a read-only transaction, exact DB identity and pg_catalog only", () => {
  const s = readFileSync("scripts/check-bank-backfill-preflight.ts", "utf8");
  assert.match(s, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY/);
  assert.match(s, /current_database\(\) = \$1::text/);
  assert.match(s, /pg_catalog\.pg_attribute/);
  assert.match(s, /has_table_privilege/);
  assert.match(s, /has_schema_privilege/);
  assert.match(s, /BANK_BACKFILL_ROLE/);
  assert.match(s, /ROLLBACK/);
  assert.doesNotMatch(s, /ALTER TABLE|CREATE TABLE|UPDATE \w+|DELETE FROM|INSERT INTO|db:push/);
});

test("workflow requires reviewed SHA, exact prod deployment, dedicated key and explicit apply sign-off", () => {
  const w = readFileSync(".github/workflows/production-bank-encryption.yml", "utf8");
  assert.match(w, /workflow_dispatch:/);
  assert.match(w, /github\.ref == 'refs\/heads\/main'/);
  assert.match(w, /environment: production/);
  assert.match(w, /REVIEWED_SHA.*inputs\.reviewed_sha/);
  assert.match(w, /REVIEWED_SHA" != "\$GITHUB_SHA"/);
  assert.match(w, /deploymentSha == \$sha/);
  assert.match(w, /deploymentEnvironment == "production"/);
  assert.match(w, /bankEncryptionKeySource\(\) !== "dedicated"/);
  assert.match(w, /APPLY_APPROVED_BANK_BACKFILL/);
  assert.match(w, /APPROVAL_REF/);
  assert.match(w, /PRODUCTION_BANK_AUDIT_DATABASE_URL/);
  assert.match(w, /EXPECTED_PRODUCTION_DATABASE_NAME/);
  assert.doesNotMatch(w, /run:\s+npx tsx scripts\/prepare-bank-encryption\.ts/);
  assert.doesNotMatch(w, /run:\s+npm run db:push/);
});

test("secrets are scoped to steps and never present for checkout or npm ci", () => {
  const w = readFileSync(".github/workflows/production-bank-encryption.yml", "utf8");
  const start = w.indexOf("    env:");
  const steps = w.indexOf("    steps:", start);
  const jobEnv = w.slice(start, steps);
  assert.doesNotMatch(jobEnv, /secrets\.|DATABASE_URL:|BANK_DATA_ENCRYPTION_KEY:/);
  const ciIndex = w.indexOf("      - run: npm ci");
  const firstSecret = w.indexOf("secrets.");
  assert.ok(firstSecret > ciIndex, "no secret should be bound before dependency installation");
  assert.ok(w.includes("BANK_DATA_ENCRYPTION_KEY: ${{ secrets.PRODUCTION_BANK_DATA_ENCRYPTION_KEY }}"));
  assert.ok(!w.includes("TOTP_ENCRYPTION_KEY: ${{ secrets.PRODUCTION_TOTP_ENCRYPTION_KEY }}"));
});

test("database access is split into a least-privilege read-only audit and controlled apply", () => {
  const w = readFileSync(".github/workflows/production-bank-encryption.yml", "utf8");
  assert.match(w, /BANK_BACKFILL_ROLE: audit/);
  assert.match(w, /BANK_BACKFILL_ROLE: apply/);
  assert.ok(w.includes("DATABASE_URL: ${{ secrets.PRODUCTION_BANK_AUDIT_DATABASE_URL }}"));
  assert.ok(w.includes("DATABASE_URL: ${{ secrets.PRODUCTION_DATABASE_URL }}"));
  assert.ok(w.indexOf("Verify exact database/schema before approved apply") <
    w.indexOf("Encrypt legacy bank data"));
  assert.ok(w.indexOf("Verify dedicated runner key") <
    w.indexOf("Read-only four-store legacy account inventory"));
  assert.ok(w.indexOf("Authenticate every bank envelope") >
    w.indexOf("Verify zero plaintext bank data remains"));
});
