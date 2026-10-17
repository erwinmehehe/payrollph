import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expenseClaimDecisionNotice } from "../src/lib/expense-claim-communication";

test("expense approval does not promise automatic payment or next-run payroll settlement", () => {
  const approved = expenseClaimDecisionNotice("approved");
  assert.equal(
    approved,
    "Claim approved. Reimbursement, if enabled, is handled separately during reviewed payroll settlement.",
  );
  assert.doesNotMatch(approved, /next payroll run|automatically reimburs|payment sent|funds transferred/i);
  assert.equal(expenseClaimDecisionNotice("rejected"), "Claim rejected.");
});

test("expense claim UI uses decision-specific copy and accurately labels unpaid approved claims", () => {
  const ui = readFileSync("src/components/wallet-panel.tsx", "utf8");
  assert.match(ui, /setNotice\(expenseClaimDecisionNotice\(status\)\)/);
  assert.doesNotMatch(ui, /Approved claims reimburse on the next payroll run/);
  assert.match(ui, /<p>APPROVED \/ UNPAID<\/p>/);
});
