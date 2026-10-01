import { assertOrganizationRole, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { getFilingValidation, regenerateRecordedFile } from "@/lib/filing-evidence-store";

export const dynamic = "force-dynamic";

/**
 * Serves the exact file a record was created for. If the bytes would now be
 * different, it refuses (409): uploading a different file and then marking this
 * record accepted would make the evidence false.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Invalid record id." }, { status: 400 });

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }
  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People or payroll administrators can download government filing files.",
  );
  if (denied) return denied;

  const record = await getFilingValidation(organizationId, id);
  if (!record) return Response.json({ error: "Filing record not found." }, { status: 404 });

  let file;
  try {
    file = await regenerateRecordedFile(record);
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "The filing file could not be regenerated.",
    }, { status: 409 });
  }

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: `${record.agency} ${record.form} filing file downloaded`,
    resource: record.periodLabel,
    metadata: { recordId: record.id, fileSha256: record.fileSha256 },
  });

  return new Response(file.body, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Cache-Control": "no-store",
      "X-Filing-Sha256": record.fileSha256,
    },
  });
}
