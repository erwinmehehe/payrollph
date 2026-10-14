import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { and, eq, isNull, notLike, or } from "drizzle-orm";
import { db } from "../src/db";
import {
  documents, employees, organizations,
} from "../src/db/schema";
import {
  canMutateLegacyHcmDocument, legacyDocumentInsertTable,
  legacyVisibleDocumentWhere,
} from "../src/lib/document-schema-compat";
import { documentObjectKey } from "../src/lib/document-object-storage";
import { VAULT_PENDING_SOURCE_PREFIX } from "../src/lib/employee-vault-object-reconciliation";

test("flag-OFF HCM review permits only legacy files of the same employer and employee", async () => {
  const suffix = randomUUID().slice(0, 12);
  const [org, otherOrg] = await db.insert(organizations).values([
    { name: "A5 Legacy Rollback " + suffix, legalName: "A5 Legacy Rollback " + suffix },
    { name: "A5 Other Rollback " + suffix, legalName: "A5 Other Rollback " + suffix },
  ]).returning();
  try {
    const [staff, otherStaff] = await db.insert(employees).values([
      { organizationId: org.id, employeeNo: "A5-LEGACY-" + suffix,
        firstName: "Synthetic", lastName: "Legacy", title: "Associate",
        avatarInitials: "SL", basicRate: "23000.00", startDate: "2026-01-01" },
      { organizationId: org.id, employeeNo: "A5-OTHER-" + suffix,
        firstName: "Synthetic", lastName: "Other", title: "Associate",
        avatarInitials: "SO", basicRate: "23000.00", startDate: "2026-01-01" },
    ]).returning();
    const [legacy] = await db.insert(legacyDocumentInsertTable).values({
      organizationId: org.id, employeeId: staff.id, kind: "contract",
      fileName: "fictional-legacy.pdf", mimeType: "application/pdf",
      byteSize: 8, sha256: "a".repeat(64), scannedClean: true,
      uploadedBy: "Synthetic HR", content: "JVBERi0x",
    }).returning({ id: legacyDocumentInsertTable.id });
    const [privateFile] = await db.insert(documents).values({
      organizationId: org.id, employeeId: staff.id, kind: "medical_certificate",
      fileName: "fictional-private.pdf", mimeType: "application/pdf",
      byteSize: 8, sha256: "b".repeat(64), scannedClean: true,
      uploadedBy: "Synthetic HR", content: "",
      objectStorageKey: documentObjectKey(org.id, staff.id),
    }).returning({ id: documents.id });
    const [pending] = await db.insert(documents).values({
      organizationId: org.id, employeeId: staff.id, kind: "medical_certificate",
      fileName: "fictional-pending.pdf", mimeType: "application/pdf",
      byteSize: 8, sha256: "c".repeat(64), scannedClean: false,
      uploadedBy: "Synthetic HR", content: "",
      sourceKey: VAULT_PENDING_SOURCE_PREFIX + randomUUID(),
      objectStorageKey: documentObjectKey(org.id, staff.id),
    }).returning({ id: documents.id });

    assert.equal(await canMutateLegacyHcmDocument({
      organizationId: org.id, employeeId: staff.id, documentId: legacy.id,
    }), true);
    for (const docId of [privateFile.id, pending.id]) {
      assert.equal(await canMutateLegacyHcmDocument({
        organizationId: org.id, employeeId: staff.id, documentId: docId,
      }), false, "private or pending bytes cannot bypass independent HR checker after rollback");
    }
    assert.equal(await canMutateLegacyHcmDocument({
      organizationId: otherOrg.id, employeeId: staff.id, documentId: legacy.id,
    }), false);
    assert.equal(await canMutateLegacyHcmDocument({
      organizationId: org.id, employeeId: otherStaff.id, documentId: legacy.id,
    }), false);
    assert.equal(await canMutateLegacyHcmDocument({
      organizationId: org.id, employeeId: staff.id, documentId: 0,
    }), false);

    // Same filter applied by the HCM GET route to bookkeeper/legacy People roles.
    // Both object-backed files must disappear from that metadata result.
    const legacyOnly = await db.select({ id: documents.id }).from(documents).where(and(
      eq(documents.organizationId, org.id), legacyVisibleDocumentWhere,
      or(isNull(documents.sourceKey), notLike(documents.sourceKey, VAULT_PENDING_SOURCE_PREFIX + "%")),
    ));
    assert.deepEqual(legacyOnly.map(row => row.id), [legacy.id]);
    // HR may see completed private metadata but never pending upload intents.
    const hrOnly = await db.select({ id: documents.id }).from(documents).where(and(
      eq(documents.organizationId, org.id),
      or(isNull(documents.sourceKey), notLike(documents.sourceKey, VAULT_PENDING_SOURCE_PREFIX + "%")),
    ));
    assert.ok(hrOnly.some(row => row.id === privateFile.id));
    assert.ok(!hrOnly.some(row => row.id === pending.id));
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
    await db.delete(organizations).where(eq(organizations.id, otherOrg.id));
  }
});

test("HCM list and both legacy review mutations retain private-vault rollback guards", () => {
  const route = readFileSync("src/app/api/hcm/documents/route.ts", "utf8");
  assert.match(route, /legacyVisibleDocumentWhere/);
  assert.match(route, /notLike\(documents\.sourceKey, VAULT_PENDING_SOURCE_PREFIX/);
  assert.match(route, /visibleDocumentIds\.has\(row\.documentId\)/);
  const verify = route.slice(route.indexOf('if (action === "verify-document")'),
    route.indexOf('if (action === "waive-policy-assignment")'));
  const waive = route.slice(route.indexOf('if (action === "waive-document-requirement")'));
  assert.match(verify, /!vaultEnabled && !await canMutateLegacyHcmDocument/);
  assert.match(waive, /!vaultEnabled && row\.documentId !== null && !await canMutateLegacyHcmDocument/);
  assert.match(verify, /if \(vaultEnabled\)[\s\S]*?verifyEmployeeVaultDocument/);
});
