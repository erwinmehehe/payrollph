import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents, statutoryRemittanceBatches,
  statutoryRemittancePaymentEvidence,
} from "@/db/schema";
import { getAccess, PAYROLL_OPERATOR_ROLES, roleAllowed } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { safeFileName, scanUpload, validateUpload } from "@/lib/storage";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024;

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
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 ||
      !Number.isSafeInteger(batchId) || batchId <= 0) {
    return Response.json({ error: "Valid organizationId and batchId are required." }, { status: 400 });
  }
  const denied = await requirePayrollOperator(user.id, organizationId);
  if (denied) return denied;

  // An empty proof index is verified only for a real batch owned by this employer.
  // Foreign or nonexistent batches must fail closed instead of returning 200 [].
  const [ownedBatch] = await db.select({ id: statutoryRemittanceBatches.id })
    .from(statutoryRemittanceBatches)
    .where(and(
      eq(statutoryRemittanceBatches.id, batchId),
      eq(statutoryRemittanceBatches.organizationId, organizationId),
    )).limit(1);
  if (!ownedBatch) return Response.json({ error: "Remittance batch not found." }, { status: 404 });

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
    organizationId,
    batchId,
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

  if (file.size <= 0 || file.size > MAX_BYTES) {
    return Response.json({ error: "Payment proof must be between 1 byte and 2 MB." }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateUpload(bytes, file.type, file.name);
  if (!validation.ok) {
    return Response.json({ error: validation.error }, { status: 422 });
  }

  const scan = await scanUpload(bytes, { fileName: file.name, mime: validation.mime });
  if (!scan.scannedClean) {
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: scan.unavailable
        ? "Statutory remittance payment proof scan unavailable"
        : "Statutory remittance payment proof blocked by malware scan",
      resource: safeFileName(file.name),
      metadata: {
        batchId,
        unavailable: scan.unavailable === true,
        engine: scan.engine ?? null,
        threat: scan.threat ?? null,
        note: scan.note,
      },
    });
    return Response.json({
      error: scan.unavailable
        ? "Payment proof cannot be accepted because malware scanning is unavailable."
        : "Payment proof was rejected by malware scanning.",
      code: scan.unavailable ? "MALWARE_SCAN_UNAVAILABLE" : "MALWARE_DETECTED",
    }, { status: scan.unavailable ? 503 : 422 });
  }

  const fileSha256 = createHash("sha256").update(bytes).digest("hex");
  const fileDataBase64 = Buffer.from(bytes).toString("base64");
  const fileName = safeFileName(file.name);

  // Lock the owned parent batch inside the transaction. Same-batch writers
  // serialize here; a partial unique index protects against other DB writers.
  const outcome = await db.transaction(async (tx) => {
    const [lockedBatch] = await tx.select().from(statutoryRemittanceBatches)
      .where(and(
        eq(statutoryRemittanceBatches.id, batchId),
        eq(statutoryRemittanceBatches.organizationId, organizationId),
      )).for("update");
    if (!lockedBatch) return {
      kind: "rejected" as const, status: 404 as const, error: "Remittance batch not found.",
    };

    const existing = await tx.select().from(statutoryRemittancePaymentEvidence).where(and(
      eq(statutoryRemittancePaymentEvidence.organizationId, organizationId),
      eq(statutoryRemittancePaymentEvidence.batchId, batchId),
    )).orderBy(desc(statutoryRemittancePaymentEvidence.uploadedAt), desc(statutoryRemittancePaymentEvidence.id));
    const activeRows = existing.filter(row => row.status === "active");
    if (activeRows.length > 1) return {
      kind: "rejected" as const, status: 409 as const,
      error: "Multiple active payment proofs require an administrator integrity review.",
    };
    const active = activeRows[0] ?? null;

    if (lockedBatch.status !== "open") {
      if (active) return {
        kind: "rejected" as const, status: 409 as const,
        error: "Payment proof is immutable once payment has been recorded.",
      };
      if (!replacementReason || replacementReason.length < 8) return {
        kind: "rejected" as const, status: 409 as const,
        error: "Historical payment proof backfill requires an explanation of at least 8 characters.",
      };
    }
    if (active && !replacementReason) return {
      kind: "rejected" as const, status: 409 as const,
      error: "An active payment proof already exists. Explain why it is being replaced.",
    };
    if (existing.some(row => row.fileSha256 === fileSha256)) return {
      kind: "rejected" as const, status: 409 as const,
      error: "This exact payment proof file is already stored for the batch.",
    };

    const now = new Date();
    if (active) {
      await tx.update(statutoryRemittancePaymentEvidence).set({
        status: "superseded",
        replacementReason,
        supersededAt: now,
      }).where(and(
        eq(statutoryRemittancePaymentEvidence.id, active.id),
        eq(statutoryRemittancePaymentEvidence.organizationId, organizationId),
        eq(statutoryRemittancePaymentEvidence.batchId, batchId),
      ));
    }
    const [created] = await tx.insert(statutoryRemittancePaymentEvidence).values({
      organizationId,
      batchId,
      fileName,
      mimeType: validation.mime,
      byteSize: bytes.byteLength,
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
    // Treat the receipt and its audit trail as one commit. If audit insertion
    // fails, PostgreSQL rolls back the active-proof replacement as well.
    await tx.insert(auditEvents).values({
      organizationId,
      actor: user.name,
      action: active
        ? "Statutory remittance payment proof replaced"
        : lockedBatch.status === "open"
          ? "Statutory remittance payment proof uploaded"
          : "Historical statutory remittance payment proof backfilled",
      resource: lockedBatch.agency + " · " + lockedBatch.applicableMonth,
      metadata: {
        batchId,
        evidenceId: created.id,
        fileName: created.fileName,
        mimeType: created.mimeType,
        byteSize: created.byteSize,
        fileSha256: created.fileSha256,
        malwareScannedClean: scan.scannedClean,
        malwareScanEngine: scan.engine ?? null,
        malwareScanNote: scan.note,
        replacedEvidenceId: active?.id ?? null,
        replacementReason,
        batchStatusAtUpload: lockedBatch.status,
        historicalBackfill: lockedBatch.status !== "open",
      },
    });
    return { kind: "created" as const, created };
  });

  if (outcome.kind === "rejected") {
    return Response.json({ error: outcome.error }, { status: outcome.status });
  }
  return Response.json({ organizationId, batchId, evidence: outcome.created }, { status: 201 });
}
