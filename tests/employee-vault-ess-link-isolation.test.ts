import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  documents, employees, hcmDocumentRequirements, hcmEmployeeDocumentCompliance,
  organizations,
} from "../src/db/schema";
import { employeeDocumentMetadataJoin } from "../src/lib/document-schema-compat";
import { VAULT_PENDING_SOURCE_PREFIX } from "../src/lib/employee-vault-object-reconciliation";

test("ESS metadata joins reject foreign tenants, different employees and pending vault intents", async () => {
  const token = randomUUID().slice(0, 12);
  const [ownOrg, foreignOrg] = await db.insert(organizations).values([
    { name: "ESS vault owned " + token, legalName: "ESS vault owned " + token },
    { name: "ESS vault foreign " + token, legalName: "ESS vault foreign " + token },
  ]).returning();
  try {
    const [ownEmployee, colleague, foreignEmployee] = await db.insert(employees).values([
      { organizationId: ownOrg.id, employeeNo: "ESSA" + token,
        firstName: "Synthetic", lastName: "One", title: "Analyst",
        avatarInitials: "SO", basicRate: "20000.00", startDate: "2026-01-01" },
      { organizationId: ownOrg.id, employeeNo: "ESSC" + token,
        firstName: "Synthetic", lastName: "Two", title: "Analyst",
        avatarInitials: "ST", basicRate: "20000.00", startDate: "2026-01-01" },
      { organizationId: foreignOrg.id, employeeNo: "ESSF" + token,
        firstName: "Synthetic", lastName: "Foreign", title: "Analyst",
        avatarInitials: "SF", basicRate: "20000.00", startDate: "2026-01-01" },
    ]).returning();
    const required = await db.insert(hcmDocumentRequirements).values(
      ["own", "colleague", "foreign", "pending"].map(code => ({
        organizationId: ownOrg.id, code: code + token,
        name: "Fictional " + code, kind: "contract",
        createdByName: "Synthetic QA",
      })),
    ).returning();
    const makeFile = (organizationId: number, employeeId: number,
      fileName: string, sourceKey: string | null = null, scannedClean = true) => ({
      organizationId, employeeId, fileName,
      kind: "contract", mimeType: "application/pdf",
      byteSize: 12, sha256: "a".repeat(64), uploadedBy: "Synthetic QA",
      content: "", scannedClean, sourceKey,
    });
    const [allowed, colleagueFile, foreignFile, pending] = await db.insert(documents).values([
      makeFile(ownOrg.id, ownEmployee.id, "allowed-own.pdf"),
      makeFile(ownOrg.id, colleague.id, "PRIVATE-COLLEAGUE.pdf"),
      makeFile(foreignOrg.id, foreignEmployee.id, "PRIVATE-FOREIGN.pdf"),
      makeFile(ownOrg.id, ownEmployee.id, "PRIVATE-PENDING.pdf",
        VAULT_PENDING_SOURCE_PREFIX + randomUUID(), false),
    ]).returning();
    const mismatches = [
      { requirementId: required[0].id, documentId: allowed.id, expected: allowed.id },
      { requirementId: required[1].id, documentId: colleagueFile.id, expected: null },
      { requirementId: required[2].id, documentId: foreignFile.id, expected: null },
      { requirementId: required[3].id, documentId: pending.id, expected: null },
    ];
    // These mismatched links are deliberately permitted by the historical
    // document_id-only FK. The route JOIN is the last privacy boundary.
    await db.insert(hcmEmployeeDocumentCompliance).values(mismatches.map(item => ({
      organizationId: ownOrg.id, employeeId: ownEmployee.id,
      requirementId: item.requirementId, documentId: item.documentId,
      status: "submitted",
    })));
    const rows = await db.select({
      requirementId: hcmEmployeeDocumentCompliance.requirementId,
      documentId: documents.id,
      fileName: documents.fileName,
    }).from(hcmEmployeeDocumentCompliance)
      .leftJoin(documents, employeeDocumentMetadataJoin)
      .where(and(
        eq(hcmEmployeeDocumentCompliance.organizationId, ownOrg.id),
        eq(hcmEmployeeDocumentCompliance.employeeId, ownEmployee.id),
      ));
    assert.equal(rows.length, 4);
    const found = new Map(rows.map(row => [row.requirementId, row]));
    for (const item of mismatches) {
      const row = found.get(item.requirementId);
      assert.ok(row, "Each compliance requirement remains visible");
      assert.equal(row.documentId, item.expected,
        "Only the exact tenant-and-employee document can disclose metadata");
    }
    const returned = JSON.stringify(rows);
    for (const secret of ["PRIVATE-COLLEAGUE", "PRIVATE-FOREIGN", "PRIVATE-PENDING"]) {
      assert.ok(!returned.includes(secret), "No unscoped/pending metadata: " + secret);
    }
  } finally {
    await db.delete(organizations).where(eq(organizations.id, ownOrg.id));
    await db.delete(organizations).where(eq(organizations.id, foreignOrg.id));
  }
});

test("ESS route uses shared document tenant/employee join, not document id alone", () => {
  const route = readFileSync("src/app/api/self/documents/route.ts", "utf8");
  const predicate = readFileSync("src/lib/document-schema-compat.ts", "utf8");
  assert.match(route, /\.leftJoin\(documents, employeeDocumentMetadataJoin\)/);
  assert.doesNotMatch(route, /\.leftJoin\(documents, eq\(hcmEmployeeDocumentCompliance\.documentId, documents\.id\)\)/);
  assert.match(predicate, /eq\(documents\.organizationId, hcmEmployeeDocumentCompliance\.organizationId\)/);
  assert.match(predicate, /eq\(documents\.employeeId, hcmEmployeeDocumentCompliance\.employeeId\)/);
  assert.match(predicate, /notLike\(documents\.sourceKey, VAULT_PENDING_SOURCE_PREFIX/);
});
