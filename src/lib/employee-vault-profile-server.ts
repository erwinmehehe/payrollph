import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, documents } from "@/db/schema";
import {
  canAccessEmployeeProfileVault, canArchiveEmployeeVaultUpload,
  documentObjectIdentityMatches, vaultDocumentIsArchived,
  type EmployeeVaultActor,
} from "@/lib/employee-document-vault";

export type VaultRemovalResult =
  | { ok: true; id: number }
  | { ok: false; code: "NOT_FOUND" | "FORBIDDEN" | "LINKED" | "NOT_REMOVABLE" };

/**
 * A-5 retention-safe removal. Never DELETE the DB row or S3 object here:
 * HR/COE evidence, signed document links, backups and legal hold must not
 * be irreversibly destroyed by an ordinary employee UI interaction.
 *
 * The authorized API must validate tenant membership/session policy before
 * calling this function. This function independently rechecks resource owner,
 * role and immutable uploader while holding a row lock.
 */
export async function archiveEmployeeVaultUpload(input: {
  organizationId: number;
  documentId: number;
  actor: EmployeeVaultActor & { name: string };
  now?: Date;
}): Promise<VaultRemovalResult> {
  const { organizationId, documentId, actor } = input;
  if (![organizationId, documentId, actor.userId].every(v =>
    Number.isSafeInteger(v) && v > 0,
  )) return { ok: false, code: "NOT_FOUND" };
  const at = input.now ?? new Date();
  if (!Number.isFinite(at.getTime())) return { ok: false, code: "NOT_REMOVABLE" };

  return db.transaction(async tx => {
    const [row] = await tx.select({
      id: documents.id,
      organizationId: documents.organizationId,
      employeeId: documents.employeeId,
      sourceType: documents.sourceType,
      objectStorageKey: documents.objectStorageKey,
      uploadedByUserId: documents.uploadedByUserId,
      generationMetadata: documents.generationMetadata,
      sha256: documents.sha256,
    }).from(documents).where(and(
      eq(documents.id, documentId),
      eq(documents.organizationId, organizationId),
    )).for("update").limit(1);

    if (!row || vaultDocumentIsArchived(row.generationMetadata)) {
      return { ok: false, code: "NOT_FOUND" } as const;
    }
    if (row.employeeId === null ||
      !canAccessEmployeeProfileVault(actor, row.employeeId) ||
      (actor.role === "employee" && row.uploadedByUserId !== actor.userId)) {
      return { ok: false, code: "FORBIDDEN" } as const;
    }
    if (!canArchiveEmployeeVaultUpload(actor, row) ||
      !row.objectStorageKey ||
      !documentObjectIdentityMatches(row.objectStorageKey,
        row.organizationId, row.employeeId)) {
      return { ok: false, code: "NOT_REMOVABLE" } as const;
    }

    // Historical references can be ID-only, including a different tenant.
    // Check ALL referring tables rather than filtering by organization.
    // Incomplete/unmigrated schema fails closed; no pretend unlinking.
    const refs = await tx.execute<{ referenced: boolean }>(sql`
      SELECT (
        EXISTS (SELECT 1 FROM hcm_employee_document_compliance
          WHERE document_id = ${row.id})
        OR EXISTS (SELECT 1 FROM hcm_document_expiry_notices
          WHERE document_id = ${row.id})
        OR EXISTS (SELECT 1 FROM hcm_policy_versions
          WHERE source_document_id = ${row.id})
        OR EXISTS (SELECT 1 FROM employee_hr_cases
          WHERE coe_document_id = ${row.id})
        OR EXISTS (SELECT 1 FROM hcm_employment_decision_documents
          WHERE document_id = ${row.id})
      ) AS referenced
    `);
    if (refs.rows[0]?.referenced !== false) {
      return { ok: false, code: "LINKED" } as const;
    }

    const previous = row.generationMetadata;
    const safe = previous && typeof previous === "object" && !Array.isArray(previous)
      ? previous as Record<string, unknown> : {};
    const [updated] = await tx.update(documents).set({
      generationMetadata: {
        ...safe,
        vaultRemovedAt: at.toISOString(),
        vaultRemovedByUserId: actor.userId,
      },
    }).where(and(eq(documents.id, row.id),
      eq(documents.organizationId, organizationId))).returning({ id: documents.id });
    if (!updated) throw new Error("VAULT_REMOVAL_ROW_CHANGED");
    await tx.insert(auditEvents).values({
      organizationId,
      actor: actor.name,
      action: "Employee document removed from active private vault",
      resource: String(row.id),
      metadata: {
        documentId: row.id,
        employeeId: row.employeeId,
        actorUserId: actor.userId,
        sha256: row.sha256,
        objectRetained: true,
        physicalDeletion: false,
      },
    });
    return { ok: true, id: updated.id } as const;
  });
}
