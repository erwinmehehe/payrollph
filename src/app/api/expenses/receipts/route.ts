import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, employees, expenseClaims } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertMembership, assertOrganizationRole, assertScope, getAccess, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import {
  documentObjectKey, putDocumentObject, deleteDocumentObject,
  documentStorageConfig, signedDocumentObjectUrl,
} from "@/lib/document-object-storage";
import { documentUploadsEnabled, MAX_UPLOAD_BYTES, safeFileName, scanUpload, validateUpload } from "@/lib/storage";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit } from "@/lib/security-request";
import { recordAuditEvent } from "@/lib/audit";
import { claimCanAttachReceipt } from "@/lib/spend-payroll-reimbursement";

export const dynamic = "force-dynamic";
const enabled = () => criticalReleaseFlagEnabled("spendPayroll") &&
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
  const [claim] = await db.select().from(expenseClaims).where(eq(expenseClaims.id, id)).limit(1);
  if (!claim) return Response.json({ error: "Receipt not found." }, { status: 404 });
  const denied = await authorize(user, claim);
  if (denied) return denied;
  if (!claim.receiptStorageKey || !claim.receiptSha256) {
    return Response.json({ error: "No scanned receipt exists for this claim." }, { status: 404 });
  }
  let url: URL;
  try {
    url = signedDocumentObjectUrl(claim.receiptStorageKey, "GET", documentStorageConfig());
  } catch {
    return Response.json({ error: "Private receipt storage is unavailable." }, { status: 503 });
  }
  await recordAuditEvent({
    organizationId: claim.organizationId, actor: user.name,
    action: "Expense receipt viewed", resource: String(claim.id),
    metadata: { claimId: claim.id, employeeId: claim.employeeId, userId: user.id,
      sha256: claim.receiptSha256 },
  });
  return new Response(null, { status: 302, headers: {
    Location: url.toString(), "Cache-Control": "private, no-store",
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
  const [claim] = await db.select().from(expenseClaims).where(eq(expenseClaims.id, id)).limit(1);
  if (!claim) return Response.json({ error: "Receipt not found." }, { status: 404 });
  const denied = await authorize(user, claim);
  if (denied) return denied;
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
  try {
    await putDocumentObject(key, bytes, parsed.mime);
  } catch {
    return Response.json({ error: "Private receipt storage is unavailable." }, { status: 503 });
  }
  try {
    const saved = await db.transaction(async tx => {
      const [fresh] = await tx.select().from(expenseClaims).where(and(
        eq(expenseClaims.id, id), eq(expenseClaims.organizationId, claim.organizationId),
      )).for("update").limit(1);
      if (!fresh || !claimCanAttachReceipt(fresh)) throw new Error("CLAIM_ALREADY_CHANGED");
      const [updated] = await tx.update(expenseClaims).set({
        receiptStorageKey: key, receiptSha256: hash, receiptMime: parsed.mime,
        receiptFileName: name, receiptScanNote: scan.note.slice(0, 240),
      }).where(and(
        eq(expenseClaims.id, id), eq(expenseClaims.organizationId, claim.organizationId),
        eq(expenseClaims.status, "pending"), isNull(expenseClaims.receiptStorageKey),
      )).returning({ id: expenseClaims.id });
      if (!updated) throw new Error("CLAIM_ALREADY_CHANGED");
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
    await deleteDocumentObject(key).catch(() => {});
    return Response.json({ error: "Receipt could not be attached; claim may have changed." }, { status: 409 });
  }
}
