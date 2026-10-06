import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("core schema compatibility upgrades fields used by production demo and dashboard", () => {
  const source = read("src/lib/core-schema-compat.ts");

  for (const fragment of [
    "ADD COLUMN IF NOT EXISTS bir_tin",
    "ADD COLUMN IF NOT EXISTS middle_name",
    "ADD COLUMN IF NOT EXISTS nationality",
    "ADD COLUMN IF NOT EXISTS user_agent",
    "ADD COLUMN IF NOT EXISTS last_seen_at",
    "ADD COLUMN IF NOT EXISTS password_changed_at",
    "ADD COLUMN IF NOT EXISTS mfa_verified_at",
    "ADD COLUMN IF NOT EXISTS period_start",
    "ADD COLUMN IF NOT EXISTS period_end",
    "ADD COLUMN IF NOT EXISTS scope_org_unit_id",
    "ADD COLUMN IF NOT EXISTS source_system",
    "ADD COLUMN IF NOT EXISTS import_kind",
    "CREATE TABLE IF NOT EXISTS historical_payroll_entries",
    "CREATE TABLE IF NOT EXISTS worksites",
    "CREATE TABLE IF NOT EXISTS employee_worksite_assignments",
    "ADD COLUMN IF NOT EXISTS worksite_id integer REFERENCES worksites(id) ON DELETE SET NULL",
    "ADD COLUMN IF NOT EXISTS worksite_id integer REFERENCES worksites(id) ON DELETE CASCADE",
    "CREATE TABLE IF NOT EXISTS attendance_capture_policies",
    "CREATE TABLE IF NOT EXISTS attendance_offline_events",
  ]) {
    assert.ok(source.includes(fragment), `missing compatibility migration fragment: ${fragment}`);
  }

  assert.ok(source.includes("COALESCE(period_start, pay_date)"), "legacy payroll runs must get a non-null period start");
  assert.ok(source.includes("COALESCE(period_end, pay_date)"), "legacy payroll runs must get a non-null period end");
  assert.ok(source.includes("ALTER TABLE sessions"), "legacy production auth schema must be upgraded before demo session creation");
});

test("demo launch and authenticated dashboard apply core compatibility before Drizzle selects", () => {
  const demo = read("src/app/api/auth/demo-switch/route.ts");
  const dashboard = read("src/lib/dashboard-data.ts");

  assert.ok(demo.includes("await ensureCoreCompatibilitySchema()"), "demo launch must upgrade schema before provisioning");
  assert.ok(demo.includes("await preparePublicDemoTenant()"), "production demo launch must use the retry wrapper");
  assert.ok(demo.includes("await ensurePublicDemoTenant()"), "retry wrapper must still call the public demo provisioner");
  assert.ok(
    demo.indexOf("await ensureCoreCompatibilitySchema()") < demo.indexOf("await preparePublicDemoTenant()"),
    "compatibility upgrade must happen before retryable public demo tenant provisioning",
  );
  assert.ok(
    dashboard.indexOf("await ensureCoreCompatibilitySchema()") < dashboard.indexOf("await ensureSeedData()"),
    "dashboard must upgrade schema before selecting current organization fields",
  );
});


test("core compatibility widens legacy bank account storage for encrypted envelopes", () => {
  const source = read("src/lib/core-schema-compat.ts");
  assert.ok(
    source.includes("ALTER TABLE employees ALTER COLUMN bank_account TYPE varchar(160)"),
    "production compatibility must widen the legacy bank-account column before encrypted writes",
  );
});


test("core compatibility automatically seals legacy bank data and payroll snapshots", () => {
  const source = read("src/lib/core-schema-compat.ts");
  assert.ok(source.includes("backfillBankDataEncryption"));
  assert.ok(source.includes("bank_account NOT LIKE 'enc:v1:%'"));
  assert.ok(source.includes("trace #>> '{payment,bankAccount}'"));
  assert.ok(source.includes("jsonb_set(trace, '{payment,bankAccount}'"));
  assert.ok(source.includes("decryptBankAccount(sealed) !== plain"));
  assert.ok(source.includes("export async function bankDataEncryptionReady()"));
});
