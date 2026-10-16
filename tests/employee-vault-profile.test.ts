import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { documents, employees, hcmDocumentRequirements, hcmEmployeeDocumentCompliance,
  organizations, userOrganizations, users } from "../src/db/schema";
import { documentObjectKey } from "../src/lib/document-object-storage";
import { removeEmployeeVaultDocument } from "../src/lib/employee-vault-document-removal";
import { authorizeEmployeeVault, employeeVaultCanRemove, employeeVaultRoleAllowed,
  VAULT_REMOVED_SOURCE_PREFIX, vaultRecordRemoved } from "../src/lib/employee-vault-profile";
import { MAX_UPLOAD_BYTES, validateUpload } from "../src/lib/storage";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";

test("Employee vault is default-off and role access fails closed", () => {
  assert.equal(criticalReleaseFlagEnabled("employeeDocumentVault", {}), false);
  assert.equal(criticalReleaseFlagEnabled("documentUploads", {}), false);
  const worker = { companyWide: false, actorOrgUnitId: 3,
    targetOrgUnitId: 3, actorEmployeeId: null, targetEmployeeId: 12 };
  for (const role of ["admin", "bookkeeper", "payroll", "checker", "manager", "group_hr", "unknown"]) {
    assert.equal(employeeVaultRoleAllowed({ ...worker, role }), false,
      role + " must not inherit HR 201-file read permission");
  }
  assert.equal(employeeVaultRoleAllowed({ ...worker, role: "hr" }), true);
  assert.equal(employeeVaultRoleAllowed({ ...worker, role: "hr", targetOrgUnitId: 4 }), false);
  assert.equal(employeeVaultRoleAllowed({ ...worker, role: "owner", companyWide: true }), true);
  assert.equal(employeeVaultRoleAllowed({ ...worker, role: "employee", actorEmployeeId: 12 }), true);
  assert.equal(employeeVaultRoleAllowed({ ...worker, role: "employee", actorEmployeeId: 13 }), false);
  assert.equal(employeeVaultCanRemove({ role: "employee", actorUserId: 4, uploadedByUserId: 5 }), false);
  assert.equal(employeeVaultCanRemove({ role: "employee", actorUserId: 4, uploadedByUserId: 4 }), true);
  assert.equal(employeeVaultCanRemove({ role: "manager", actorUserId: 4, uploadedByUserId: 4 }), false);
  assert.equal(vaultRecordRemoved(VAULT_REMOVED_SOURCE_PREFIX + "4:synthetic"), true);
  assert.equal(vaultRecordRemoved("vault-upload-pending:4"), false);
});

test("Existing server validator refuses oversized, spoofed and wrong-type files", () => {
  const pdf = Buffer.from("%PDF-1.7\nsynthetic disposable employee vault acceptance");
  assert.deepEqual(validateUpload(pdf, "application/pdf", "fictional-contract.pdf"),
    { ok: true, kind: "pdf", mime: "application/pdf" });
  assert.equal(validateUpload(pdf, "image/jpeg", "fictional.pdf").ok, false);
  assert.equal(validateUpload(pdf, "application/pdf", "fictional.exe").ok, false);
  assert.equal(validateUpload(new Uint8Array(MAX_UPLOAD_BYTES + 1), "application/pdf", "large.pdf").ok, false);
  assert.equal(validateUpload(new Uint8Array(), "application/pdf", "empty.pdf").ok, false);
});

test("Worker 360 uses the existing guarded upload/download pipeline, not payroll writers", () => {
  const ui = readFileSync("src/components/employee-vault-profile-panel.tsx", "utf8");
  const get = readFileSync("src/app/api/employee-vault/route.ts", "utf8");
  const removal = readFileSync("src/app/api/employee-vault/[id]/route.ts", "utf8");
  const download = readFileSync("src/app/api/documents/[id]/route.ts", "utf8");
  const post = readFileSync("src/app/api/documents/route.ts", "utf8");
  const page = readFileSync("src/app/hcm/worker-360/page.tsx", "utf8");
  for (const marker of ['method: "POST"', 'method: "DELETE"', "?download=1"]) {
    assert.ok(ui.includes(marker), "Expected UI lifecycle: " + marker);
  }
  assert.match(page, /criticalReleaseFlagEnabled\("employeeDocumentVault"\)/);
  assert.match(get, /authorizeEmployeeVault\(user, organizationId, employeeId\)/);
  const sharedAccess = readFileSync("src/lib/employee-vault-profile.ts", "utf8");
  assert.match(sharedAccess, /assertOrganizationRole\(/);
  assert.match(sharedAccess, /PEOPLE_ADMIN_ROLES/);
  assert.match(get, /eq\(documents\.organizationId, organizationId\)/);
  assert.match(get, /eq\(documents\.employeeId, employeeId\)/);
  assert.match(get, /VAULT_REMOVED_SOURCE_PREFIX/);
  assert.match(removal, /enforceSameOriginMutation\(request\)/);
  assert.match(removal, /requireSensitiveActionMfa\(user\)/);
  assert.match(removal, /removeEmployeeVaultDocument/);
  assert.match(download, /vaultRecordRemoved\(document\.sourceKey\)/);
  assert.match(post, /validateUpload\(bytes, file\.type, file\.name\)/);
  assert.match(post, /putDocumentObject\(storageKey, bytes, check\.mime\)/);
  for (const name of ["salary", "payrollRun", "payrollCalculation", "taxCompute", "paymongo"]) {
    assert.ok(!get.includes(name) && !removal.includes(name), "Vault API may not write " + name);
  }
});

test("Synthetic PostgreSQL authorization and removal deny wrong role/tenant and preserve linked evidence", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname === "/app_db",
    "Only disposable localhost app_db is allowed");
  const marker = randomUUID().slice(0, 12);
  const orgs = await db.insert(organizations).values([
    { name: "Vault private A " + marker, legalName: "Vault private A " + marker },
    { name: "Vault private B " + marker, legalName: "Vault private B " + marker },
  ]).returning();
  const people: number[] = [];
  try {
    const staff = await db.insert(employees).values([
      { organizationId: orgs[0].id, employeeNo: "VA" + marker, firstName: "Fictional",
        lastName: "VaultA", title: "Staff", avatarInitials: "VA", basicRate: "14000",
        startDate: "2026-01-01" },
      { organizationId: orgs[0].id, employeeNo: "VC" + marker, firstName: "Fictional",
        lastName: "VaultColleague", title: "Staff", avatarInitials: "VC", basicRate: "14000",
        startDate: "2026-01-01" },
      { organizationId: orgs[1].id, employeeNo: "VB" + marker, firstName: "Fictional",
        lastName: "VaultB", title: "Staff", avatarInitials: "VB", basicRate: "14000",
        startDate: "2026-01-01" },
    ]).returning();
    const actorRows = await db.insert(users).values([
      { name: "Fictional Vault HR", email: "hr-" + marker + "@synthetic.invalid",
        passwordHash: "synthetic-disabled-login", role: "hr" },
      { name: "Fictional Vault Bookkeeper", email: "book-" + marker + "@synthetic.invalid",
        passwordHash: "synthetic-disabled-login", role: "bookkeeper" },
      { name: "Fictional Vault ESS", email: "ess-" + marker + "@synthetic.invalid",
        passwordHash: "synthetic-disabled-login", role: "employee", employeeId: staff[0].id },
    ]).returning();
    people.push(...actorRows.map(row => row.id));
    await db.insert(userOrganizations).values(actorRows.map((actor, index) => ({
      userId: actor.id, organizationId: orgs[0].id,
      role: index === 0 ? "hr" : index === 1 ? "bookkeeper" : "employee",
      active: true,
    })));
    assert.equal((await authorizeEmployeeVault({ id: actorRows[0].id }, orgs[0].id, staff[0].id)).ok, true);
    assert.equal((await authorizeEmployeeVault({ id: actorRows[0].id }, orgs[1].id, staff[2].id)).ok, false,
      "No membership in other employer");
    assert.equal((await authorizeEmployeeVault({ id: actorRows[1].id }, orgs[0].id, staff[0].id)).ok, false,
      "Bookkeeper must be denied");
    assert.equal((await authorizeEmployeeVault({ id: actorRows[2].id, employeeId: staff[0].id },
      orgs[0].id, staff[1].id)).ok, false, "Employee cannot see a colleague's vault");

    const doc = (organizationId: number, employeeId: number, name: string) => ({
      organizationId, employeeId, fileName: name, kind: "contract",
      mimeType: "application/pdf", byteSize: 44, sha256: "a".repeat(64),
      uploadedBy: "Fictional HR", uploadedByUserId: actorRows[0].id,
      content: "", scannedClean: true, sourceType: "upload" as const,
      objectStorageKey: documentObjectKey(organizationId, employeeId),
    });
    const files = await db.insert(documents).values([
      doc(orgs[0].id, staff[0].id, "fictional-contract-a.pdf"),
      doc(orgs[0].id, staff[0].id, "fictional-protected-a.pdf"),
      doc(orgs[1].id, staff[2].id, "fictional-contract-b.pdf"),
    ]).returning();
    assert.equal(await removeEmployeeVaultDocument({
      documentId: files[0].id, organizationId: orgs[1].id, employeeId: staff[0].id,
      actorUserId: actorRows[0].id, actorName: "Synthetic HR",
    }), "not_found", "Cross-tenant document id is never accepted");
    assert.equal(await removeEmployeeVaultDocument({
      documentId: files[0].id, organizationId: orgs[0].id, employeeId: staff[1].id,
      actorUserId: actorRows[0].id, actorName: "Synthetic HR",
    }), "not_found", "Colleague scope is never accepted");

    const [rule] = await db.insert(hcmDocumentRequirements).values({
      organizationId: orgs[0].id, code: "VAULT" + marker,
      name: "Fictional employment contract", kind: "contract",
      createdByName: "Fictional HR",
    }).returning();
    await db.insert(hcmEmployeeDocumentCompliance).values({
      organizationId: orgs[0].id, employeeId: staff[0].id,
      requirementId: rule.id, documentId: files[1].id, status: "submitted",
    });
    assert.equal(await removeEmployeeVaultDocument({
      documentId: files[1].id, organizationId: orgs[0].id, employeeId: staff[0].id,
      actorUserId: actorRows[0].id, actorName: "Synthetic HR",
    }), "linked", "Compliance evidence cannot be deleted");

    assert.equal(await removeEmployeeVaultDocument({
      documentId: files[0].id, organizationId: orgs[0].id, employeeId: staff[0].id,
      actorUserId: actorRows[0].id, actorName: "Synthetic HR",
    }), "removed");
    const [after] = await db.select().from(documents).where(and(
      eq(documents.id, files[0].id), eq(documents.organizationId, orgs[0].id),
    ));
    assert.ok(after.sourceKey?.startsWith(VAULT_REMOVED_SOURCE_PREFIX));
    assert.equal(after.objectStorageKey, files[0].objectStorageKey,
      "Private object is retained for legal holds, not erased");
    assert.equal(await removeEmployeeVaultDocument({
      documentId: files[0].id, organizationId: orgs[0].id, employeeId: staff[0].id,
      actorUserId: actorRows[0].id, actorName: "Synthetic HR",
    }), "not_found");
    const [protectedDoc] = await db.select().from(documents).where(eq(documents.id, files[1].id));
    assert.equal(protectedDoc.sourceKey, null);
  } finally {
    await db.delete(organizations).where(inArray(organizations.id, orgs.map(o => o.id)));
    if (people.length) await db.delete(users).where(inArray(users.id, people));
  }
});
