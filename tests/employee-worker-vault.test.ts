import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import { auditEvents, documents, employees, hcmDocumentRequirements,
  hcmEmployeeDocumentCompliance, organizations, users } from "../src/db/schema";
import { documentObjectKey, documentStorageConfig, signedDocumentObjectUrl } from "../src/lib/document-object-storage";
import {
  canAccessEmployeeProfileVault, canArchiveEmployeeVaultUpload,
  vaultDocumentIsArchived, validEmployeeVaultCategory, type EmployeeVaultActor,
} from "../src/lib/employee-document-vault";
import { archiveEmployeeVaultUpload } from "../src/lib/employee-vault-profile-server";
import { MAX_UPLOAD_BYTES, validateUpload } from "../src/lib/storage";

function actor(role: string, employeeId: number | null = null, userId = 51): EmployeeVaultActor {
  return { role, employeeId, userId, companyWide: role !== "employee" };
}

test("Worker 360 vault denies wrong role, other worker and manager without explicit policy", () => {
  const own = actor("employee", 71);
  assert.equal(canAccessEmployeeProfileVault(own, 71), true);
  assert.equal(canAccessEmployeeProfileVault(own, 72), false);
  for (const role of ["admin", "bookkeeper", "payroll", "checker", "manager", "group_hr"]) {
    assert.equal(canAccessEmployeeProfileVault(actor(role), 71), false, role);
  }
  for (const role of ["owner", "hr"]) {
    assert.equal(canAccessEmployeeProfileVault(actor(role), 71), true, role);
    assert.equal(canAccessEmployeeProfileVault({ ...actor(role), companyWide: false }, 71), false);
  }
  assert.equal(canAccessEmployeeProfileVault(actor("owner"), -1), false);
});

test("retention-safe delete requires verified employee-owned object upload and immutable uploader", () => {
  const row = {
    employeeId: 71, sourceType: "upload",
    objectStorageKey: "private-documents/4/71/00000000-0000-4000-8000-000000000001",
    uploadedByUserId: 51, generationMetadata: {},
  };
  assert.equal(canArchiveEmployeeVaultUpload(actor("employee", 71), row), true);
  assert.equal(canArchiveEmployeeVaultUpload(actor("employee", 71, 52), row), false);
  assert.equal(canArchiveEmployeeVaultUpload(actor("employee", 72), row), false);
  assert.equal(canArchiveEmployeeVaultUpload(actor("manager"), row), false);
  assert.equal(canArchiveEmployeeVaultUpload(actor("hr"), row), true);
  assert.equal(canArchiveEmployeeVaultUpload(actor("owner"), { ...row, sourceType: "generated" }), false);
  assert.equal(canArchiveEmployeeVaultUpload(actor("owner"), { ...row, objectStorageKey: null }), false);
  assert.equal(vaultDocumentIsArchived({ vaultRemovedAt: "2026-10-16T00:00:00.000Z" }), true);
  assert.equal(canArchiveEmployeeVaultUpload(actor("owner"), {
    ...row, generationMetadata: { vaultRemovedAt: "2026-10-16T00:00:00.000Z" },
  }), false);
});

test("free-form employee documents accept only the defined categories", () => {
  for (const category of ["government_id", "contract", "certificate", "other"]) {
    assert.equal(validEmployeeVaultCategory(category), true);
  }
  for (const category of ["salary", "payroll", "company_id", "other;delete", ""]) {
    assert.equal(validEmployeeVaultCategory(category), false);
  }
  const api = readFileSync("src/app/api/documents/route.ts", "utf8");
  assert.match(api, /validEmployeeVaultCategory\(kind\)/);
});

test("vault upload rejects wrong MIME, extension, empty and oversized files", () => {
  const sample = Buffer.from("%PDF-1.7\nSynthetic PDF test only");
  assert.equal(validateUpload(sample, "application/pdf", "contract.pdf").ok, true);
  assert.equal(validateUpload(sample, "image/png", "contract.pdf").ok, false);
  assert.equal(validateUpload(sample, "application/pdf", "contract.exe").ok, false);
  assert.equal(validateUpload(new Uint8Array(), "application/pdf", "empty.pdf").ok, false);
  assert.equal(validateUpload(new Uint8Array(MAX_UPLOAD_BYTES + 1), "application/pdf", "large.pdf").ok, false);
});

test("private attachment downloads remain signed and fail on malformed disposition", () => {
  const config = documentStorageConfig({
    NODE_ENV: "production",
    DOCUMENT_OBJECT_STORAGE_ENDPOINT: "https://s3.example.invalid/",
    DOCUMENT_OBJECT_STORAGE_BUCKET: "private-vault-fixtures",
    DOCUMENT_OBJECT_STORAGE_REGION: "ap-southeast-1",
    DOCUMENT_OBJECT_STORAGE_ACCESS_KEY_ID: "synthetic-key",
    DOCUMENT_OBJECT_STORAGE_SECRET_ACCESS_KEY: "synthetic-secret",
  });
  const key = "private-documents/4/71/00000000-0000-4000-8000-000000000001";
  const url = signedDocumentObjectUrl(key, "GET", config, {
    now: new Date("2026-10-16T00:00:00Z"),
    responseContentDisposition: 'attachment; filename="contract.pdf"',
  });
  assert.equal(url.searchParams.get("response-content-disposition"), 'attachment; filename="contract.pdf"');
  assert.equal(url.searchParams.get("X-Amz-Expires"), "60");
  assert.ok(url.searchParams.get("X-Amz-Signature"));
  assert.throws(() => signedDocumentObjectUrl(key, "GET", config, {
    responseContentDisposition: "attachment; filename=\"bad\r\nheader\"",
  }));
  assert.throws(() => signedDocumentObjectUrl(key, "DELETE", config, {
    responseContentDisposition: 'attachment; filename="contract.pdf"',
  }));
});

test("Worker 360 uses existing routes and enforces tenant filtering before rendering bytes", () => {
  const ui = readFileSync("src/components/hcm-worker-document-vault.tsx", "utf8");
  const worker = readFileSync("src/components/hcm-worker-360.tsx", "utf8");
  const ess = readFileSync("src/components/employee-documents-panel.tsx", "utf8");
  const collection = readFileSync("src/app/api/documents/route.ts", "utf8");
  const fileRoute = readFileSync("src/app/api/documents/[id]/route.ts", "utf8");
  const storage = readFileSync("src/lib/document-object-storage.ts", "utf8");
  assert.match(worker, /<WorkerDocumentVault/);
  assert.match(ess, /<WorkerDocumentVault/);
  assert.match(ess, /data\.vaultEnabled/);
  assert.match(ess, /employeeId=\{data\.employee\.id\}/);
  assert.match(ui, /\/api\/documents\?/);
  assert.match(ui, /method: "POST"/);
  assert.match(ui, /method: "DELETE"/);
  assert.match(ui, /download=1/);
  assert.match(collection, /eq\(documents\.organizationId, organizationId\)/);
  assert.match(collection, /eq\(documents\.employeeId, requestedEmployeeId\)/);
  assert.match(collection, /assertScope\(access, employee\.orgUnitId\)/);
  assert.match(collection, /privateVaultStorageReady\(\)/);
  assert.match(fileRoute, /vaultDocumentIsArchived\(document\.generationMetadata\)/);
  assert.match(fileRoute, /enforceSameOriginMutation\(request\)/);
  assert.match(fileRoute, /assertMembership\(user\.id, row\.organizationId\)/);
  assert.match(fileRoute, /assertOrganizationRole\(user\.id, row\.organizationId/);
  assert.match(storage, /response-content-disposition/);
  assert.doesNotMatch(ui, /file_data_base64|PII_ENCRYPTION_KEY|localStorage|\bpayroll\s*:\s*calculate/);
});

test("disposable PostgreSQL vault soft-delete preserves object and audit while denying cross-tenant/wrong-role", async () => {
  const [ownOrg, otherOrg] = await db.insert(organizations).values([
    { name: "Vault profile own employer", legalName: "Vault profile own employer" },
    { name: "Vault profile foreign employer", legalName: "Vault profile foreign employer" },
  ]).returning();
  let uploaderId: number | null = null;
  try {
    const [uploader] = await db.insert(users).values({
      email: "vault-worker-" + ownOrg.id + "@synthetic.invalid",
      name: "Fictional Vault Uploader", passwordHash: "unusable-synthetic-only",
      role: "employee",
    }).returning();
    uploaderId = uploader.id;
    const [ownWorker, foreignWorker] = await db.insert(employees).values([
      { organizationId: ownOrg.id, employeeNo: "VLT" + ownOrg.id,
        firstName: "Synthetic", lastName: "One", title: "Worker",
        avatarInitials: "SO", basicRate: "1000.00", startDate: "2026-01-01" },
      { organizationId: otherOrg.id, employeeNo: "VLT" + otherOrg.id,
        firstName: "Synthetic", lastName: "Two", title: "Worker",
        avatarInitials: "ST", basicRate: "1000.00", startDate: "2026-01-01" },
    ]).returning();
    const fixture = (organizationId: number, employeeId: number) => ({
      organizationId, employeeId,
      kind: "contract", fileName: "fictional.pdf", mimeType: "application/pdf",
      byteSize: 12, sha256: "e".repeat(64), scannedClean: true,
      sourceType: "upload", uploadedBy: "Fictional Vault Uploader",
      uploadedByUserId: uploader.id, content: "",
      objectStorageKey: documentObjectKey(organizationId, employeeId),
    });
    const [mine, foreign, linked] = await db.insert(documents).values([
      fixture(ownOrg.id, ownWorker.id),
      fixture(otherOrg.id, foreignWorker.id),
      fixture(ownOrg.id, ownWorker.id),
    ]).returning();
    const hrOwner = { ...actor("owner", null, uploader.id), name: "Synthetic Owner" };
    const wrongTenant = await archiveEmployeeVaultUpload({
      organizationId: ownOrg.id, documentId: foreign.id, actor: hrOwner,
    });
    assert.deepEqual(wrongTenant, { ok: false, code: "NOT_FOUND" });

    const wrongRole = await archiveEmployeeVaultUpload({
      organizationId: ownOrg.id, documentId: mine.id,
      actor: { ...actor("manager", null, uploader.id), name: "Unauthorized Manager" },
    });
    assert.deepEqual(wrongRole, { ok: false, code: "FORBIDDEN" });
    const wrongEmployee = await archiveEmployeeVaultUpload({
      organizationId: ownOrg.id, documentId: mine.id,
      actor: { ...actor("employee", ownWorker.id + 1, uploader.id), name: "Wrong Worker" },
    });
    assert.deepEqual(wrongEmployee, { ok: false, code: "FORBIDDEN" });

    const [requirement] = await db.insert(hcmDocumentRequirements).values({
      organizationId: ownOrg.id, code: "VAULT" + ownOrg.id,
      name: "Fictional contract", kind: "contract", createdByName: "Synthetic HR",
    }).returning();
    await db.insert(hcmEmployeeDocumentCompliance).values({
      organizationId: ownOrg.id, employeeId: ownWorker.id,
      requirementId: requirement.id, documentId: linked.id, status: "submitted",
    });
    const protectedResult = await archiveEmployeeVaultUpload({
      organizationId: ownOrg.id, documentId: linked.id, actor: hrOwner,
    });
    assert.deepEqual(protectedResult, { ok: false, code: "LINKED" });

    const removed = await archiveEmployeeVaultUpload({
      organizationId: ownOrg.id, documentId: mine.id, actor: hrOwner,
      now: new Date("2026-10-16T08:00:00Z"),
    });
    assert.deepEqual(removed, { ok: true, id: mine.id });
    const [persisted] = await db.select().from(documents).where(and(
      eq(documents.id, mine.id), eq(documents.organizationId, ownOrg.id),
    ));
    assert.ok(persisted, "Retained object metadata must not be physically deleted");
    assert.equal(persisted.objectStorageKey, mine.objectStorageKey);
    assert.equal(vaultDocumentIsArchived(persisted.generationMetadata), true);
    const repeated = await archiveEmployeeVaultUpload({
      organizationId: ownOrg.id, documentId: mine.id, actor: hrOwner,
    });
    assert.deepEqual(repeated, { ok: false, code: "NOT_FOUND" });
    const audits = await db.select().from(auditEvents).where(and(
      eq(auditEvents.organizationId, ownOrg.id),
      eq(auditEvents.action, "Employee document removed from active private vault"),
    ));
    assert.equal(audits.length, 1, "Exactly one audit event for a successful removal");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, ownOrg.id));
    await db.delete(organizations).where(eq(organizations.id, otherOrg.id));
    if (uploaderId !== null) await db.delete(users).where(eq(users.id, uploaderId));
  }
});
