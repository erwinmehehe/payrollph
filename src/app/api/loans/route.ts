import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { employeeLoans, employees, loanPayments } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const employeeId = Number(url.searchParams.get("employeeId") ?? 0);

  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });
  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People or payroll administrators can manage employee loans.",
  );
  if (denied) return denied;

  const filter = employeeId > 0
    ? and(eq(employeeLoans.organizationId, organizationId), eq(employeeLoans.employeeId, employeeId))
    : eq(employeeLoans.organizationId, organizationId);

  const loans = await db.select({
    loan: employeeLoans,
    employee: employees,
  })
    .from(employeeLoans)
    .innerJoin(employees, eq(employeeLoans.employeeId, employees.id))
    .where(filter)
    .orderBy(desc(employeeLoans.id));

  const loanIds = loans.map(({ loan }) => loan.id);
  const payments = loanIds.length > 0
    ? await db.select().from(loanPayments).where(inArray(loanPayments.loanId, loanIds)).orderBy(desc(loanPayments.paymentDate))
    : [];

  const paymentsByLoan = new Map<number, typeof payments>();
  for (const p of payments) {
    paymentsByLoan.set(p.loanId, [...(paymentsByLoan.get(p.loanId) ?? []), p]);
  }

  const totalOutstanding = loans
    .filter(({ loan }) => loan.status === "active")
    .reduce((sum, { loan }) => sum + Number(loan.remainingBalance), 0);

  return Response.json({
    loans: loans.map(({ loan, employee }) => ({
      ...loan,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      employeeNo: employee.employeeNo,
      payments: paymentsByLoan.get(loan.id) ?? [],
    })),
    summary: {
      totalActiveLoans: loans.filter(({ loan }) => loan.status === "active").length,
      totalOutstanding: Number(totalOutstanding.toFixed(2)),
      totalPaidOff: loans.filter(({ loan }) => loan.status === "paid_off").length,
    },
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const employeeId = Number(body.employeeId);
  const loanType = String(body.loanType ?? "SSS Salary Loan").trim();
  const referenceNo = String(body.referenceNo ?? "").trim();
  const principal = Number(body.principal);
  const monthlyAmortization = Number(body.monthlyAmortization);
  const cutoffDeduction = Number(body.cutoffDeduction ?? (monthlyAmortization / 2));
  const startDate = String(body.startDate ?? new Date().toISOString().slice(0, 10));
  const endDate = String(body.endDate ?? "");
  const notes = String(body.notes ?? "");

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People or payroll administrators can manage employee loans.",
  );
  if (denied) return denied;

  if (!employeeId || !referenceNo || !Number.isFinite(principal) || principal <= 0 || !Number.isFinite(monthlyAmortization) || monthlyAmortization <= 0) {
    return Response.json({ error: "Employee, reference number, positive principal, and monthly amortization are required." }, { status: 400 });
  }

  const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!employee || employee.organizationId !== organizationId) {
    return Response.json({ error: "Employee not found in this organization." }, { status: 404 });
  }

  const [loan] = await db.insert(employeeLoans).values({
    organizationId,
    employeeId,
    loanType,
    referenceNo,
    principal: principal.toFixed(2),
    monthlyAmortization: monthlyAmortization.toFixed(2),
    cutoffDeduction: cutoffDeduction.toFixed(2),
    remainingBalance: principal.toFixed(2),
    totalPaid: "0.00",
    status: "active",
    startDate,
    endDate: endDate || null,
    notes,
  }).returning();

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Employee loan registered",
    resource: `${employee.firstName} ${employee.lastName} · ${loanType} (${referenceNo})`,
    metadata: { loanId: loan.id, principal, cutoffDeduction },
  });

  return Response.json(loan, { status: 201 });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  const action = String(body.action ?? "update"); // "record_payment", "pause", "resume", "close"
  const manualAmount = Number(body.amount ?? 0);
  const paymentRef = String(body.reference ?? "Manual Payment");

  if (!Number.isInteger(id)) return Response.json({ error: "id is required." }, { status: 400 });

  const [loan] = await db.select().from(employeeLoans).where(eq(employeeLoans.id, id)).limit(1);
  if (!loan) return Response.json({ error: "Loan not found." }, { status: 404 });

  const denied = await assertOrganizationRole(
    user.id,
    loan.organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People or payroll administrators can manage employee loans.",
  );
  if (denied) return denied;

  if (action === "record_payment") {
    if (!Number.isFinite(manualAmount) || manualAmount <= 0) {
      return Response.json({ error: "A positive payment amount is required." }, { status: 400 });
    }

    const remaining = Number(loan.remainingBalance);
    if (manualAmount > remaining + 0.01) {
      return Response.json({ error: "Payment cannot exceed the remaining loan balance." }, { status: 422 });
    }
    const newBal = Math.max(0, remaining - manualAmount);
    const newPaid = Number(loan.totalPaid) + manualAmount;
    const newStatus = newBal <= 0 ? "paid_off" : loan.status;

    await db.insert(loanPayments).values({
      loanId: loan.id,
      amount: manualAmount.toFixed(2),
      paymentDate: new Date().toISOString().slice(0, 10),
      reference: paymentRef,
    });

    const [updated] = await db.update(employeeLoans).set({
      remainingBalance: newBal.toFixed(2),
      totalPaid: newPaid.toFixed(2),
      status: newStatus,
    }).where(eq(employeeLoans.id, loan.id)).returning();

    await recordAuditEvent({
      organizationId: loan.organizationId,
      actor: user.name,
      action: "Manual loan payment recorded",
      resource: `${loan.loanType} #${loan.referenceNo}`,
      metadata: { amount: manualAmount, newBalance: newBal },
    });

    return Response.json(updated);
  }

  if (action === "pause" || action === "resume") {
    const status = action === "pause" ? "paused" : "active";
    const [updated] = await db.update(employeeLoans).set({ status }).where(eq(employeeLoans.id, loan.id)).returning();
    return Response.json(updated);
  }

  if (action === "close") {
    const [updated] = await db.update(employeeLoans).set({ status: "paid_off" }).where(eq(employeeLoans.id, loan.id)).returning();
    return Response.json(updated);
  }

  return Response.json({ error: "Unknown loan action." }, { status: 400 });
}
