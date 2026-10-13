import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
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

test("remote plain HTTP storage endpoints are denied even in test/staging", async () => {
  const { documentStorageConfig } = await import("../src/lib/document-object-storage");
  const credentials = {
    DOCUMENT_OBJECT_STORAGE_BUCKET: "private-documents-test",
    DOCUMENT_OBJECT_STORAGE_REGION: "ap-southeast-1",
    DOCUMENT_OBJECT_STORAGE_ACCESS_KEY_ID: "synthetic-key",
    DOCUMENT_OBJECT_STORAGE_SECRET_ACCESS_KEY: "synthetic-secret",
  };
  for (const mode of ["test", "development", "production"]) {
    for (const host of ["http://s3.example.invalid/", "http://localhost.evil.invalid/", "http://10.0.0.15/"]) {
      assert.throws(() => documentStorageConfig({ ...credentials, NODE_ENV: mode, DOCUMENT_OBJECT_STORAGE_ENDPOINT: host }), /requires HTTPS/);
    }
  }
  const local = documentStorageConfig({ ...credentials, NODE_ENV: "test", DOCUMENT_OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9000/" });
  assert.equal(local.endpoint, "http://127.0.0.1:9000");
  assert.throws(() => documentStorageConfig({ ...credentials, NODE_ENV: "production", DOCUMENT_OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9000/" }), /requires HTTPS/);
});

test("optional 201 file never counts as missing a required document", async () => {
  const { isMandatoryDocumentMissing } = await import("../src/lib/employee-document-vault");
  assert.equal(isMandatoryDocumentMissing({ status: "missing", mandatory: true }), true);
  assert.equal(isMandatoryDocumentMissing({ status: "missing", mandatory: false }), false);
  assert.equal(isMandatoryDocumentMissing({ status: "submitted", mandatory: true }), false);
  assert.equal(isMandatoryDocumentMissing({ status: "waived", mandatory: true }), false);
});


test("private object uploads refuse overwrites and fail closed on storage precondition errors",async()=>{
 const { putDocumentObject }=await import("../src/lib/document-object-storage");
 const previous=process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED;
 process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED="true";
 try{
  const key="private-documents/4/15/00000000-0000-4000-8000-000000000001";
  const config={
   endpoint:"https://objects.example.test",bucket:"private-files",region:"us-east-1",
   accessKeyId:"SYNTHETIC_KEY",secretAccessKey:"synthetic-not-real",
  };
  const seen:RequestInit[]=[];
  const mocked=async(_input:RequestInfo|URL,init?:RequestInit)=>{
   seen.push(init??{});return new Response(null,{status:200});
  };
  await putDocumentObject(key,new Uint8Array([37,80,68,70]),"application/pdf",{
   fetchImpl:mocked as typeof fetch,config,
  });
  assert.equal((seen[0].headers as Record<string,string>)["If-None-Match"],"*");
  await assert.rejects(putDocumentObject(key,new Uint8Array([1]),"application/pdf",{
   fetchImpl:(async()=>new Response(null,{status:412})) as typeof fetch,config,
  }),/Private document upload failed/);
 }finally{
  if(previous===undefined)delete process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED;
  else process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED=previous;
 }
});

test("rollout rollback still restricts private HR document metadata to People/HR roles", () => {
  // Pure role guard is tested above; this checks the actual list SQL also
  // excludes object-backed rows for non-HR People roles after flag rollback.
  const source = readFileSync("src/app/api/documents/route.ts", "utf8");
  assert.match(source,
    /canStaffOpenEmployeeVault\(access\.role\) \? undefined : legacyVisibleDocumentWhere/);
});

test("A-5 reads and generated documents remain compatible with old columns", () => {
  const compat = readFileSync("src/lib/document-schema-compat.ts", "utf8");
  const download = readFileSync("src/app/api/documents/[id]/route.ts", "utf8");
  const generated = readFileSync("src/lib/automation-document-generation.ts", "utf8");
  const list = readFileSync("src/app/api/documents/route.ts", "utf8");
  assert.match(compat, /to_jsonb/);
  assert.match(compat, /object_storage_key/);
  assert.match(download, /db\.select\(compatibleDocumentColumns\)\.from\(documents\)/);
  assert.match(generated, /db\.select\(compatibleDocumentColumns\)\.from\(documents\)/);
  assert.match(generated, /\.returning\(\{ id: documents\.id \}\)/);
  assert.doesNotMatch(generated, /\.returning\(\);/);
  assert.match(list, /legacyVisibleDocumentWhere/);
});

test("merged HR document protection rejects unscanned private objects after flag rollback", async () => {
  const { documentBytesMayBeReleased } = await import("../src/lib/employee-document-vault");
  const proof = { scannedClean: false, isProduction: false, vaultEnabled: false, hasPrivateObject: true };
  assert.equal(documentBytesMayBeReleased(proof), false);
  assert.equal(documentBytesMayBeReleased({ ...proof, isProduction: true, hasPrivateObject: false }), false);
  assert.equal(documentBytesMayBeReleased({ ...proof, vaultEnabled: true, hasPrivateObject: false }), false);
  assert.equal(documentBytesMayBeReleased({ ...proof, hasPrivateObject: false }), true);
  assert.equal(documentBytesMayBeReleased({ ...proof, scannedClean: true }), true);
  const route = readFileSync("src/app/api/documents/[id]/route.ts", "utf8");
  assert.ok(route.includes("documentBytesMayBeReleased"));
  const schema = readFileSync("src/db/schema.ts", "utf8");
  assert.ok(schema.includes("documents_org_employee_id_hr_cases_unique"),
    "A-3 tenant-bound COE parent constraint must survive the A-5 reconciliation");
});
