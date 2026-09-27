import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, payrollEntries, payrollRuns } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { renderPayslipPdf } from "@/lib/payslip-pdf";

export const dynamic = "force-dynamic";

type LineItem = { code?: string; label?: string; amount?: number; notes?: string[] };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (session.role !== "employee" || !session.employeeId) {
    return Response.json({ error: "Self-service account required." }, { status: 403 });
  }

  const entryId = Number((await params).id);
  const [entry] = await db.select().from(payrollEntries).where(eq(payrollEntries.id, entryId)).limit(1);

  // Ownership is checked against the session's employee id, never a request parameter.
  if (!entry || entry.employeeId !== session.employeeId) {
    return Response.json({ error: "Payslip not found." }, { status: 404 });
  }

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, entry.payrollRunId)).limit(1);
  const [employee] = await db.select().from(employees).where(eq(employees.id, session.employeeId)).limit(1);
  if (!run || !employee) return Response.json({ error: "Payslip unavailable." }, { status: 404 });

  const peso = (value: number) => `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const items = (Array.isArray(entry.lineItems) ? entry.lineItems : []) as LineItem[];
  const earnings = items.filter((item) => Number(item.amount ?? 0) > 0)
    .map((item) => ({ label: item.label ?? item.code ?? "Earning", amount: peso(Number(item.amount ?? 0)), note: (item.notes ?? []).join(" · ") || undefined }));
  const deductions = items.filter((item) => Number(item.amount ?? 0) < 0)
    .map((item) => ({ label: item.label ?? item.code ?? "Deduction", amount: peso(Math.abs(Number(item.amount ?? 0))), note: (item.notes ?? []).join(" · ") || undefined }));

  const buffer = renderPayslipPdf({
    employerName: "Your employer",
    employeeName: `${employee.firstName} ${employee.lastName}`,
    employeeNo: employee.employeeNo,
    title: employee.title,
    periodLabel: run.periodLabel,
    payDate: run.payDate,
    ruleVersion: run.ruleVersion,
    gross: Number(entry.grossPay),
    deductions: Number(entry.deductions),
    net: Number(entry.netPay),
    lines: earnings,
    contributions: deductions,
    flags: [],
    advisories: [],
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="payslip_${employee.employeeNo}.pdf"`,
    },
  });
}
