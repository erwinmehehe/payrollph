import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { documents, employees } from "@/db/schema";
import {
  assertMembership,
  assertOrganizationRole,
  assertScope,
  getAccess,
  PEOPLE_ADMIN_ROLES,
} from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { canStaffOpenEmployeeVault, documentObjectIdentityMatches, documentBytesMayBeReleased } from "@/lib/employee-document-vault";
import { documentStorageConfig, signedDocumentObjectUrl } from "@/lib/document-object-storage";
import { compatibleDocumentColumns } from "@/lib/document-schema-compat";
import { vaultRecordRemoved } from "@/lib/employee-vault-profile";

export const dynamic = "force-dynamic";

function contentDisposition(fileName: string) {
  const safe = fileName.replace(/[\r\n"]/g, "_");
  return `inline; filename="${safe}"`;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const { id } = await context.params;
  const documentId = Number(id);
  if (!Number.isInteger(documentId)) {
    return Response.json({ error: "A valid document id is required." }, { status: 400 });
  }

  const [document] = await db.select(compatibleDocumentColumns).from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!document || vaultRecordRemoved(document.sourceKey)) return Response.json({ error: "Document not found." }, { status: 404 });

  if (user.role === "employee") {
    if (!user.employeeId || document.employeeId !== user.employeeId) {
      return Response.json({ error: "Document not found." }, { status: 404 });
    }
    const denied = await assertMembership(user.id, document.organizationId);
    if (denied) return denied;
  } else {
    const denied = await assertOrganizationRole(
      user.id,
      document.organizationId,
      PEOPLE_ADMIN_ROLES,
      "Only People administrators can view employee documents.",
    );
    if (denied) return denied;

    const access = await getAccess(user.id, document.organizationId);
    if (!access) return Response.json({ error: "Workspace access required." }, { status: 403 });
    if ((criticalReleaseFlagEnabled("employeeDocumentVault") || document.objectStorageKey) &&
      !canStaffOpenEmployeeVault(access.role)) {
      return Response.json({ error: "Private HR document not found." }, { status: 404 });
    }

    if (document.employeeId != null) {
      const [employee] = await db.select({
        id: employees.id,
        orgUnitId: employees.orgUnitId,
      }).from(employees).where(and(
        eq(employees.id, document.employeeId),
        eq(employees.organizationId, document.organizationId),
      )).limit(1);
      if (!employee) return Response.json({ error: "Document not found." }, { status: 404 });
      const scope = assertScope(access, employee.orgUnitId);
      if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });
    } else if (!access.companyWide) {
      return Response.json({ error: "Company-wide documents are outside your organization-unit scope." }, { status: 403 });
    }
  }

  const vaultEnabled = criticalReleaseFlagEnabled("employeeDocumentVault");
  if (!documentBytesMayBeReleased({
    scannedClean: document.scannedClean,
    isProduction: process.env.NODE_ENV === "production",
    vaultEnabled,
    hasPrivateObject: Boolean(document.objectStorageKey),
  })) {
    return Response.json({
      error: "This document is not available because malware scanning has not verified it as clean.",
    }, { status: 409 });
  }

  if (document.objectStorageKey) {
    // An object key must be tied to the exact tenant/employee from the
    // authorized document row, not merely have a plausible string prefix.
    if (!documentObjectIdentityMatches(document.objectStorageKey,
      document.organizationId, document.employeeId)) {
      return Response.json({ error: "Private document storage integrity check failed." }, { status: 409 });
    }
    let signed: URL;
    try {
      signed = signedDocumentObjectUrl(document.objectStorageKey,
        "GET", documentStorageConfig(), { expirySeconds: 60 });
    } catch {
      return Response.json({ error: "Private document storage is unavailable." }, { status: 503 });
    }
    // Persist view evidence *before* exposing the one-minute URL. Any audit
    // failure must fail closed rather than returning untracked private bytes.
    await recordAuditEvent({
      organizationId: document.organizationId, actor: user.name,
      action: "Employee document viewed", resource: String(document.id),
      metadata: { documentId: document.id, employeeId: document.employeeId,
        actorUserId: user.id, source: "private-object",
        sha256: document.sha256 },
    });
    return new Response(null, { status: 302, headers: {
      "Location": signed.toString(),
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    } });
  }

  if (vaultEnabled && document.content.length === 0) {
    return Response.json({ error: "This legacy document is not yet available in the private vault." }, { status: 409 });
  }
  const body = Buffer.from(document.content, "base64");
  // After A-5 activation all legacy bytes must match their stored SHA-256,
  // not only generated files. Unverified uploads must never be served.
  if (vaultEnabled || document.sourceType === "generated") {
    const sha256 = createHash("sha256").update(body).digest("hex");
    if (sha256 !== document.sha256) {
      return Response.json({
        error: document.sourceType === "generated"
          ? "Generated document integrity verification failed."
          : "Employee document integrity verification failed.",
      }, { status: 409 });
    }
  }

  if (vaultEnabled) {
    await recordAuditEvent({
      organizationId: document.organizationId, actor: user.name,
      action: "Employee document viewed", resource: String(document.id),
      metadata: { documentId: document.id, employeeId: document.employeeId,
        actorUserId: user.id, source: "verified-legacy",
        sha256: document.sha256 },
    });
  }
  return new Response(body, {
    headers: {
      "Content-Type": document.mimeType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": contentDisposition(document.fileName),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
