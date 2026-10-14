import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("merged A4 receipt ledgers and A5 expiry notices are both present", () => {
  const source = readFileSync("src/db/schema.ts", "utf8");
  for (const table of ["expense_category_policies", "expense_claim_evidence", "hcm_document_expiry_notices"]) {
    assert.ok(source.includes('"' + table + '"'),
      table + " was lost while reconciling A4/A5");
  }
  for (const constraint of [
    "hcm_document_expiry_notice_unique",
    "expense_evidence_receipt_key_unique",
    "expense_evidence_receipt_tenant_hash_unique",
  ]) {
    assert.ok(source.includes(constraint), constraint + " was dropped");
  }
});

test("retention tick recovers pending COE, Spend and vault objects even when flags are OFF", () => {
  const source = readFileSync("src/lib/data-retention.ts", "utf8");
  for (const sweeper of [
    "sweepPendingCoeObjects",
    "sweepPendingSpendReceipts",
    "sweepPendingVaultUploads",
  ]) {
    assert.ok(source.includes("await " + sweeper + "(new Date(now))"),
      sweeper + " must be executed by retained scheduler");
  }
  for (const result of [
    "pendingCoeObjectRecovery", "pendingSpendReceiptRecovery", "pendingVaultObjectRecovery",
  ]) {
    assert.match(source, new RegExp("^\\s+" + result + ",?$", "m"),
      result + " must be included in retention results");
  }
  assert.doesNotMatch(source, /if\s*\(criticalReleaseFlagEnabled\(["'](?:spendPayrollReimbursements|employeeDocumentVault)/,
    "orphan cleanup cannot be gated on the active rollout flags");
});
