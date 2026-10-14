import assert from "node:assert/strict";
import test from "node:test";
import { claimCanAttachReceipt } from "../src/lib/spend-payroll-reimbursement";
import { validateUpload } from "../src/lib/storage";

test("receipt can attach only once, before decision or payroll", () => {
  const row = { status: "pending", payrollRunId: null, receiptStorageKey: null };
  assert.equal(claimCanAttachReceipt(row), true);
  assert.equal(claimCanAttachReceipt({ ...row, receiptStorageKey: "stored" }), false);
  assert.equal(claimCanAttachReceipt({ ...row, status: "approved" }), false);
  assert.equal(claimCanAttachReceipt({ ...row, status: "paid" }), false);
  assert.equal(claimCanAttachReceipt({ ...row, payrollRunId: 1 }), false);
});
test("receipt content type is verified from bytes, not trusted browser file type", () => {
  const pdf = new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x31,0x2e,0x37]);
  assert.equal(validateUpload(pdf, "application/pdf", "receipt.pdf").ok, true);
  assert.equal(validateUpload(pdf, "image/png", "receipt.png").ok, false);
  assert.equal(validateUpload(new Uint8Array([1,2,3]), "application/pdf", "receipt.pdf").ok, false);
});
