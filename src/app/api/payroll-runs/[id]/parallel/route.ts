import { eq } from "drizzle-orm";
import { db } from "@/db";
import { parallelPayrollRows, payrollRuns } from "@/db/schema";
import { assertMembership, getAccess } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function context(id: string, userId: number) {
  const runId = Number(id);
  if (!Number.isInteger(runId)) return { error: Response.json({ error: "Invalid run id." }, { status: 400 }) };

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) return { error: Response.json({ error: "Payroll run not found." }, { status: 404 }) };

  const denied = await assertMembership(userId, run.organizationId);
  if (denied) return { error: denied };

  const access = await getAccess(userId, run.organizationId);
  if (!access || access.role === "employee") {
    return {
      error: Response.json(
        { error: "Parallel Payroll requires a payroll or administrative workspace role." },
        { status: 403 },
      ),
    };
  }

  return { runId, run };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const { id } = await params;
  const resolved = await context(id, user.id);
  if ("error" in resolved) return resolved.error;

  const rows = await db
    .select()
    .from(parallelPayrollRows)
    .where(eq(parallelPayrollRows.payrollRunId, resolved.runId));

  return Response.json({
    sourceName: rows[0]?.sourceName ?? null,
    importedBy: rows[0]?.importedBy ?? null,
    importedAt: rows[0]?.createdAt ?? null,
    rows: rows.map((row) => ({
      employeeNo: row.employeeNo,
      name: row.employeeName ?? undefined,
      netPay: Number(row.netPay),
      withholdingTax: row.withholdingTax == null ? null : Number(row.withholdingTax),
    })),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const { id } = await params;
  const resolved = await context(id, user.id);
  if ("error" in resolved) return resolved.error;
  if (resolved.run.status === "Released") {
    return Response.json({ error: "Released payroll cannot accept a new Parallel Payroll reference." }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const sourceName = String(body.sourceName ?? "Imported payroll").trim().slice(0, 180) || "Imported payroll";
  const inputRows = Array.isArray(body.rows) ? body.rows : [];

  if (!inputRows.length) {
    return Response.json({ error: "At least one reference payroll row is required." }, { status: 400 });
  }
  if (inputRows.length > 5_000) {
    return Response.json({ error: "Parallel Payroll accepts up to 5,000 rows per import." }, { status: 413 });
  }

  const rows = inputRows.map((raw: unknown, index: number) => {
    const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const employeeNo = String(row.employeeNo ?? "").trim().slice(0, 64);
    const employeeName = String(row.name ?? "").trim().slice(0, 180);
    const netPay = Number(row.netPay);
    const withholding = row.withholdingTax == null || row.withholdingTax === "" ? null : Number(row.withholdingTax);

    if (!employeeNo && !employeeName) {
      throw new Error(`Row ${index + 1} is missing employeeNo/name.`);
    }
    if (!Number.isFinite(netPay)) {
      throw new Error(`Row ${index + 1} has an invalid netPay.`);
    }
    if (withholding !== null && !Number.isFinite(withholding)) {
      throw new Error(`Row ${index + 1} has an invalid withholdingTax.`);
    }

    return {
      organizationId: resolved.run.organizationId,
      payrollRunId: resolved.runId,
      sourceName,
      employeeNo,
      employeeName: employeeName || null,
      netPay: netPay.toFixed(2),
      withholdingTax: withholding === null ? null : withholding.toFixed(2),
      importedBy: user.name,
    };
  });

  try {
    await db.transaction(async (tx) => {
      await tx.delete(parallelPayrollRows).where(eq(parallelPayrollRows.payrollRunId, resolved.runId));
      for (let offset = 0; offset < rows.length; offset += 500) {
        await tx.insert(parallelPayrollRows).values(rows.slice(offset, offset + 500));
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Row ")) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  await recordAuditEvent({
    organizationId: resolved.run.organizationId,
    actor: user.name,
    action: "Parallel Payroll imported",
    resource: resolved.run.periodLabel,
    metadata: {
      runId: resolved.runId,
      sourceName,
      rows: rows.length,
    },
  });

  return Response.json({ ok: true, sourceName, rows: rows.length });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const { id } = await params;
  const resolved = await context(id, user.id);
  if ("error" in resolved) return resolved.error;
  if (resolved.run.status === "Released") {
    return Response.json({ error: "Released payroll comparison history cannot be cleared." }, { status: 409 });
  }

  await db.delete(parallelPayrollRows).where(eq(parallelPayrollRows.payrollRunId, resolved.runId));

  await recordAuditEvent({
    organizationId: resolved.run.organizationId,
    actor: user.name,
    action: "Parallel Payroll reference cleared",
    resource: resolved.run.periodLabel,
    metadata: { runId: resolved.runId },
  });

  return Response.json({ ok: true });
}
