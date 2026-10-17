import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "../src/db/schema";

// A table declared in src/db/schema.ts that no numbered migration (or the
// baseline) creates exists only where `drizzle-kit push` ran. A database
// rebuilt from the migrations then lacks it, and code that touches it fails at
// runtime (for example email_change_tokens broke the retention purge).
//
// KNOWN_UNCREATED is a ratchet, not a permission list:
//  - a table missing a creator that is NOT listed fails this test (add a
//    migration, do not extend the list);
//  - a listed table that now has a creator fails too, so the list only shrinks.
// Closing a gap is a production schema change and stays human/DBA-gated; see
// docs/sql/*-additive-candidate.sql for reviewed, unnumbered candidates.
const KNOWN_UNCREATED: readonly string[] = [
  "applicant_privacy_evidence",
  "email_change_tokens",
  "employee_entity_bank_accounts",
  "employee_hr_case_messages",
  "employee_hr_cases",
  "employee_pay_profiles", // runtime DDL in src/lib/pay-basis-schema.ts
  "employee_pay_retro_adjustments", // runtime DDL in src/lib/pay-basis-schema.ts
  "employee_pay_revisions", // runtime DDL in src/lib/pay-basis-schema.ts
  "engagement_survey_participants",
  "engagement_surveys",
  "expense_category_policies",
  "expense_claim_evidence",
  "expense_report_items",
  "expense_reports",
  "hcm_document_expiry_notices",
  "historical_payroll_entries", // runtime DDL in src/lib/core-schema-compat.ts; 0013 only ALTERs it
  "it_access_grants",
  "it_applications",
  "it_device_events",
  "it_managed_devices",
  "legal_entity_profile_change_requests",
  "legal_entity_statutory_registrations",
  "legal_entity_transfer_liability_evidence",
  "offline_punch_claims",
  "saved_report_definitions",
  "separation_clearance_waivers",
  "spend_card_transactions",
  "spend_cards",
];

function schemaTables(): string[] {
  const names = new Set<string>();
  for (const value of Object.values(schema)) {
    if (is(value, PgTable)) names.add(getTableName(value));
  }
  return [...names].sort();
}

function createdByMigrations(): Set<string> {
  const files = readdirSync("drizzle").filter((name) => /^\d{4}_.+\.sql$/.test(name) || name === "baseline.sql");
  assert.ok(files.length > 100, "migration files must be found");
  const created = new Set<string>();
  const pattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?([A-Za-z0-9_]+)"?\s*\(/gi;
  for (const file of files) {
    const sql = readFileSync(`drizzle/${file}`, "utf8").replace(/--.*$/gm, "");
    for (const match of sql.matchAll(pattern)) created.add(match[1].toLowerCase());
  }
  return created;
}

test("schema.ts is read and the creator scan finds real tables", () => {
  const tables = schemaTables();
  assert.ok(tables.length > 200, `expected the full schema, found ${tables.length}`);
  const created = createdByMigrations();
  for (const sample of ["users", "organizations", "employees"]) {
    assert.ok(created.has(sample), `${sample} must be found in a migration or the baseline`);
  }
});

test("every schema.ts table has a numbered-migration creator, except the known gaps", () => {
  const created = createdByMigrations();
  const missing = schemaTables().filter((name) => !created.has(name.toLowerCase()));
  const unexpected = missing.filter((name) => !KNOWN_UNCREATED.includes(name));
  assert.deepEqual(unexpected, [], `new table(s) without a migration creator: ${unexpected.join(", ")}`);
  const stale = KNOWN_UNCREATED.filter((name) => !missing.includes(name));
  assert.deepEqual(stale, [], `now created or removed, delete from KNOWN_UNCREATED: ${stale.join(", ")}`);
});

test("the known-gap list is sorted and has no duplicates", () => {
  assert.deepEqual([...KNOWN_UNCREATED], [...new Set(KNOWN_UNCREATED)].sort());
});
