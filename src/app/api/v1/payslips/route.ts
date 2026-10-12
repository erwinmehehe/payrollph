import { and, asc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { employees, payslips, payrollEntries, payrollRuns } from "@/db/schema";
import { authorizeExtendedApi, pagination } from "@/lib/public-api-v1-extended";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await authorizeExtendedApi(request, "payslips:read");
  if (!auth.ok) return auth.response;
  const page = pagination(new URL(request.url), 100);
  if (!page) return Response.json({ error: "Invalid limit or after cursor." }, { status: 400 });
  const rows = await db.select({
    id: payslips.id, employeeId: payslips.employeeId,
    payrollRunId: payrollRuns.id, periodLabel: payslips.periodLabel,
    ruleVersion: payslips.ruleVersion, issuedAt: payslips.createdAt,
  }).from(payslips)
    .innerJoin(payrollEntries, eq(payslips.payrollEntryId, payrollEntries.id))
    .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
    .innerJoin(employees, and(
      eq(employees.id, payrollEntries.employeeId),
      eq(employees.id, payslips.employeeId),
      eq(employees.organizationId, auth.organizationId),
    ))
    .where(and(
      eq(payslips.organizationId, auth.organizationId),
      eq(payrollRuns.organizationId, auth.organizationId),
      eq(payrollRuns.legalEntityId, auth.legalEntityId),
      eq(payrollRuns.status, "Released"),
      gt(payslips.id, page.after),
    )).orderBy(asc(payslips.id)).limit(page.limit + 1);
  const selected = rows.slice(0, page.limit);
  return Response.json({
    object: "list", data: selected, hasMore: rows.length > page.limit,
    nextCursor: rows.length > page.limit ? selected[selected.length - 1]?.id ?? null : null,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
