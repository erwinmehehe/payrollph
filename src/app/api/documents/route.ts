import { enforceSameOriginMutation } from "@/lib/security-request";
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, ne, notLike, or } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  documents,
  employees,
  hcmDocumentRequirements,
  hcmEmployeeDocumentCompliance,
} from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { documentObjectKey, putDocumentObject, verifyStoredDocumentObject } from "@/lib/document-object-storage";
import { canStaffOpenEmployeeVault, validExpiryCalendarDate } from "@/lib/employee-document-vault";
import { VAULT_PENDING_SOURCE_PREFIX } from "@/lib/employee-vault-object-reconciliation";
import { VAULT_REMOVED_SOURCE_PREFIX } from "@/lib/employee-vault-profile";
import {
  canMutateLegacyHcmDocument, legacyDocumentInsertTable, legacyVisibleDocumentWhere,
} from "@/lib/document-schema-compat";
import { documentUploadsEnabled, MAX_UPLOAD_BYTES, safeFileName, scanUpload, validateUpload } from "@/lib/storage";
import { assertMembership, assertOrganizationRole, assertScope, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  if (user.role === "employee") {
    if (!user.employeeId) return Response.json({ error: "Employee profile is not linked." }, { status: 403 });
    const denied = await assertMembership(user.id, organizationId);
    if (denied) return denied;

    const rows = await db.select({
      id: documents.id,
      employeeId: documents.employeeId,
      kind: documents.kind,
      fileName: documents.fileName,
      mimeType: documents.mimeType,
      byteSize: documents.byteSize,
      scannedClean: documents.scannedClean,
      scanNote: documents.scanNote,
      sourceType: documents.sourceType,
      generationMetadata: documents.generationMetadata,
      uploadedBy: documents.uploadedBy,
      createdAt: documents.createdAt,
    }).from(documents)
      .where(and(eq(documents.organizationId, organizationId), eq(documents.employeeId, user.employeeId),
        or(isNull(documents.sourceKey), and(notLike(documents.sourceKey, VAULT_PENDING_SOURCE_PREFIX + "%"), notLike(documents.sourceKey, VAULT_REMOVED_SOURCE_PREFIX + "%")))))
      .orderBy(desc(documents.id));

    return Response.json({
      documents: rows,
      limits: { maxBytes: MAX_UPLOAD_BYTES, accepted: ["application/pdf", "image/png", "image/jpeg"] },
    });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can view company documents.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  if (criticalReleaseFlagEnabled("employeeDocumentVault") && !canStaffOpenEmployeeVault(access.role)) {
    return Response.json({ error: "Private HR documents are outside your role." }, { status: 403 });
  }

  const rows = await db.select({
    id: documents.id,
    employeeId: documents.employeeId,
    kind: documents.kind,
    fileName: documents.fileName,
    mimeType: documents.mimeType,
    byteSize: documents.byteSize,
    scannedClean: documents.scannedClean,
    scanNote: documents.scanNote,
    uploadedBy: documents.uploadedBy,
    createdAt: documents.createdAt,
  }).from(documents)
    .where(and(
      eq(documents.organizationId, organizationId),
      or(isNull(documents.sourceKey), and(notLike(documents.sourceKey, VAULT_PENDING_SOURCE_PREFIX + "%"), notLike(documents.sourceKey, VAULT_REMOVED_SOURCE_PREFIX + "%"))),
      // Turning the A-5 flag back off must NOT reveal confidential 201-file
      // metadata to bookkeeper/legacy People roles. The object-backed row
      // remains private even during feature rollback.
      canStaffOpenEmployeeVault(access.role) ? undefined : legacyVisibleDocumentWhere,
    ))
    .orderBy(desc(documents.id));

  const staff = await db.select({ id: employees.id, first: employees.firstName, last: employees.lastName, orgUnitId: employees.orgUnitId })
    .from(employees).where(eq(employees.organizationId, organizationId));
  const visibleStaff = access.companyWide ? staff : staff.filter((row) => row.orgUnitId === access.orgUnitId);
  const names = new Map(visibleStaff.map((row) => [row.id, `${row.first} ${row.last}`]));
  const visibleEmployeeIds = new Set(visibleStaff.map((row) => row.id));
  const visibleDocuments = access.companyWide
    ? rows
    : rows.filter((row) => row.employeeId != null && visibleEmployeeIds.has(row.employeeId));

  return Response.json({
    documents: visibleDocuments.map((row) => ({ ...row, employeeName: row.employeeId ? names.get(row.employeeId) ?? null : null })),
    limits: { maxBytes: MAX_UPLOAD_BYTES, accepted: ["application/pdf", "image/png", "image/jpeg"] },
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  if (!documentUploadsEnabled()) {
    return Response.json(
      {
        error: "Document uploads are disabled for this production rollout.",
        code: "DOCUMENT_UPLOADS_DISABLED",
      },
      { status: 503 },
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES + 1024 * 1024) {
    return Response.json({ error: "Upload body is too large." }, { status: 413 });
  }

  // This endpoint is multipart. Parse the form first, never clone it as JSON.
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "Multipart form data is required." }, { status: 400 });

  const organizationId = Number(form.get("organizationId"));
  const file = form.get("file");
  let kind = String(form.get("kind") ?? "other").slice(0, 40);
  const employeeRaw = form.get("employeeId");
  const requirementRaw = form.get("requirementId");
  const expiresAtRaw = String(form.get("expiresAt") ?? "").trim();
  const requirementId = requirementRaw && requirementRaw !== "null" && requirementRaw !== ""
    ? Number(requirementRaw)
    : null;
  if (requirementId != null && !Number.isInteger(requirementId)) {
    return Response.json({ error: "requirementId must be an integer." }, { status: 422 });
  }
  const vaultEnabled = criticalReleaseFlagEnabled("employeeDocumentVault");
  // Unattached personal-vault uploads have a fixed category vocabulary.
  // Assigned HCM requirements keep their existing, separately governed kinds.
  if (vaultEnabled && requirementId === null &&
      !["government_id", "contract", "certificate", "onboarding", "other"].includes(kind)) {
    return Response.json({ error: "Invalid document category." }, { status: 422 });
  }
  if (vaultEnabled && expiresAtRaw && !validExpiryCalendarDate(expiresAtRaw)) {
    return Response.json({ error: "expiresAt must be a real YYYY-MM-DD date." }, { status: 422 });
  }
  const expiresAt = expiresAtRaw
    ? (/^\d{4}-\d{2}-\d{2}$/.test(expiresAtRaw) ? expiresAtRaw : null)
    : null;
  if (expiresAtRaw && !expiresAt) {
    return Response.json({ error: "expiresAt must use YYYY-MM-DD." }, { status: 422 });
  }

  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });
  if (!(file instanceof File)) return Response.json({ error: "A file is required." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ error: `File exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit.` }, { status: 413 });
  }

  let employeeId: number | null = null;
  if (user.role === "employee") {
    if (!user.employeeId) return Response.json({ error: "Employee profile is not linked." }, { status: 403 });
    const denied = await assertMembership(user.id, organizationId);
    if (denied) return denied;
    employeeId = user.employeeId;
  } else {
    const denied = await assertOrganizationRole(
      user.id,
      organizationId,
      PEOPLE_ADMIN_ROLES,
      "Only People administrators can upload company documents.",
    );
    if (denied) return denied;
    const access = await getAccess(user.id, organizationId);
    if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
    if (vaultEnabled && !canStaffOpenEmployeeVault(access.role)) {
      return Response.json({ error: "Private HR files require People authorization." }, { status: 403 });
    }

    if (employeeRaw && employeeRaw !== "null" && employeeRaw !== "") {
      const candidate = Number(employeeRaw);
      if (!Number.isInteger(candidate)) return Response.json({ error: "employeeId must be an integer." }, { status: 422 });
      const [employee] = await db.select({ id: employees.id, orgUnitId: employees.orgUnitId })
        .from(employees)
        .where(and(eq(employees.id, candidate), eq(employees.organizationId, organizationId)));
      if (!employee) return Response.json({ error: "Employee not found in this organization." }, { status: 404 });
      const scope = assertScope(access, employee.orgUnitId);
      if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });
      employeeId = employee.id;
    } else if (!access.companyWide) {
      return Response.json({ error: "Unit-scoped roles can upload documents only for employees in their own unit." }, { status: 403 });
    }
  }

  if (employeeId != null) {
    const [employee] = await db.select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId)))
      .limit(1);
    if (!employee) return Response.json({ error: "Employee not found in this organization." }, { status: 404 });
  }

  let requirement: typeof hcmDocumentRequirements.$inferSelect | null = null;
  let complianceRow: typeof hcmEmployeeDocumentCompliance.$inferSelect | null = null;
  if (requirementId != null) {
    if (employeeId == null) {
      return Response.json({ error: "A required employee document must be linked to an employee." }, { status: 400 });
    }
    [requirement] = await db.select().from(hcmDocumentRequirements).where(and(
      eq(hcmDocumentRequirements.id, requirementId),
      eq(hcmDocumentRequirements.organizationId, organizationId),
      eq(hcmDocumentRequirements.active, true),
    )).limit(1);
    if (!requirement) return Response.json({ error: "Document requirement not found or inactive." }, { status: 404 });

    [complianceRow] = await db.select().from(hcmEmployeeDocumentCompliance).where(and(
      eq(hcmEmployeeDocumentCompliance.organizationId, organizationId),
      eq(hcmEmployeeDocumentCompliance.requirementId, requirement.id),
      eq(hcmEmployeeDocumentCompliance.employeeId, employeeId),
    )).limit(1);
    if (!complianceRow) {
      return Response.json({ error: "This document requirement is not assigned to the selected employee." }, { status: 403 });
    }
    if (complianceRow.status === "waived") {
      return Response.json({ error: "This document requirement was waived and is no longer open for upload." }, { status: 409 });
    }
    // If a private, independently governed A-5 file was previously attached,
    // turning the feature OFF must not let the legacy upload path replace its
    // compliance state or silently downgrade it to unverified inline base64.
    // The helper reads old/new DB schemas without referring to absent columns.
    if (!vaultEnabled && complianceRow.documentId !== null &&
      !await canMutateLegacyHcmDocument({
        organizationId, employeeId, documentId: complianceRow.documentId,
      })) {
      return Response.json({ error: "Private document replacement is unavailable while the vault is disabled." }, { status: 409 });
    }
    if (requirement.expiryRequired && !expiresAt) {
      return Response.json({ error: "This required document needs an expiry date." }, { status: 400 });
    }
    kind = requirement.kind;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateUpload(bytes, file.type, file.name);
  if (!check.ok) return Response.json({ error: check.error }, { status: 422 });

  const scan = await scanUpload(bytes, { fileName: file.name, mime: check.mime });
  if (!scan.scannedClean) {
    if (!scan.unavailable) {
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Document upload blocked by malware scan",
        resource: safeFileName(file.name),
        metadata: { kind, employeeId, threat: scan.threat ?? null, engine: scan.engine ?? null },
      });
      return Response.json(
        {
          error: "The file was rejected by malware scanning.",
          code: "MALWARE_DETECTED",
        },
        { status: 422 },
      );
    }

    if (process.env.NODE_ENV === "production") {
      return Response.json(
        {
          error: "Document uploads are temporarily unavailable because malware scanning could not verify the file.",
          code: "MALWARE_SCAN_UNAVAILABLE",
        },
        { status: 503 },
      );
    }
  }

  if (vaultEnabled) {
    if (!scan.scannedClean) {
      return Response.json({ error: "A completed clean malware scan is required for private vault storage." }, { status: 503 });
    }
    const hash = createHash("sha256").update(bytes).digest("hex");
    const storageKey = documentObjectKey(organizationId, employeeId);
    const pendingSourceKey = VAULT_PENDING_SOURCE_PREFIX + randomUUID();

    // Commit an unreadable, tenant-bound recovery intent BEFORE any remote
    // object PUT. The provider and PostgreSQL cannot participate in one
    // transaction; this row makes an ambiguous PUT/failed commit recoverable.
    let pendingDocumentId: number;
    try {
      pendingDocumentId = await db.transaction(async tx => {
        const [intent] = await tx.insert(documents).values({
          organizationId, employeeId, kind,
          fileName: safeFileName(file.name), mimeType: check.mime,
          byteSize: bytes.byteLength, sha256: hash,
          scannedClean: false, scanNote: "Pending verified private storage",
          sourceType: "upload", sourceKey: pendingSourceKey,
          uploadedBy: user.name, uploadedByUserId: user.id,
          objectStorageKey: storageKey, content: "",
        }).returning({ id: documents.id });
        await tx.insert(auditEvents).values({
          organizationId, actor: user.name,
          action: "Pending private vault upload intent recorded",
          resource: String(intent.id),
          metadata: { documentId: intent.id, employeeId,
            sha256: hash, byteSize: bytes.byteLength, actorUserId: user.id },
        });
        return intent.id;
      });
    } catch {
      // No object was written, because the intent failed to commit.
      return Response.json({ error: "Private document upload could not be reserved." }, { status: 409 });
    }

    try {
      await putDocumentObject(storageKey, bytes, check.mime);
      // An HTTP PUT receipt alone cannot prove the bytes survived unchanged.
      await verifyStoredDocumentObject(storageKey, hash, bytes.byteLength);
    } catch {
      // Do NOT issue an immediate DELETE: a delayed/ambiguous remote PUT
      // could complete after it. The durable unreadable intent is swept after
      // the one-hour grace window, even if the feature flag is turned OFF.
      return Response.json({ error: "Private object storage verification failed; protected cleanup is queued." }, { status: 503 });
    }

    try {
      const result = await db.transaction(async tx => {
        const [pending] = await tx.select({
          id: documents.id, scannedClean: documents.scannedClean,
          sourceKey: documents.sourceKey, objectStorageKey: documents.objectStorageKey,
        }).from(documents).where(and(
          eq(documents.id, pendingDocumentId),
          eq(documents.organizationId, organizationId),
        )).for("update").limit(1);
        if (!pending || pending.scannedClean ||
          pending.sourceKey !== pendingSourceKey ||
          pending.objectStorageKey !== storageKey) throw new Error("VAULT_PENDING_INTENT_CHANGED");

        const [stored] = await tx.update(documents).set({
          scannedClean: true, scanNote: scan.note, sourceKey: null,
        }).where(and(
          eq(documents.id, pendingDocumentId),
          eq(documents.organizationId, organizationId),
          eq(documents.sourceKey, pendingSourceKey),
          eq(documents.scannedClean, false),
        )).returning({
          id: documents.id, fileName: documents.fileName,
          byteSize: documents.byteSize, sha256: documents.sha256,
        });
        if (!stored) throw new Error("VAULT_PENDING_INTENT_CHANGED");

        let documentCompliance: typeof hcmEmployeeDocumentCompliance.$inferSelect | null = null;
        if (requirement && complianceRow) {
          // Existing optimistic conditions prevent a concurrent HR waiver,
          // requirement edit, or replacement from being overwritten.
          [documentCompliance] = await tx.update(hcmEmployeeDocumentCompliance).set({
            documentId: stored.id, expiresAt, status: "submitted",
            verifiedAt: null, verifiedByUserId: null,
            verifiedByName: null, updatedAt: new Date(),
          }).where(and(
            eq(hcmEmployeeDocumentCompliance.id, complianceRow.id),
            eq(hcmEmployeeDocumentCompliance.organizationId, organizationId),
            eq(hcmEmployeeDocumentCompliance.employeeId, employeeId!),
            eq(hcmEmployeeDocumentCompliance.requirementId, requirement.id),
            ne(hcmEmployeeDocumentCompliance.status, "waived"),
            eq(hcmEmployeeDocumentCompliance.status, complianceRow.status),
            complianceRow.expiresAt === null
              ? isNull(hcmEmployeeDocumentCompliance.expiresAt)
              : eq(hcmEmployeeDocumentCompliance.expiresAt, String(complianceRow.expiresAt)),
            complianceRow.documentId === null
              ? isNull(hcmEmployeeDocumentCompliance.documentId)
              : eq(hcmEmployeeDocumentCompliance.documentId, complianceRow.documentId),
          )).returning();
          if (!documentCompliance) throw new Error("COMPLIANCE_CHANGED");
        }
        await tx.insert(auditEvents).values({
          organizationId, actor: user.name,
          action: "Employee document scanned and stored in private vault",
          resource: String(stored.id),
          metadata: { documentId: stored.id, employeeId,
            requirementId: requirement?.id ?? null,
            sha256: hash, byteSize: bytes.byteLength, malwareScanClean: true,
            uploadedByUserId: user.id },
        });
        return { row: stored, compliance: documentCompliance };
      });
      return Response.json({
        id: result.row.id, fileName: result.row.fileName,
        byteSize: result.row.byteSize, sha256: result.row.sha256,
        detectedMime: check.mime, compliance: result.compliance,
        scan: { scannedClean: true, note: scan.note, engine: scan.engine },
        storage: "private-object",
      }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    } catch {
      // The earlier intent transaction survives this rollback; it cannot be
      // downloaded while scannedClean=false and will be retried by the sweeper.
      return Response.json({ error: "Private document approval failed; unreadable cleanup intent retained." }, { status: 409 });
    }
  }

  // Legacy database-backed document and its compliance link/audit must commit
  // together; stale cross-employer compliance cannot be reattached by id only.
  const result = await db.transaction(async (tx) => {
      const [row] = await tx.insert(legacyDocumentInsertTable).values({
        organizationId,
        employeeId,
        kind,
        fileName: safeFileName(file.name),
        mimeType: check.mime,
        byteSize: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        scannedClean: scan.scannedClean,
        scanNote: scan.note,
        uploadedBy: user.name,
        content: Buffer.from(bytes).toString("base64"),
      }).returning({
        id: legacyDocumentInsertTable.id,
        fileName: legacyDocumentInsertTable.fileName,
        byteSize: legacyDocumentInsertTable.byteSize,
        sha256: legacyDocumentInsertTable.sha256,
      });

      let compliance = null;
      if (requirement && complianceRow) {
        [compliance] = await tx.update(hcmEmployeeDocumentCompliance).set({
          documentId: row.id,
          expiresAt,
          status: "submitted",
          verifiedAt: null,
          verifiedByUserId: null,
          verifiedByName: null,
          updatedAt: new Date(),
        }).where(and(
          eq(hcmEmployeeDocumentCompliance.id, complianceRow.id),
          eq(hcmEmployeeDocumentCompliance.organizationId, organizationId),
          eq(hcmEmployeeDocumentCompliance.employeeId, complianceRow.employeeId),
          eq(hcmEmployeeDocumentCompliance.requirementId, requirement.id),
        )).returning();
        if (!compliance) throw new Error("DOCUMENT_COMPLIANCE_SCOPE_CHANGED");
      }

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Document uploaded",
        resource: row.fileName,
        metadata: {
          kind,
          employeeId,
          sha256Verified: true,
          avScanned: scan.scannedClean,
          requirementId: requirement?.id ?? null,
          complianceId: compliance?.id ?? null,
          expiresAt,
          status: compliance?.status ?? null,
        },
      }, tx);
    return { row, compliance };
  }).catch(() => null);
  if (!result) return Response.json({
    error: "Document upload could not be committed. Refresh and retry.",
  }, { status: 409 });
  const { row, compliance } = result;

  return Response.json({
    id: row.id,
    fileName: row.fileName,
    byteSize: row.byteSize,
    sha256: row.sha256,
    detectedMime: check.mime,
    compliance,
    scan,
    note: "Stored in Postgres. Configure object storage (S3/R2) before production volume.",
  }, { status: 201 });
}
