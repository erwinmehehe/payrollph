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

  const [document] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!document) return Response.json({ error: "Document not found." }, { status: 404 });

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

  if (!document.scannedClean && process.env.NODE_ENV === "production") {
    return Response.json({
      error: "This document is not available because malware scanning has not verified it as clean.",
    }, { status: 409 });
  }

  const body = Buffer.from(document.content, "base64");
  if (document.sourceType === "generated") {
    const sha256 = createHash("sha256").update(body).digest("hex");
    if (sha256 !== document.sha256) {
      return Response.json({
        error: "Generated document integrity verification failed.",
      }, { status: 409 });
    }
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
