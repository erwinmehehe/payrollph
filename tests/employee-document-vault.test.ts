import assert from "node:assert/strict";
import test from "node:test";
import { canIssueExpiryNotice, documentExpiryMilestone, documentObjectIdentityMatches, expiryDaysRemaining, manilaDateOnly, validExpiryCalendarDate } from "../src/lib/employee-document-vault";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";

test("201 file vault is default-off and exact-flag-only", () => {
  assert.equal(criticalReleaseFlagEnabled("employeeDocumentVault", {}), false);
  assert.equal(criticalReleaseFlagEnabled("employeeDocumentVault", { EMPLOYEE_DOCUMENT_VAULT_ENABLED: "TRUE" }), false);
  assert.equal(criticalReleaseFlagEnabled("employeeDocumentVault", { EMPLOYEE_DOCUMENT_VAULT_ENABLED: "true" }), true);
});

test("Philippine calendar handles UTC midnight and leap-year dates", () => {
  assert.equal(manilaDateOnly(new Date("2026-10-11T15:59:59Z")), "2026-10-11");
  assert.equal(manilaDateOnly(new Date("2026-10-11T16:00:00Z")), "2026-10-12");
  assert.equal(validExpiryCalendarDate("2028-02-29"), true);
  assert.equal(validExpiryCalendarDate("2026-02-29"), false);
  assert.equal(validExpiryCalendarDate("2026-13-15"), false);
});

test("expiry stages are 30, 14, 7 Manila calendar days with retry catch-up", () => {
  const day = new Date("2026-10-11T16:05:00Z"); // Oct 12 in Manila
  for (const [date, remaining, milestone] of [
    ["2026-11-12",31,null],["2026-11-11",30,30],["2026-11-10",29,30],
    ["2026-10-27",15,30],["2026-10-26",14,14],["2026-10-19",7,7],
    ["2026-10-12",0,7],["2026-10-11",-1,null],
  ] as const) {
    assert.equal(expiryDaysRemaining(date, day), remaining);
    assert.equal(documentExpiryMilestone(date, day).milestoneDays, milestone);
  }
});

test("every object key must match the exact employer and employee", () => {
  const key = "private-documents/4/15/00000000-0000-4000-8000-000000000001";
  assert.equal(documentObjectIdentityMatches(key, 4, 15), true);
  assert.equal(documentObjectIdentityMatches(key, 5, 15), false);
  assert.equal(documentObjectIdentityMatches(key, 4, 1), false);
  assert.equal(documentObjectIdentityMatches(key.replace("/15/", "/company/"), 4, null), true);
  assert.equal(documentObjectIdentityMatches("https://attacker.example/a", 4, 15), false);
  assert.equal(documentObjectIdentityMatches("../private-documents/4/15/id", 4, 15), false);
});

test("only HR-verified, clean required documents produce milestone notices", () => {
  const input = { status: "current", documentId: 30, verifiedAt: new Date(),
    scannedClean: true, expiryRequired: true };
  assert.equal(canIssueExpiryNotice(input), true);
  assert.equal(canIssueExpiryNotice({ ...input, status: "submitted" }), false);
  assert.equal(canIssueExpiryNotice({ ...input, status: "waived" }), false);
  assert.equal(canIssueExpiryNotice({ ...input, verifiedAt: null }), false);
  assert.equal(canIssueExpiryNotice({ ...input, scannedClean: false }), false);
  assert.equal(canIssueExpiryNotice({ ...input, expiryRequired: false }), false);
});

test("bookkeeper, manager, payroll checker and unknown staff cannot access HR vault", async () => {
  const { canStaffOpenEmployeeVault } = await import("../src/lib/employee-document-vault");
  for (const role of ["owner", "admin", "hr"]) {
    assert.equal(canStaffOpenEmployeeVault(role), true);
  }
  for (const role of ["bookkeeper", "manager", "payroll", "checker", "employee", "", "superadmin"]) {
    assert.equal(canStaffOpenEmployeeVault(role), false);
  }
});

test("S3-style document URLs are short-lived, private, scoped and credential-safe", async () => {
  const { signedDocumentObjectUrl, documentStorageConfig } = await import("../src/lib/document-object-storage");
  const config = documentStorageConfig({
    NODE_ENV: "production",
    DOCUMENT_OBJECT_STORAGE_ENDPOINT: "https://s3.example.invalid/",
    DOCUMENT_OBJECT_STORAGE_BUCKET: "private-documents-test",
    DOCUMENT_OBJECT_STORAGE_REGION: "ap-southeast-1",
    DOCUMENT_OBJECT_STORAGE_ACCESS_KEY_ID: "test-not-a-secret",
    DOCUMENT_OBJECT_STORAGE_SECRET_ACCESS_KEY: "synthetic-test-secret",
  });
  const key = "private-documents/4/15/00000000-0000-4000-8000-000000000001";
  const url = signedDocumentObjectUrl(key, "GET", config, {
    now: new Date("2026-10-12T00:00:00Z"), expirySeconds: 60,
  });
  assert.equal(url.protocol, "https:");
  assert.equal(url.searchParams.get("X-Amz-Expires"), "60");
  assert.equal(url.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
  assert.ok(url.searchParams.has("X-Amz-Signature"));
  assert.equal(url.toString().includes("synthetic-test-secret"), false);
  assert.throws(() => signedDocumentObjectUrl("../some-other-tenant/object", "GET", config));
  assert.throws(() => signedDocumentObjectUrl(key, "GET", config, { expirySeconds: 301 }));
  assert.throws(() => documentStorageConfig({
    NODE_ENV: "production", DOCUMENT_OBJECT_STORAGE_ENDPOINT: "http://s3.example.invalid/",
    DOCUMENT_OBJECT_STORAGE_BUCKET: "private-documents-test",
    DOCUMENT_OBJECT_STORAGE_REGION: "ap-southeast-1",
    DOCUMENT_OBJECT_STORAGE_ACCESS_KEY_ID: "abc",
    DOCUMENT_OBJECT_STORAGE_SECRET_ACCESS_KEY: "def",
  }));
});

test("optional 201 file never counts as missing a required document", async () => {
  const { isMandatoryDocumentMissing } = await import("../src/lib/employee-document-vault");
  assert.equal(isMandatoryDocumentMissing({ status: "missing", mandatory: true }), true);
  assert.equal(isMandatoryDocumentMissing({ status: "missing", mandatory: false }), false);
  assert.equal(isMandatoryDocumentMissing({ status: "submitted", mandatory: true }), false);
  assert.equal(isMandatoryDocumentMissing({ status: "waived", mandatory: true }), false);
});
