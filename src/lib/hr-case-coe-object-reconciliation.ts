import { and, eq, like, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, documents, employeeHrCases } from "@/db/schema";
import { deleteDocumentObject } from "@/lib/document-object-storage";
import { documentObjectIdentityMatches } from "@/lib/employee-document-vault";

/**
 * Durable COE issuance order: commit unreadable intent before any remote PUT,
 * upload externally, then commit the signed HR decision. Recover on both
 * ambiguous provider failures and database failures. A failed recovery must
 * never hide the primary failure; the persisted intent is retried by scheduler.
 */
export async function issueCoeObjectWithRecovery<T>(steps: {
  stage: () => Promise<number>;
  upload: () => Promise<void>;
  finalize: (pendingDocumentId: number) => Promise<T>;
  recover: (pendingDocumentId: number, phase: "upload_ambiguous" | "finalize_failed") => Promise<unknown>;
}): Promise<T> {
  const pendingDocumentId = await steps.stage();
  if (!Number.isSafeInteger(pendingDocumentId) || pendingDocumentId <= 0) {
    throw new Error("COE_PENDING_INTENT_NOT_DURABLE");
  }
  let remoteUploadConfirmed = false;
  try {
    await steps.upload();
    remoteUploadConfirmed = true;
    return await steps.finalize(pendingDocumentId);
  } catch (error) {
    // A provider timeout is ambiguous: DELETE could run before a delayed
    // remote PUT completes and recreate an untracked orphan. Retain the
    // durable row until the leased sweeper's grace window in that case.
    await steps.recover(pendingDocumentId,
      remoteUploadConfirmed ? "finalize_failed" : "upload_ambiguous").catch(() => {});
    throw error;
  }
}

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

/**
 * Orphan cleanup must survive disabling a feature flag after a partial rollout,
 * otherwise private files are stranded indefinitely. Check schema existence
 * first; old deployments lacking the additive HR/vault migrations are skipped.
 * The lease of the parent retention scheduler prevents overlapping job ticks.
 */
export async function sweepPendingCoeObjects(now = new Date(), limit = 50,
  deleteObject: DeleteObject = deleteDocumentObject) {
  if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("INVALID_COE_SWEEP_INPUT");
  }
  const readiness = await db.execute<{ schema_ready: boolean }>(sql`
    SELECT to_regclass('public.employee_hr_cases') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'documents'
          AND column_name = 'object_storage_key'
      ) AS schema_ready
  `);
  if (readiness.rows[0]?.schema_ready !== true) {
    return { enabled: false as const, inspected: 0, deleted: 0, retryRequired: 0 };
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
