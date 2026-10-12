import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, payslips, payrollEntries, payrollRuns } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeExtendedApi } from "@/lib/public-api-v1-extended";

export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeExtendedApi(request, "payslips:read");
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Invalid payslip." }, { status: 400 });
  const [row] = await db.select({ content: payslips.content, id: payslips.id, payrollRunId: payrollRuns.id })
    .from(payslips)
    .innerJoin(payrollEntries, eq(payslips.payrollEntryId, payrollEntries.id))
    .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
    .innerJoin(employees, and(
      eq(employees.id, payrollEntries.employeeId),
      eq(employees.id, payslips.employeeId),
      eq(employees.organizationId, auth.organizationId),
    ))
    .where(and(
      eq(payslips.id, id),
      eq(payslips.organizationId, auth.organizationId),
      eq(payrollRuns.organizationId, auth.organizationId),
      eq(payrollRuns.legalEntityId, auth.legalEntityId),
      eq(payrollRuns.status, "Released"),
    )).limit(1);
  if (!row) return Response.json({ error: "Payslip not found." }, { status: 404 });
  await recordAuditEvent({
    organizationId: auth.organizationId, actor: `api_key:${auth.keyId}`,
    action: "Payslip accessed via public API", resource: "payslip",
    metadata: { payslipId: row.id, payrollRunId: row.payrollRunId, apiKeyId: auth.keyId },
  });
  return new Response(row.content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename=linaw-payslip-${row.id}.txt`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
