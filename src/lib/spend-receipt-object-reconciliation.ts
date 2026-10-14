import { and, eq, isNotNull, like, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, documents, expenseClaimEvidence } from "@/db/schema";
import { deleteDocumentObject } from "@/lib/document-object-storage";
import { receiptObjectIdentityMatches } from "@/lib/spend-payroll-reimbursement";

/**
 * A4 reimbursement receipt uploads must be tracked before external S3 PUT.
 * Postgres and object storage are not atomic. A pending scannedClean=false
 * document is an unreadable, durable cleanup intent, NEVER a paid receipt.
 */
export const SPEND_PENDING_RECEIPT_PREFIX = "spend-receipt-pending:";
export const SPEND_PENDING_RECEIPT_GRACE_MS = 60 * 60 * 1000;
type DeleteObject = typeof deleteDocumentObject;
export type SpendReceiptCleanupState =
  "deleted" | "missing" | "referenced" | "too_recent" | "invalid_identity" | "delete_failed";

/** Idempotent private-object cleanup under a row lock. An approved claim's
 * object is never eligible for deletion, even if an old intent still exists.
 * A provider timeout or failed DELETE leaves the durable row for retry.
 */
export async function reconcilePendingSpendReceipt(documentId: number,
  options: { deleteObject?: DeleteObject; now?: Date; minAgeMs?: number } = {},
): Promise<SpendReceiptCleanupState> {
  const now = options.now ?? new Date();
  const minAgeMs = options.minAgeMs ?? 0;
  if (!Number.isSafeInteger(documentId) || documentId < 1 ||
      !Number.isFinite(now.getTime()) || !Number.isSafeInteger(minAgeMs) || minAgeMs < 0) {
    throw new Error("INVALID_PENDING_SPEND_RECEIPT");
  }
  const deleteObject = options.deleteObject ?? deleteDocumentObject;
  return db.transaction(async tx => {
    const [row] = await tx.select().from(documents)
      .where(eq(documents.id, documentId)).for("update").limit(1);
    if (!row) return "missing";
    if (row.scannedClean || row.sourceType !== "upload" ||
        !row.sourceKey?.startsWith(SPEND_PENDING_RECEIPT_PREFIX)) return "referenced";
    if (now.getTime() - row.createdAt.getTime() < minAgeMs) return "too_recent";
    if (!row.objectStorageKey || row.employeeId === null ||
        !receiptObjectIdentityMatches(row.objectStorageKey, row.organizationId, row.employeeId)) {
      return "invalid_identity";
    }
    const [attached] = await tx.select({ claimId: expenseClaimEvidence.claimId })
      .from(expenseClaimEvidence).where(and(
        eq(expenseClaimEvidence.organizationId, row.organizationId),
        eq(expenseClaimEvidence.employeeId, row.employeeId),
        eq(expenseClaimEvidence.receiptStorageKey, row.objectStorageKey),
      )).limit(1);
    if (attached) return "referenced";
    try {
      await deleteObject(row.objectStorageKey);
    } catch {
      return "delete_failed";
    }
    const removed = await tx.delete(documents).where(and(
      eq(documents.id, row.id), eq(documents.organizationId, row.organizationId),
      eq(documents.scannedClean, false),
      eq(documents.sourceKey, row.sourceKey),
    )).returning({ id: documents.id });
    if (removed.length !== 1) throw new Error("SPEND_PENDING_INTENT_CHANGED");
    await tx.insert(auditEvents).values({
      organizationId: row.organizationId,
      actor: "System Spend receipt recovery",
      action: "Uncommitted reimbursement receipt reconciled",
      resource: String(row.id),
      metadata: { documentId: row.id, employeeId: row.employeeId,
        sha256: row.sha256, deleteConfirmed: true },
    });
    return "deleted";
  });
}

/** Operates from the leased retention job, including when Spend is OFF.
 * A pre-migration database with no new evidence table must be skipped.
 */
export async function sweepPendingSpendReceipts(now = new Date(), limit = 50,
  deleteObject: DeleteObject = deleteDocumentObject) {
  if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("INVALID_SPEND_RECEIPT_SWEEP");
  }
  const schema = await db.execute<{ schema_ready: boolean }>(sql`
    SELECT to_regclass('expense_claim_evidence') IS NOT NULL AND
      EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'documents'
        AND column_name = 'object_storage_key') AS schema_ready
  `);
  if (schema.rows[0]?.schema_ready !== true) {
    return { enabled: false as const, inspected: 0, deleted: 0, retryRequired: 0 };
  }
  const old = await db.select({ id: documents.id }).from(documents).where(and(
    eq(documents.scannedClean, false), eq(documents.sourceType, "upload"),
    isNotNull(documents.objectStorageKey),
    like(documents.sourceKey, SPEND_PENDING_RECEIPT_PREFIX + "%"),
    lte(documents.createdAt, new Date(now.getTime() - SPEND_PENDING_RECEIPT_GRACE_MS)),
  )).orderBy(documents.id).limit(limit);
  let deleted = 0, retryRequired = 0;
  for (const row of old) {
    const state = await reconcilePendingSpendReceipt(row.id, {
      deleteObject, now, minAgeMs: SPEND_PENDING_RECEIPT_GRACE_MS,
    });
    if (state === "deleted") deleted++;
    if (state === "delete_failed" || state === "invalid_identity") retryRequired++;
  }
  return { enabled: true as const, inspected: old.length, deleted, retryRequired };
}
