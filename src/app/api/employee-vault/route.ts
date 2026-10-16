import { and, desc, eq, isNull, notLike, or } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { VAULT_PENDING_SOURCE_PREFIX } from "@/lib/employee-vault-object-reconciliation";
import { authorizeEmployeeVault, employeeVaultCanRemove, VAULT_REMOVED_SOURCE_PREFIX } from "@/lib/employee-vault-profile";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/** Bounded employee-specific projection; never enumerate an entire tenant. */
export async function GET(request: Request) {
  if (!criticalReleaseFlagEnabled("employeeDocumentVault")) {
    return Response.json({ error: "Employee vault is disabled." }, { status: 404, headers });
  }
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers });
  const query = new URL(request.url).searchParams;
  const organizationId = Number(query.get("organizationId"));
  const employeeId = Number(query.get("employeeId"));
  const authorized = await authorizeEmployeeVault(user, organizationId, employeeId);
  if (!authorized.ok) return authorized.response;

  const rows = await db.select({
    id: documents.id, kind: documents.kind,
    fileName: documents.fileName, mimeType: documents.mimeType,
    byteSize: documents.byteSize, uploadedBy: documents.uploadedBy,
    uploadedByUserId: documents.uploadedByUserId, uploadedAt: documents.createdAt,
    sourceType: documents.sourceType, sourceKey: documents.sourceKey,
    objectStorageKey: documents.objectStorageKey,
  }).from(documents).where(and(
    eq(documents.organizationId, organizationId),
    eq(documents.employeeId, employeeId),
    eq(documents.scannedClean, true),
    or(isNull(documents.sourceKey), and(
      notLike(documents.sourceKey, VAULT_PENDING_SOURCE_PREFIX + "%"),
      notLike(documents.sourceKey, VAULT_REMOVED_SOURCE_PREFIX + "%"),
    )),
  )).orderBy(desc(documents.createdAt), desc(documents.id)).limit(200);

  return Response.json({
    organizationId, employeeId,
    maxUploadBytes: 5 * 1024 * 1024,
    acceptedTypes: ["application/pdf", "image/png", "image/jpeg"],
    documents: rows.map(row => ({
      id: row.id, kind: row.kind, fileName: row.fileName,
      mimeType: row.mimeType, byteSize: row.byteSize,
      uploadedBy: row.uploadedBy, uploadedAt: row.uploadedAt,
      canRemove: Boolean(row.objectStorageKey && row.sourceType === "upload" &&
        row.sourceKey === null && employeeVaultCanRemove({
          role: authorized.access.role, actorUserId: user.id,
          uploadedByUserId: row.uploadedByUserId,
        })),
    })),
  }, { headers });
}
