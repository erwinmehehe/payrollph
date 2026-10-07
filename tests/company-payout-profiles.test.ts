import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("company payout profiles are separate from payroll computation", () => {
  const schema = read("src/db/schema.ts");
  const migration = read("drizzle/0074_company_payout_profiles.sql");
  const api = read("src/app/api/payout-profiles/route.ts");
  const panel = read("src/components/payout-profiles-panel.tsx");

  for (const source of [schema, migration]) {
    assert.ok(source.includes("payout_profiles"));
    assert.ok(source.includes("legal_entity_id"));
    assert.ok(source.includes("bank_template_id"));
    assert.ok(source.includes("max_amount_per_file"));
    assert.ok(source.includes("max_rows_per_file"));
    assert.ok(source.includes("transaction_limit"));
    assert.ok(source.includes("daily_limit"));
  }

  assert.ok(panel.includes("Post-payroll boundary"));
  assert.ok(panel.includes("do not calculate gross pay, statutory deductions, withholding, or net pay"));
  assert.ok(api.includes('action: "Company payout profile updated"'));
  assert.ok(!api.includes("payroll-engine"));
  assert.ok(!api.includes("payroll-rules"));
});

test("bank adapters expose an honest validation lifecycle", () => {
  const schema = read("src/db/schema.ts");
  const migration = read("drizzle/0074_company_payout_profiles.sql");
  const api = read("src/app/api/payout-profiles/route.ts");
  const panel = read("src/components/payout-profiles-panel.tsx");

  for (const stage of [
    "draft",
    "spec_obtained",
    "mapping_ready",
    "uat_ready",
    "portal_validated",
    "production_proven",
  ]) {
    assert.ok(schema.includes(stage), `schema missing bank adapter stage ${stage}`);
    assert.ok(migration.includes(stage), `migration missing bank adapter stage ${stage}`);
  }

  assert.ok(api.includes('eq(bankFileValidations.status, "accepted")'));
  assert.ok(api.includes('portalValidated ? "portal_validated" : adapter.adapterStage'));
  assert.ok(panel.includes("Do not market this adapter as bank-validated"));
  assert.ok(panel.includes("accepted bank-portal UAT"));
});

test("company payout profile API never returns the encrypted funding account", () => {
  const api = read("src/app/api/payout-profiles/route.ts");

  assert.ok(api.includes("maskBankAccount(entity.disbursementAccount)"));
  assert.ok(!api.includes("decryptBankAccount"));
  assert.ok(api.includes("companyWide"));
  assert.ok(api.includes("requireSensitiveActionMfa"));
  assert.ok(api.includes("enforceSensitiveActionRateLimit"));
  assert.ok(api.includes("publicDemoMutationDenied"));
});

test("active bank-file payout requires a configured source account and bank adapter", () => {
  const api = read("src/app/api/payout-profiles/route.ts");

  assert.ok(api.includes('active && defaultMethod === "bank_file" && !adapter'));
  assert.ok(api.includes("must select a bank adapter"));
  assert.ok(api.includes('active && defaultMethod === "bank_file" && (!entity.disbursementBankCode || !entity.disbursementAccount)'));
  assert.ok(api.includes("encrypted disbursement bank and account"));
});

test("enterprise workspace exposes company payout profiles", () => {
  const workspace = read("src/components/linaw-workspace.tsx");
  assert.ok(workspace.includes('import { PayoutProfilesPanel } from "@/components/payout-profiles-panel";'));
  assert.ok(workspace.includes("<PayoutProfilesPanel organizationId={data.selectedOrganization.id}"));
});
