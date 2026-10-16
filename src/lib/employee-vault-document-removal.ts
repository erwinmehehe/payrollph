import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, documents } from "@/db/schema";
import { documentObjectIdentityMatches } from "@/lib/employee-document-vault";
import { VAULT_REMOVED_SOURCE_PREFIX, vaultRecordRemoved } from "@/lib/employee-vault-profile";

export type VaultRemovalResult = "removed" | "not_found" | "linked" | "protected";

/** Reversible removal, never object erasure. A-5 retention and legal holds
 * must be settled through their separately approved storage workflow. */
export async function removeEmployeeVaultDocument(input: {
  documentId: number; organizationId: number; employeeId: number;
  actorUserId: number; actorName: string;
}): Promise<VaultRemovalResult> {
  if (![input.documentId, input.organizationId, input.employeeId, input.actorUserId]
    .every(id => Number.isSafeInteger(id) && id > 0)) throw new Error("INVALID_VAULT_REMOVAL_IDENTITY");

  return db.transaction(async tx => {
    const [row] = await tx.select({
      id: documents.id, organizationId: documents.organizationId,
      employeeId: documents.employeeId, sourceKey: documents.sourceKey,
      objectStorageKey: documents.objectStorageKey, sourceType: documents.sourceType,
      scannedClean: documents.scannedClean, sha256: documents.sha256,
    }).from(documents).where(and(
      eq(documents.id, input.documentId),
      eq(documents.organizationId, input.organizationId),
      eq(documents.employeeId, input.employeeId),
    )).for("update").limit(1);
    if (!row || vaultRecordRemoved(row.sourceKey)) return "not_found";
    if (!row.scannedClean || row.sourceType !== "upload" || row.sourceKey !== null ||
      !row.objectStorageKey || !documentObjectIdentityMatches(
        row.objectStorageKey, row.organizationId, row.employeeId,
      )) return "protected";

    // Check ALL employers' document-id references; legacy constraints sometimes
    // reference documents.id alone. Never unlink a compliance, case or legal hold.
    const linked = await tx.execute<{ referenced: boolean }>(sql`SELECT (
      EXISTS (SELECT 1 FROM hcm_employee_document_compliance WHERE document_id = ${row.id})
      OR EXISTS (SELECT 1 FROM hcm_document_expiry_notices WHERE document_id = ${row.id})
      OR EXISTS (SELECT 1 FROM hcm_policy_versions WHERE source_document_id = ${row.id})
      OR EXISTS (SELECT 1 FROM employee_hr_cases WHERE coe_document_id = ${row.id})
      OR EXISTS (SELECT 1 FROM hcm_employment_decision_documents WHERE document_id = ${row.id})
    ) AS referenced`);
    if (linked.rows[0]?.referenced !== false) return "linked";
    const [removed] = await tx.update(documents).set({
      sourceKey: VAULT_REMOVED_SOURCE_PREFIX + row.id + ":" + randomUUID(),
    }).where(and(
      eq(documents.id, row.id),
      eq(documents.organizationId, input.organizationId),
      eq(documents.employeeId, input.employeeId),
      eq(documents.sourceType, "upload"),
      eq(documents.scannedClean, true),
      isNull(documents.sourceKey),
    )).returning({ id: documents.id });
    if (!removed) return "protected";
    await tx.insert(auditEvents).values({
      organizationId: input.organizationId, actor: input.actorName,
      action: "Employee document removed from active vault",
      resource: String(row.id),
      metadata: { documentId: row.id, employeeId: input.employeeId,
        actorUserId: input.actorUserId, sha256: row.sha256,
        privateObjectRetained: true, erasureApproved: false },
    });
    return "removed";
  });
}
