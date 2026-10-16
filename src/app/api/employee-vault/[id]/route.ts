import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { removeEmployeeVaultDocument } from "@/lib/employee-vault-document-removal";
import { authorizeEmployeeVault, employeeVaultCanRemove } from "@/lib/employee-vault-profile";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa } from "@/lib/security-request";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/** Removes a file from the active vault, without deleting retained S3 bytes. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!criticalReleaseFlagEnabled("employeeDocumentVault")) {
    return Response.json({ error: "Employee vault is disabled." }, { status: 404, headers });
  }
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers });
  const demoDenied = publicDemoMutationDenied(user.email, "employee document removal");
  if (demoDenied) return demoDenied;
  const { id } = await context.params;
  if (!/^[1-9]\d*$/.test(id)) {
    return Response.json({ error: "Invalid document ID." }, { status: 400, headers });
  }
  const documentId = Number(id);
  if (!Number.isSafeInteger(documentId)) {
    return Response.json({ error: "Invalid document ID." }, { status: 400, headers });
  }
  const [row] = await db.select({
    id: documents.id, employeeId: documents.employeeId,
    organizationId: documents.organizationId, uploadedByUserId: documents.uploadedByUserId,
  }).from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!row || row.employeeId === null) {
    return Response.json({ error: "Document not found." }, { status: 404, headers });
  }
  const authorized = await authorizeEmployeeVault(user, row.organizationId, row.employeeId);
  if (!authorized.ok) return authorized.response;
  if (!employeeVaultCanRemove({
    role: authorized.access.role, actorUserId: user.id,
    uploadedByUserId: row.uploadedByUserId,
  })) {
    return Response.json({ error: "Document removal is outside your role." }, { status: 403, headers });
  }
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "employee-vault-removal", resourceId: documentId,
    limit: 6, windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  try {
    const result = await removeEmployeeVaultDocument({
      documentId, organizationId: row.organizationId, employeeId: row.employeeId,
      actorUserId: user.id, actorName: user.name,
    });
    if (result === "removed") return new Response(null, { status: 204, headers });
    if (result === "not_found") {
      return Response.json({ error: "Document not found." }, { status: 404, headers });
    }
    return Response.json({
      error: result === "linked"
        ? "This file is referenced by an HR record and cannot be removed."
        : "This file is protected from removal.",
      code: "VAULT_REMOVAL_PROTECTED",
    }, { status: 409, headers });
  } catch {
    return Response.json({ error: "Document removal is unavailable." }, { status: 503, headers });
  }
}
