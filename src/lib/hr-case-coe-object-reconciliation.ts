import { and, eq, isNull, like, lte } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, documents, employeeHrCases } from "@/db/schema";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { deleteDocumentObject } from "@/lib/document-object-storage";
import { documentObjectIdentityMatches } from "@/lib/employee-document-vault";

export const COE_PENDING_SOURCE_PREFIX = "hr-case-coe-pending:";
export const COE_ORPHAN_GRACE_MS = 60 * 60 * 1000;

type DeleteObject = typeof deleteDocumentObject;
export type CoeCleanupResult = "deleted" | "missing" | "referenced" | "invalid_identity" | "delete_failed";

/**
 * Every COE upload is preceded by a committed, unreadable documents row with
 * scannedClean=false, a unique pending sourceKey, and the private object key.
 * That existing document row is the durable recovery ledger: a crash after PUT
 * cannot lose the key. Successful COE issue atomically promotes the row.
 *
 * A DELETE is attempted only after locking that row and proving that it has
 * not become a valid signed-off COE. A failed external DELETE retains the
 * pending row for the next leased scheduler retry.
 */
export async function reconcilePendingCoeDocument(
  documentId: number,
  options: { deleteObject?: DeleteObject; now?: Date; minAgeMs?: number } = {},
): Promise<CoeCleanupResult> {
  if (!Number.isSafeInteger(documentId) || documentId <= 0) throw new Error("INVALID_COE_DOCUMENT_ID");
  const deleteObject = options.deleteObject ?? deleteDocumentObject;
  const now = options.now ?? new Date();
  const minAgeMs = options.minAgeMs ?? 0;
  if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(minAgeMs) || minAgeMs < 0) {
    throw new Error("INVALID_COE_RECONCILIATION_TIME");
  }
  return db.transaction(async tx => {
    const [doc] = await tx.select().from(documents)
      .where(eq(documents.id, documentId)).for("update").limit(1);
    if (!doc) return "missing";
    if (doc.scannedClean || doc.sourceType !== "generated" ||
        !doc.sourceKey?.startsWith(COE_PENDING_SOURCE_PREFIX)) return "referenced";
    if (now.getTime() - doc.createdAt.getTime() < minAgeMs) return "referenced";
    const [caseReference] = await tx.select({ id: employeeHrCases.id }).from(employeeHrCases)
      .where(and(
        eq(employeeHrCases.organizationId, doc.organizationId),
        eq(employeeHrCases.coeDocumentId, doc.id),
      )).limit(1);
    if (caseReference) return "referenced";
    if (!doc.objectStorageKey ||
        !documentObjectIdentityMatches(doc.objectStorageKey, doc.organizationId, doc.employeeId)) {
      return "invalid_identity";
    }
    try {
      await deleteObject(doc.objectStorageKey);
    } catch {
      // Leave a durable pending row; a scheduled retry may resolve even an
      // ambiguous provider timeout that happened after the object was written.
      return "delete_failed";
    }
    await tx.delete(documents).where(and(
      eq(documents.id, doc.id), eq(documents.organizationId, doc.organizationId),
      eq(documents.scannedClean, false),
    ));
    await tx.insert(auditEvents).values({
      organizationId: doc.organizationId,
      actor: "System COE recovery",
      action: "Pending private COE object reconciled",
      resource: String(doc.id),
      metadata: { documentId: doc.id, employeeId: doc.employeeId, orphanRecovered: true },
    });
    return "deleted";
  });
}

/** Runs only behind both HR case and private-vault flags via the leased scheduler. */
export async function sweepPendingCoeObjects(now = new Date(), limit = 50,
  deleteObject: DeleteObject = deleteDocumentObject) {
  if (!criticalReleaseFlagEnabled("employeeHrCases") ||
      !criticalReleaseFlagEnabled("employeeDocumentVault")) {
    return { enabled: false as const, inspected: 0, deleted: 0, retryRequired: 0 };
  }
  if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("INVALID_COE_SWEEP_INPUT");
  }
  const stale = await db.select({ id: documents.id }).from(documents).where(and(
    eq(documents.scannedClean, false), eq(documents.sourceType, "generated"),
    like(documents.sourceKey, COE_PENDING_SOURCE_PREFIX + "%"),
    lte(documents.createdAt, new Date(now.getTime() - COE_ORPHAN_GRACE_MS)),
  )).orderBy(documents.id).limit(limit);
  let deleted = 0;
  let retryRequired = 0;
  for (const doc of stale) {
    const outcome = await reconcilePendingCoeDocument(doc.id, {
      deleteObject, now, minAgeMs: COE_ORPHAN_GRACE_MS,
    });
    if (outcome === "deleted") deleted++;
    if (outcome === "delete_failed" || outcome === "invalid_identity") retryRequired++;
  }
  return { enabled: true as const, inspected: stale.length, deleted, retryRequired };
}
