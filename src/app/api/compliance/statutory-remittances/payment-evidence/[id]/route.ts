import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { statutoryRemittancePaymentEvidence } from "@/db/schema";
import { getAccess, PAYROLL_OPERATOR_ROLES, roleAllowed } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(organizationId) || !Number.isInteger(id)) {
    return Response.json({ error: "organizationId and evidence id are required." }, { status: 400 });
  }

  const access = await getAccess(user.id, organizationId);
  if (!access || !access.companyWide || !roleAllowed(access.role, PAYROLL_OPERATOR_ROLES)) {
    return Response.json({
      error: "Only company-wide authorized payroll operators can download statutory payment proof.",
    }, { status: 403 });
  }

  const [row] = await db.select().from(statutoryRemittancePaymentEvidence).where(and(
    eq(statutoryRemittancePaymentEvidence.id, id),
    eq(statutoryRemittancePaymentEvidence.organizationId, organizationId),
  )).limit(1);
  if (!row) return Response.json({ error: "Payment proof not found." }, { status: 404 });

  const bytes = Buffer.from(row.fileDataBase64, "base64");
  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Statutory remittance payment proof downloaded",
    resource: row.fileName,
    metadata: {
      evidenceId: row.id,
      batchId: row.batchId,
      fileSha256: row.fileSha256,
      status: row.status,
    },
  });

  return new Response(bytes, {
    headers: {
      "Content-Type": row.mimeType,
      "Content-Disposition": 'attachment; filename="' + row.fileName.replace(/"/g, "") + '"',
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
      "X-Payment-Proof-Sha256": row.fileSha256,
    },
  });
}
