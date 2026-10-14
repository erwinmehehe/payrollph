import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, documents, employees, expenseClaimEvidence, expenseClaims } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertMembership, assertOrganizationRole, assertScope, getAccess, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { loadSpendClaimEvidence, spendPayrollEnabled } from "@/lib/spend-claim-evidence";
import {
  documentObjectKey, putDocumentObject,
} from "@/lib/document-object-storage";
import { documentUploadsEnabled, MAX_UPLOAD_BYTES, safeFileName, scanUpload, validateUpload } from "@/lib/storage";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa } from "@/lib/security-request";
import { recordAuditEvent } from "@/lib/audit";
import { claimCanAttachReceipt, receiptObjectIdentityMatches } from "@/lib/spend-payroll-reimbursement";
import { readVerifiedSpendReceipt } from "@/lib/spend-receipt-storage";
import { SPEND_PENDING_RECEIPT_PREFIX, reconcilePendingSpendReceipt } from "@/lib/spend-receipt-object-reconciliation";

export const dynamic = "force-dynamic";
const enabled = () => spendPayrollEnabled() &&
  criticalReleaseFlagEnabled("employeeDocumentVault") && documentUploadsEnabled();
const unavailable = () => Response.json({ error: "Private reimbursement receipts are not enabled." }, { status: 404 });
const validId = (v: number) => Number.isSafeInteger(v) && v > 0;

async function authorize(user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>,
  claim: typeof expenseClaims.$inferSelect): Promise<Response | null> {
  if (user.role === "employee") {
    if (!user.employeeId || user.employeeId !== claim.employeeId) {
      return Response.json({ error: "Receipt not found." }, { status: 404 });
    }
    const denied = await assertMembership(user.id, claim.organizationId);
    return denied ? Response.json({ error: "Receipt not found." }, { status: 404 }) : null;
  }
  const denied = await assertOrganizationRole(user.id, claim.organizationId, PEOPLE_PAYROLL_ROLES);
  if (denied) return denied;
  const access = await getAccess(user.id, claim.organizationId);
  const [employee] = await db.select({ orgUnitId: employees.orgUnitId }).from(employees).where(and(
    eq(employees.id, claim.employeeId), eq(employees.organizationId, claim.organizationId),
  )).limit(1);
  if (!employee) return Response.json({ error: "Receipt not found." }, { status: 404 });
  const scope = assertScope(access, employee.orgUnitId);
  return scope.ok ? null : Response.json({ error: "Receipt not found." }, { status: 404 });
}

export async function GET(request: Request) {
  if (!enabled()) return unavailable();
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const id = Number(new URL(request.url).searchParams.get("claimId"));
  if (!validId(id)) return Response.json({ error: "Valid claimId required." }, { status: 422 });
  const [core] = await db.select().from(expenseClaims).where(eq(expenseClaims.id, id)).limit(1);
  if (!core) return Response.json({ error: "Receipt not found." }, { status: 404 });
  const denied = await authorize(user, core);
  if (denied) return denied;
  const mfa = requireSensitiveActionMfa(user);
  if (mfa) return mfa;
  const [claim] = await loadSpendClaimEvidence(db, [core]);
  if (!claim.receiptStorageKey || !claim.receiptSha256) {
    return Response.json({ error: "No scanned receipt exists for this claim." }, { status: 404 });
  }
  if (!receiptObjectIdentityMatches(claim.receiptStorageKey,
      claim.organizationId, claim.employeeId)) {
    return Response.json({ error: "Private receipt storage identity mismatch." }, { status: 409 });
  }
  let bytes: Buffer;
  try {
    bytes = await readVerifiedSpendReceipt({ key: claim.receiptStorageKey,
      organizationId: claim.organizationId, employeeId: claim.employeeId,
      sha256: claim.receiptSha256, byteSize: claim.receiptByteSize ?? 0 });
  } catch {
    return Response.json({ error: "Private receipt storage is unavailable." }, { status: 503 });
  }
  await recordAuditEvent({
    organizationId: claim.organizationId, actor: user.name,
    action: "Expense receipt viewed", resource: String(claim.id),
    metadata: { claimId: claim.id, employeeId: claim.employeeId, userId: user.id,
      sha256: claim.receiptSha256 },
  });
  return new Response(new Uint8Array(bytes), { status: 200, headers: {
    "Content-Type": claim.receiptMime ?? "application/octet-stream",
    "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(safeFileName(claim.receiptFileName ?? "receipt")),
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
  } });
}

export async function POST(request: Request) {
  if (!enabled()) return unavailable();
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const id = Number(form?.get("claimId"));
  const file = form?.get("file");
  if (!validId(id) || !(file instanceof File)) {
    return Response.json({ error: "Valid claimId and one receipt PDF, PNG or JPG are required." }, { status: 422 });
  }
  const [core] = await db.select().from(expenseClaims).where(eq(expenseClaims.id, id)).limit(1);
  if (!core) return Response.json({ error: "Receipt not found." }, { status: 404 });
  const denied = await authorize(user, core);
  if (denied) return denied;
  const mfa = requireSensitiveActionMfa(user);
  if (mfa) return mfa;
  const [claim] = await loadSpendClaimEvidence(db, [core]);
  if (claim.categoryPolicyId == null || claim.policyMatched !== true) return Response.json({ error: "Reviewed claim category required." }, { status: 409 });
  if (!claimCanAttachReceipt(claim)) {
    return Response.json({ error: "Claim is already reviewed or already has a receipt." }, { status: 409 });
  }
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "expense-receipt-upload", resourceId: claim.organizationId,
    limit: 12, windowMs: 60 * 60_000,
  });
  if (rateDenied) return rateDenied;
  if (file.size < 1 || file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ error: "Receipt must be non-empty and at most 5 MB." }, { status: 422 });
  }
  const name = safeFileName(file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = validateUpload(bytes, file.type, name);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 422 });
  const scan = await scanUpload(bytes, { fileName: name, mime: parsed.mime });
  if (!scan.scannedClean) {
    return Response.json({ error: "Receipt failed malware validation; no file was stored." }, { status: 503 });
  }
  const key = documentObjectKey(claim.organizationId, claim.employeeId);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const pendingSourceKey = SPEND_PENDING_RECEIPT_PREFIX + randomUUID();

  // Stage unreadable private-object cleanup evidence BEFORE uploading bytes.
  // A SQL failure here means no remote PUT was attempted.
  let pendingDocumentId: number;
  try {
    pendingDocumentId = await db.transaction(async tx => {
      const [intent] = await tx.insert(documents).values({
        organizationId: claim.organizationId, employeeId: claim.employeeId,
        kind: "expense_receipt",
        fileName: "Pending private reimbursement receipt",
        mimeType: parsed.mime, byteSize: bytes.byteLength, sha256: hash,
        scannedClean: false, scanNote: "Pending verified private reimbursement storage",
        sourceType: "upload", sourceKey: pendingSourceKey,
        uploadedBy: user.name, uploadedByUserId: user.id,
        content: "", objectStorageKey: key,
      }).returning({ id: documents.id });
      await tx.insert(auditEvents).values({
        organizationId: claim.organizationId, actor: user.name,
        action: "Pending private reimbursement receipt upload recorded",
        resource: String(intent.id),
        metadata: { claimId: id, employeeId: claim.employeeId,
          documentId: intent.id, sha256: hash, actorUserId: user.id },
      });
      return intent.id;
    });
  } catch {
    return Response.json({ error: "Private receipt upload could not be reserved." }, { status: 409 });
  }

  try {
    await putDocumentObject(key, bytes, parsed.mime);
    await readVerifiedSpendReceipt({ key, organizationId: claim.organizationId,
      employeeId: claim.employeeId, sha256: hash, byteSize: bytes.byteLength });
  } catch {
    // A timed-out PUT may still complete later. Do not DELETE immediately:
    // the committed intent is recovered by the delayed leased sweep.
    return Response.json({ error: "Private receipt verification failed; protected cleanup is queued." }, { status: 503 });
  }

  try {
    const saved = await db.transaction(async tx => {
      const [pending] = await tx.select({
        id: documents.id, scannedClean: documents.scannedClean,
        sourceKey: documents.sourceKey, objectStorageKey: documents.objectStorageKey,
      }).from(documents).where(and(
        eq(documents.id, pendingDocumentId),
        eq(documents.organizationId, claim.organizationId),
      )).for("update").limit(1);
      if (!pending || pending.scannedClean ||
          pending.sourceKey !== pendingSourceKey ||
          pending.objectStorageKey !== key) throw new Error("PENDING_RECEIPT_CHANGED");

      const [freshCore] = await tx.select().from(expenseClaims).where(and(
        eq(expenseClaims.id, id), eq(expenseClaims.organizationId, claim.organizationId),
      )).for("update").limit(1);
      if (!freshCore) throw new Error("CLAIM_ALREADY_CHANGED");
      const [fresh] = await loadSpendClaimEvidence(tx, [freshCore]);
      if (!fresh || !claimCanAttachReceipt(fresh) || fresh.policyMatched !== true) throw new Error("CLAIM_ALREADY_CHANGED");
      const [updated] = await tx.update(expenseClaimEvidence).set({
        receiptStorageKey: key, receiptSha256: hash, receiptMime: parsed.mime,
        receiptFileName: name, receiptScanNote: scan.note.slice(0, 240),
        receiptByteSize: bytes.byteLength, receiptVerifiedAt: new Date(),
      }).where(and(
        eq(expenseClaimEvidence.claimId, id), eq(expenseClaimEvidence.organizationId, claim.organizationId),
        isNull(expenseClaimEvidence.receiptStorageKey),
      )).returning({ id: expenseClaimEvidence.claimId });
      if (!updated) throw new Error("CLAIM_ALREADY_CHANGED");
      // Receipt metadata and deletion of the recovery intent commit together.
      // On rollback, the unreadable intent survives and cleanup remains safe.
      const cleared = await tx.delete(documents).where(and(
        eq(documents.id, pendingDocumentId),
        eq(documents.organizationId, claim.organizationId),
        eq(documents.sourceKey, pendingSourceKey),
        eq(documents.scannedClean, false),
      )).returning({ id: documents.id });
      if (cleared.length !== 1) throw new Error("PENDING_RECEIPT_CHANGED");
      await tx.insert(auditEvents).values({
        organizationId: claim.organizationId, actor: user.name,
        action: "Expense receipt scanned and uploaded", resource: String(id),
        metadata: { claimId: id, employeeId: claim.employeeId,
          sha256: hash, scannerEngine: scan.engine ?? null },
      });
      return updated;
    });
    return Response.json({ claimId: saved.id, sha256: hash, receiptFileName: name }, { status: 201 });
  } catch {
    // PUT and SHA readback completed: immediate best-effort reconciliation is
    // safe, but failed DELETE retains the committed intent for the sweeper.
    await reconcilePendingSpendReceipt(pendingDocumentId).catch(() => {});
    return Response.json({ error: "Receipt could not be attached; protected cleanup evidence is retained." }, { status: 409 });
  }

}
