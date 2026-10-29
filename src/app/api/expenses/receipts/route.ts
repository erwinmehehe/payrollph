import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, documents, employees, expenseClaimEvidence, expenseClaims, userOrganizations } from "@/db/schema";
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
import { receiptGrantMatches } from "@/lib/spend-receipt-tenant";

export const dynamic = "force-dynamic";
const enabled = () => spendPayrollEnabled() &&
  criticalReleaseFlagEnabled("employeeDocumentVault") && documentUploadsEnabled();
const unavailable = () => Response.json({ error: "Private reimbursement receipts are not enabled." }, { status: 404 });
const validId = (v: number) => Number.isSafeInteger(v) && v > 0;
type ReceiptUser = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;
type ReceiptClaim = typeof expenseClaims.$inferSelect;
type ReceiptTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const notFound = () => Response.json({ error: "Receipt not found." }, {
  status: 404, headers: { "Cache-Control": "private, no-store" },
});

/** A session's global employeeId does not grant receipts in another employer. */
async function activeReceiptGrant(user: ReceiptUser, claim: ReceiptClaim) {
  const [[employee], [membership]] = await Promise.all([
    db.select({
      id: employees.id, organizationId: employees.organizationId,
      orgUnitId: employees.orgUnitId,
    }).from(employees).where(and(
      eq(employees.id, claim.employeeId),
      eq(employees.organizationId, claim.organizationId),
    )).limit(1),
    db.select({
      userId: userOrganizations.userId, organizationId: userOrganizations.organizationId,
      role: userOrganizations.role, active: userOrganizations.active,
      orgUnitId: userOrganizations.orgUnitId,
      workerEmployeeId: userOrganizations.workerEmployeeId,
    }).from(userOrganizations).where(and(
      eq(userOrganizations.userId, user.id),
      eq(userOrganizations.organizationId, claim.organizationId),
      eq(userOrganizations.active, true),
    )).limit(1),
  ]);
  return receiptGrantMatches({
    userId: user.id, accountRole: user.role, accountEmployeeId: user.employeeId,
    claim, employee: employee ?? null, membership: membership ?? null,
  }, PEOPLE_PAYROLL_ROLES);
}

/** Recheck employee, employer, worker and staff scope under real DB row locks.
 * The caller must check this before the first staged write and again before
 * the final receipt attachment; revocation/reassignment cannot authorize a
 * later committed SQL write based solely on the original request preflight.
 */
async function lockedReceiptGrant(tx: ReceiptTransaction, user: ReceiptUser, claim: ReceiptClaim) {
  const [employee] = await tx.select({
    id: employees.id, organizationId: employees.organizationId,
    orgUnitId: employees.orgUnitId,
  }).from(employees).where(and(
    eq(employees.id, claim.employeeId),
    eq(employees.organizationId, claim.organizationId),
  )).for("share").limit(1);
  if (!employee) return false;
  const [membership] = await tx.select({
    userId: userOrganizations.userId, organizationId: userOrganizations.organizationId,
    role: userOrganizations.role, active: userOrganizations.active,
    orgUnitId: userOrganizations.orgUnitId,
    workerEmployeeId: userOrganizations.workerEmployeeId,
  }).from(userOrganizations).where(and(
    eq(userOrganizations.userId, user.id),
    eq(userOrganizations.organizationId, claim.organizationId),
    eq(userOrganizations.active, true),
  )).for("share").limit(1);
  return receiptGrantMatches({
    userId: user.id, accountRole: user.role, accountEmployeeId: user.employeeId,
    claim, employee, membership: membership ?? null,
  }, PEOPLE_PAYROLL_ROLES);
}

async function authorize(user: ReceiptUser,
  claim: ReceiptClaim): Promise<Response | null> {
  if (user.role === "employee") {
    if (!user.employeeId || user.employeeId !== claim.employeeId) {
      return notFound();
    }
    const denied = await assertMembership(user.id, claim.organizationId);
    if (denied) return notFound();
    return await activeReceiptGrant(user, claim) ? null : notFound();
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
  // External object storage may take time; do not return private bytes based
  // on a membership that was revoked while those bytes were being fetched.
  const readDenied = await authorize(user, core);
  if (readDenied) return readDenied;
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
      // Do not stage a private object for a transferred/reassigned claim.
      const [liveClaim] = await tx.select({
        id: expenseClaims.id,
      }).from(expenseClaims).where(and(
        eq(expenseClaims.id, claim.id),
        eq(expenseClaims.organizationId, claim.organizationId),
        eq(expenseClaims.employeeId, claim.employeeId),
      )).for("share").limit(1);
      if (!liveClaim || !await lockedReceiptGrant(tx, user, claim)) {
        throw new Error("RECEIPT_GRANT_CHANGED");
      }
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
    return Response.json({ error: "Could not start this receipt upload. Please try again." }, { status: 409 });
  }

  try {
    await putDocumentObject(key, bytes, parsed.mime);
    await readVerifiedSpendReceipt({ key, organizationId: claim.organizationId,
      employeeId: claim.employeeId, sha256: hash, byteSize: bytes.byteLength });
  } catch {
    // A timed-out PUT may still complete later. Do not DELETE immediately:
    // the committed intent is recovered by the delayed leased sweep.
    return Response.json({ error: "Receipt storage could not be verified. Please try again later." }, { status: 503 });
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
      if (!freshCore || freshCore.employeeId !== claim.employeeId) throw new Error("CLAIM_ALREADY_CHANGED");
      if (!await lockedReceiptGrant(tx, user, freshCore)) throw new Error("RECEIPT_GRANT_CHANGED");
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
    return Response.json({ error: "This receipt could not be saved. The claim may have changed or the receipt may already be in use." }, { status: 409 });
  }

}
