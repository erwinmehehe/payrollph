import { and, eq, isNotNull, like, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, documents, hcmEmployeeDocumentCompliance } from "@/db/schema";
import { deleteDocumentObject } from "@/lib/document-object-storage";
import { documentObjectIdentityMatches } from "@/lib/employee-document-vault";

/**
 * A private upload is first committed as unreadable metadata. The object store
 * PUT and PostgreSQL cannot commit atomically, so a durable, unapproved row
 * must survive any timeout, failed readback, failed audit, or aborted commit.
 * The short unique source key is not a signed URL and never reaches clients.
 */
export const VAULT_PENDING_SOURCE_PREFIX = "vault-upload-pending:";
export const VAULT_ORPHAN_GRACE_MS = 60 * 60 * 1000;
type DeleteObject = typeof deleteDocumentObject;
export type VaultCleanupResult =
  "deleted" | "missing" | "referenced" | "too_recent" | "invalid_identity" | "delete_failed";

/**
 * Lock the pending row before considering external DELETE. If a concurrent
 * approval promoted it to a scanned record, no deletion is permitted.
 * Provider DELETE failures leave the durable intent intact for a later retry.
 * The caller must not substitute a client-provided key or row identity.
 */
export async function reconcilePendingVaultUpload(
  documentId: number,
  options: { deleteObject?: DeleteObject; now?: Date; minAgeMs?: number } = {},
): Promise<VaultCleanupResult> {
  if (!Number.isSafeInteger(documentId) || documentId <= 0) {
    throw new Error("INVALID_PENDING_VAULT_DOCUMENT");
  }
  const now = options.now ?? new Date();
  const minAgeMs = options.minAgeMs ?? 0;
  if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(minAgeMs) || minAgeMs < 0) {
    throw new Error("INVALID_PENDING_VAULT_TIME");
  }
  const deleteObject = options.deleteObject ?? deleteDocumentObject;
  return db.transaction(async tx => {
    const [row] = await tx.select().from(documents)
      .where(eq(documents.id, documentId)).for("update").limit(1);
    if (!row) return "missing";
    if (row.scannedClean || row.sourceType !== "upload" ||
        !row.sourceKey?.startsWith(VAULT_PENDING_SOURCE_PREFIX)) return "referenced";
    if (now.getTime() - row.createdAt.getTime() < minAgeMs) return "too_recent";

    // A pending object may never be deleted if any compliance row already
    // references it; investigate that cross-state inconsistency separately.
    const [compliance] = await tx.select({ id: hcmEmployeeDocumentCompliance.id })
      .from(hcmEmployeeDocumentCompliance).where(and(
        eq(hcmEmployeeDocumentCompliance.organizationId, row.organizationId),
        eq(hcmEmployeeDocumentCompliance.documentId, row.id),
      )).limit(1);
    if (compliance) return "referenced";
    if (!row.objectStorageKey || !documentObjectIdentityMatches(
      row.objectStorageKey, row.organizationId, row.employeeId,
    )) return "invalid_identity";
    try {
      await deleteObject(row.objectStorageKey);
    } catch {
      return "delete_failed";
    }
    const removed = await tx.delete(documents).where(and(
      eq(documents.id, row.id), eq(documents.organizationId, row.organizationId),
      eq(documents.scannedClean, false), eq(documents.sourceKey, row.sourceKey),
    )).returning({ id: documents.id });
    if (removed.length !== 1) throw new Error("VAULT_PENDING_ROW_CHANGED");
    await tx.insert(auditEvents).values({
      organizationId: row.organizationId,
      actor: "System private vault recovery",
      action: "Uncommitted private vault object reconciled",
      resource: String(row.id),
      metadata: { documentId: row.id, employeeId: row.employeeId,
        sha256: row.sha256, deleteConfirmed: true },
    });
    return "deleted";
  });
}

/**
 * Called by the retained operational cleanup scheduler independently of the
 * rollout flag. Missing pre-A5 columns/table must return disabled, not break
 * an older deployment with feature flags still OFF. The parent scheduler's
 * lease serializes ticks; row locks protect concurrent upload finalization.
 */
export async function sweepPendingVaultUploads(
  now = new Date(),
  limit = 50,
  deleteObject: DeleteObject = deleteDocumentObject,
) {
  if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("INVALID_PENDING_VAULT_SWEEP");
  }
  const result = await db.execute<{ schema_ready: boolean }>(sql`
    SELECT to_regclass('public.hcm_employee_document_compliance') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'documents'
          AND column_name = 'object_storage_key'
      ) AS schema_ready
  `);
  if (result.rows[0]?.schema_ready !== true) {
    return { enabled: false as const, inspected: 0, deleted: 0, retryRequired: 0 };
  }

  const rows = await db.select({ id: documents.id }).from(documents).where(and(
    eq(documents.scannedClean, false),
    eq(documents.sourceType, "upload"),
    isNotNull(documents.objectStorageKey),
    like(documents.sourceKey, VAULT_PENDING_SOURCE_PREFIX + "%"),
    lte(documents.createdAt, new Date(now.getTime() - VAULT_ORPHAN_GRACE_MS)),
  )).orderBy(documents.id).limit(limit);

  let deleted = 0;
  let retryRequired = 0;
  for (const row of rows) {
    const state = await reconcilePendingVaultUpload(row.id, {
      deleteObject, now, minAgeMs: VAULT_ORPHAN_GRACE_MS,
    });
    if (state === "deleted") deleted++;
    if (state === "delete_failed" || state === "invalid_identity") retryRequired++;
  }
  return { enabled: true as const, inspected: rows.length, deleted, retryRequired };
}
