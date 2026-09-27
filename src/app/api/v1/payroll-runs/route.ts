import { count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { payrollRuns } from "@/db/schema";
import { authenticateApiKey, requireScope } from "@/lib/api-auth";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limited = await rateLimitDistributed(`api:${clientIp(request)}`, { limit: 120, windowMs: 60_000 });
  if (!limited.allowed) {
    return Response.json({ error: "Rate limit exceeded (single-instance)." }, { status: 429 });
  }

  const auth = await authenticateApiKey(request);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  if (!requireScope(auth.scopes, "payroll:read")) {
    return Response.json({ error: "API key is missing the payroll:read scope." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? 25)));
  const offset = Math.max(0, Number(searchParams.get("offset") ?? 0));

  const [rows, [{ value: total }]] = await Promise.all([
    db.select().from(payrollRuns).where(eq(payrollRuns.organizationId, auth.organizationId)).orderBy(desc(payrollRuns.id)).limit(limit).offset(offset),
    db.select({ value: count() }).from(payrollRuns).where(eq(payrollRuns.organizationId, auth.organizationId)),
  ]);

  return Response.json({
    object: "list",
    total,
    limit,
    offset,
    hasMore: offset + rows.length < total,
    data: rows.map((row) => ({
      id: row.id,
      period: row.periodLabel,
      scope: row.scopeLabel,
      status: row.status,
      payDate: row.payDate,
      employeeCount: row.employeeCount,
      grossPay: row.grossPay,
      netPay: row.netPay,
      exceptions: row.exceptions,
      ruleVersion: row.ruleVersion,
      progress: { processedChunks: row.processedChunks, totalChunks: row.totalChunks },
    })),
  });
}
