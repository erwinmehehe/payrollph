import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { payrollRuns } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeExtendedV1Read, validApiV1DateOnly } from "@/lib/api-v1-extended";
import { buildReleasedPayrollJournal, payrollJournalToCsv } from "@/lib/payroll-journal-export";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const gate = await authorizeExtendedV1Read(request, "payroll:read");
  if (!gate.ok) return gate.response;
  const params = new URL(request.url).searchParams;
  const startDate = params.get("startDate") ?? "";
  const endDate = params.get("endDate") ?? "";
  if (!validApiV1DateOnly(startDate) || !validApiV1DateOnly(endDate)
    || endDate < startDate
    || Date.parse(endDate + "T00:00:00Z") - Date.parse(startDate + "T00:00:00Z") > 366 * 86_400_000) {
    return Response.json({ error: "Use a valid date window of at most 366 days." }, { status: 400 });
  }
  const legalEntityIdText = params.get("legalEntityId");
  const legalEntityId = legalEntityIdText === null ? null : Number(legalEntityIdText);
  if (legalEntityId !== null && (!Number.isSafeInteger(legalEntityId) || legalEntityId < 1)) {
    return Response.json({ error: "Invalid legalEntityId." }, { status: 400 });
  }
  const rows = await db.select({
    id: payrollRuns.id, organizationId: payrollRuns.organizationId,
    legalEntityId: payrollRuns.legalEntityId, status: payrollRuns.status,
    payDate: payrollRuns.payDate, periodLabel: payrollRuns.periodLabel,
    grossPay: payrollRuns.grossPay, netPay: payrollRuns.netPay,
  }).from(payrollRuns).where(and(
    eq(payrollRuns.organizationId, gate.auth.organizationId),
    eq(payrollRuns.status, "Released"),
    gte(payrollRuns.payDate, startDate), lte(payrollRuns.payDate, endDate),
    legalEntityId !== null ? eq(payrollRuns.legalEntityId, legalEntityId) : undefined,
  )).orderBy(asc(payrollRuns.id)).limit(2_001);
  let csv: string;
  let lineCount: number;
  try {
    const lines = buildReleasedPayrollJournal(rows);
    lineCount = lines.length;
    csv = payrollJournalToCsv(lines);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Journal export failed." }, { status: 409 });
  }
  await recordAuditEvent({
    organizationId: gate.auth.organizationId, actor: `api_key:${gate.auth.keyId}`,
    action: "API payroll accounting journal exported", resource: "payroll-journal",
    metadata: { startDate, endDate, legalEntityId, runCount: rows.length, lineCount },
  });
  return new Response(csv, { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": "attachment; filename=linaw-payroll-journal.csv",
    "Cache-Control": "no-store",
  } });
}
