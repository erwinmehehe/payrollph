import assert from "node:assert/strict";
import test from "node:test";
import { publicFirstPayrollPreviewError, publicFirstPayrollProgressError } from "../src/lib/first-payroll-public-errors";

test("preview preserves an intentional employer-scope blocker without raw SQL or IDs", () => {
  assert.match(publicFirstPayrollPreviewError(new Error("MULTI_ENTITY_PREVIEW_REQUIRES_SCOPED_AUTHORIZATION")), /Multiple legal employers/);
  assert.match(publicFirstPayrollPreviewError(new Error("Employer not found.")), /selected employer/);
});

test("unexpected PG errors and injected identifiers are never reflected", () => {
  const internal = new Error("violates constraint bank_accounts_key_abc; TIN=123456789; secret=private-token; SELECT * FROM payroll_entries");
  for (const message of [publicFirstPayrollPreviewError(internal),publicFirstPayrollProgressError(internal)]) {
    assert.doesNotMatch(message,/123456789|private-token|SELECT|bank_accounts/);
  }
});

test("role and period errors remain actionable and specific", () => {
  assert.match(publicFirstPayrollProgressError(new Error("HR must expressly attest valid calendar dates for this payroll period.")),/HR must/);
  assert.match(publicFirstPayrollProgressError(new Error("Invite and activate a member with this role before handing off the step.")),/Invite and activate/);
});
