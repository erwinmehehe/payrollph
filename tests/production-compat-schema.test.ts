import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync("src/lib/core-schema-compat.ts", "utf8");

test("production compatibility schema includes all compliance-hardening migrations", () => {
  for (const marker of [
    "statutory_deduction_timing",
    "pagibig_voluntary_monthly",
    "fulfillment_action",
    "fulfillment_evidence",
    "legal_retention_applied",
    "withholding_atc",
    "withholding_rate",
    "CREATE TABLE IF NOT EXISTS contractor_payments",
    "break_start",
    "break_end",
    "payroll_calendar_mode",
    "org_unit_id",
    "CREATE TABLE IF NOT EXISTS supplementary_earnings",
    "include_in_sss_base",
    "include_in_pagibig_base",
    "ALTER COLUMN tin TYPE varchar(180)",
    "ALTER COLUMN tin_branch_code TYPE varchar(180)",
    "ALTER COLUMN sss_no TYPE varchar(180)",
    "ALTER COLUMN philhealth_no TYPE varchar(180)",
    "ALTER COLUMN pagibig_no TYPE varchar(180)",
  ]) {
    assert.ok(source.includes(marker), `production compatibility schema is missing ${marker}`);
  }
});

test("production compatibility schema only backfills government IDs when a stable key exists", () => {
  assert.ok(source.includes("governmentIdEncryptionConfigured()"));
  assert.ok(source.includes("backfillGovernmentIdEncryption(client)"));
  assert.ok(source.includes("encryptGovernmentId"));
  assert.ok(source.includes("decryptGovernmentId"));
  assert.ok(source.includes("isEncryptedGovernmentId"));
  assert.ok(source.includes("Government-ID encryption round-trip failed"));
});

test("production compatibility migration remains advisory-locked and idempotent", () => {
  assert.ok(source.includes("linaw_core_schema_compat_v4"));
  assert.ok(source.includes("pg_advisory_xact_lock"));
  assert.ok(source.includes("ADD COLUMN IF NOT EXISTS"));
  assert.ok(source.includes("CREATE TABLE IF NOT EXISTS"));
  assert.ok(source.includes("CREATE INDEX IF NOT EXISTS"));
});
