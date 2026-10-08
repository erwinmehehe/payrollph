import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

test("older hosted databases create compliance prerequisites before legal-entity upgrades", () => {
  const source = read("src/lib/core-schema-compat.ts");
  for (const table of ["bir_withholding_remittance_batches", "statutory_remittance_month_closures", "government_loan_remittance_batches", "government_loan_remittance_members"]) {
    const create = source.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
    const alter = source.indexOf(`ALTER TABLE ${table}\n`);
    assert.ok(create >= 0, `${table} must exist on older deployments`);
    assert.ok(create < alter, `${table} must be created before it is upgraded`);
  }
});

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
    "CREATE TABLE IF NOT EXISTS statutory_remittance_batches",
    "CREATE TABLE IF NOT EXISTS statutory_posting_evidence_artifacts",
    "CREATE TABLE IF NOT EXISTS statutory_remittance_members",
    "CREATE TABLE IF NOT EXISTS statutory_contribution_issue_cases",
    "CREATE TABLE IF NOT EXISTS statutory_contribution_issue_events",
    "CREATE TABLE IF NOT EXISTS workforce_plans",
    "CREATE TABLE IF NOT EXISTS workforce_planning_scenarios",
    "CREATE TABLE IF NOT EXISTS worksites",
    "CREATE TABLE IF NOT EXISTS employee_worksite_assignments",
    "ADD COLUMN IF NOT EXISTS worksite_id integer REFERENCES worksites(id) ON DELETE SET NULL",
    "ADD COLUMN IF NOT EXISTS worksite_id integer REFERENCES worksites(id) ON DELETE CASCADE",
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


test("contribution issue parent compatibility is created before dependent event table", () => {
  const source = read("src/lib/core-schema-compat.ts");
  const casesAt = source.indexOf("CREATE TABLE IF NOT EXISTS statutory_contribution_issue_cases");
  const eventsAt = source.indexOf("CREATE TABLE IF NOT EXISTS statutory_contribution_issue_events");

  assert.ok(casesAt >= 0, "production compatibility must create contribution issue cases");
  assert.ok(eventsAt >= 0, "production compatibility must create contribution issue events");
  assert.ok(casesAt < eventsAt, "parent contribution issue cases must exist before the event foreign key is created");
  assert.ok(source.includes("statutory_contribution_issue_org_status_idx"));
  assert.ok(source.includes("statutory_contribution_issue_employee_idx"));
  assert.ok(source.includes("statutory_contribution_issue_member_idx"));
});


test("statutory remittance compatibility creates the full parent chain before contribution cases", () => {
  const source = read("src/lib/core-schema-compat.ts");
  const batchesAt = source.indexOf("CREATE TABLE IF NOT EXISTS statutory_remittance_batches");
  const artifactsAt = source.indexOf("CREATE TABLE IF NOT EXISTS statutory_posting_evidence_artifacts");
  const membersAt = source.indexOf("CREATE TABLE IF NOT EXISTS statutory_remittance_members");
  const casesAt = source.indexOf("CREATE TABLE IF NOT EXISTS statutory_contribution_issue_cases");

  assert.ok(batchesAt >= 0);
  assert.ok(artifactsAt > batchesAt, "posting evidence must follow its remittance batch parent");
  assert.ok(membersAt > artifactsAt, "members must follow posting evidence because they reference it");
  assert.ok(casesAt > membersAt, "contribution cases must follow remittance batches and members");
  assert.ok(source.includes("ADD COLUMN IF NOT EXISTS posted_amount"));
  assert.ok(source.includes("ADD COLUMN IF NOT EXISTS posting_evidence_artifact_id"));
  assert.ok(source.includes("statutory_remittance_member_unique"));
  assert.ok(source.includes("statutory_remittance_members_evidence_idx"));
});

test("workforce planning compatibility creates plan parent before scenarios", () => {
  const source = read("src/lib/core-schema-compat.ts");
  const plansAt = source.indexOf("CREATE TABLE IF NOT EXISTS workforce_plans");
  const scenariosAt = source.indexOf("CREATE TABLE IF NOT EXISTS workforce_planning_scenarios");

  assert.ok(plansAt >= 0, "production compatibility must create workforce plans");
  assert.ok(scenariosAt > plansAt, "workforce plans must exist before scenario foreign keys");
  assert.ok(source.includes("workforce_plans_org_name_dates_unique"));
  assert.ok(source.includes("workforce_plans_org_status_idx"));
});



test("hosted demo upgrades organization, identity, approval, and bank preview fields", () => {
  const source = read("src/lib/core-schema-compat.ts");
  for (const marker of ["ALTER TABLE org_units", "ADD COLUMN IF NOT EXISTS manager_employee_id", "ADD COLUMN IF NOT EXISTS local_password_enabled", "CREATE TABLE IF NOT EXISTS organization_security_policies", "ADD COLUMN IF NOT EXISTS approval_chain_instance_id", "ADD COLUMN IF NOT EXISTS adapter_stage"]) {
    assert.ok(source.includes(marker), `Missing hosted-demo model upgrade: ${marker}`);
  }
});
