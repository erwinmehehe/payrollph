import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  statutoryRemittanceBatches,
  statutoryRemittancePaymentEvidence,
} from "@/db/schema";
import { getAccess, PAYROLL_OPERATOR_ROLES, roleAllowed } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

async function requirePayrollOperator(userId: number, organizationId: number) {
  const access = await getAccess(userId, organizationId);
  if (!access) {
    return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  }
  if (!access.companyWide || !roleAllowed(access.role, PAYROLL_OPERATOR_ROLES)) {
    return Response.json({
      error: "Only company-wide authorized payroll operators can manage statutory payment proof.",
    }, { status: 403 });
  }
  return null;
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._ -]+/g, "").trim().slice(0, 180) || "payment-proof";
}

function bytesMatchMime(bytes: Buffer, mimeType: string) {
  if (mimeType === "application/pdf") {
    return bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  }
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3
      && bytes[0] === 0xff
      && bytes[1] === 0xd8
      && bytes[2] === 0xff;
  }
  if (mimeType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length >= signature.length
      && signature.every((value, index) => bytes[index] === value);
  }
  return false;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const batchId = Number(url.searchParams.get("batchId"));
  if (!Number.isInteger(organizationId) || !Number.isInteger(batchId)) {
    return Response.json({ error: "organizationId and batchId are required." }, { status: 400 });
  }
  const denied = await requirePayrollOperator(user.id, organizationId);
  if (denied) return denied;

  const rows = await db.select({
    id: statutoryRemittancePaymentEvidence.id,
    batchId: statutoryRemittancePaymentEvidence.batchId,
    fileName: statutoryRemittancePaymentEvidence.fileName,
    mimeType: statutoryRemittancePaymentEvidence.mimeType,
    byteSize: statutoryRemittancePaymentEvidence.byteSize,
    fileSha256: statutoryRemittancePaymentEvidence.fileSha256,
    status: statutoryRemittancePaymentEvidence.status,
    replacementReason: statutoryRemittancePaymentEvidence.replacementReason,
    uploadedByName: statutoryRemittancePaymentEvidence.uploadedByName,
    uploadedAt: statutoryRemittancePaymentEvidence.uploadedAt,
    supersededAt: statutoryRemittancePaymentEvidence.supersededAt,
  }).from(statutoryRemittancePaymentEvidence)
    .where(and(
      eq(statutoryRemittancePaymentEvidence.organizationId, organizationId),
      eq(statutoryRemittancePaymentEvidence.batchId, batchId),
    ))
    .orderBy(desc(statutoryRemittancePaymentEvidence.uploadedAt), desc(statutoryRemittancePaymentEvidence.id));

  return Response.json({
    evidence: rows,
    active: rows.find((row) => row.status === "active") ?? null,
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "Multipart form data is required." }, { status: 400 });

  const organizationId = Number(form.get("organizationId"));
  const batchId = Number(form.get("batchId"));
  const replacementReason = String(form.get("replacementReason") ?? "").trim().slice(0, 280) || null;
  const file = form.get("file");

  if (!Number.isInteger(organizationId) || !Number.isInteger(batchId) || !(file instanceof File)) {
    return Response.json({ error: "organizationId, batchId and file are required." }, { status: 400 });
  }

  const denied = await requirePayrollOperator(user.id, organizationId);
  if (denied) return denied;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "statutory-remittance-payment-proof-upload",
    resourceId: organizationId,
    limit: 20,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const [batch] = await db.select().from(statutoryRemittanceBatches).where(and(
    eq(statutoryRemittanceBatches.id, batchId),
    eq(statutoryRemittanceBatches.organizationId, organizationId),
  )).limit(1);
  if (!batch) return Response.json({ error: "Remittance batch not found." }, { status: 404 });

  if (!ALLOWED_TYPES.has(file.type)) {
    return Response.json({ error: "Only PDF, JPEG and PNG payment proof files are allowed." }, { status: 415 });
  }
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return Response.json({ error: "Payment proof must be between 1 byte and 2 MB." }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytesMatchMime(bytes, file.type)) {
    return Response.json({
      error: "Payment proof contents do not match the declared PDF/JPEG/PNG file type.",
    }, { status: 415 });
  }
  const fileSha256 = createHash("sha256").update(bytes).digest("hex");
  const fileDataBase64 = bytes.toString("base64");
  const fileName = sanitizeFileName(file.name);

  const existing = await db.select().from(statutoryRemittancePaymentEvidence).where(and(
    eq(statutoryRemittancePaymentEvidence.organizationId, organizationId),
    eq(statutoryRemittancePaymentEvidence.batchId, batchId),
  )).orderBy(desc(statutoryRemittancePaymentEvidence.uploadedAt), desc(statutoryRemittancePaymentEvidence.id));
  const active = existing.find((row) => row.status === "active") ?? null;

  if (batch.status !== "open") {
    if (active) {
      return Response.json({
        error: "Payment proof is immutable once payment has been recorded.",
      }, { status: 409 });
    }
    if (!replacementReason || replacementReason.length < 8) {
      return Response.json({
        error: "Historical payment proof backfill requires an explanation of at least 8 characters.",
      }, { status: 409 });
    }
  }

  if (active && !replacementReason) {
    return Response.json({
      error: "An active payment proof already exists. Explain why it is being replaced.",
    }, { status: 409 });
  }
  if (existing.some((row) => row.fileSha256 === fileSha256)) {
    return Response.json({
      error: "This exact payment proof file is already stored for the batch.",
    }, { status: 409 });
  }

  const now = new Date();
  const created = await db.transaction(async (tx) => {
    if (active) {
      await tx.update(statutoryRemittancePaymentEvidence).set({
        status: "superseded",
        replacementReason,
        supersededAt: now,
      }).where(and(
        eq(statutoryRemittancePaymentEvidence.id, active.id),
        eq(statutoryRemittancePaymentEvidence.organizationId, organizationId),
      ));
    }

    const [row] = await tx.insert(statutoryRemittancePaymentEvidence).values({
      organizationId,
      batchId,
      fileName,
      mimeType: file.type,
      byteSize: file.size,
      fileSha256,
      fileDataBase64,
      status: "active",
      uploadedByUserId: user.id,
      uploadedByName: user.name,
      uploadedAt: now,
    }).returning({
      id: statutoryRemittancePaymentEvidence.id,
      fileName: statutoryRemittancePaymentEvidence.fileName,
      mimeType: statutoryRemittancePaymentEvidence.mimeType,
      byteSize: statutoryRemittancePaymentEvidence.byteSize,
      fileSha256: statutoryRemittancePaymentEvidence.fileSha256,
      status: statutoryRemittancePaymentEvidence.status,
      uploadedByName: statutoryRemittancePaymentEvidence.uploadedByName,
      uploadedAt: statutoryRemittancePaymentEvidence.uploadedAt,
    });
    return row;
  });

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: active
      ? "Statutory remittance payment proof replaced"
      : batch.status === "open"
        ? "Statutory remittance payment proof uploaded"
        : "Historical statutory remittance payment proof backfilled",
    resource: batch.agency + " · " + batch.applicableMonth,
    metadata: {
      batchId,
      evidenceId: created.id,
      fileName: created.fileName,
      mimeType: created.mimeType,
      byteSize: created.byteSize,
      fileSha256: created.fileSha256,
      replacedEvidenceId: active?.id ?? null,
      replacementReason,
      batchStatusAtUpload: batch.status,
      historicalBackfill: batch.status !== "open",
    },
  });

  return Response.json({ evidence: created }, { status: 201 });
}
