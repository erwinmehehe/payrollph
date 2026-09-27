import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { employeeLoans, employees, leaveBalances, organizations, payrollEntries, payrollRuns, separationRecords } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertPermission } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { computeFinalPayDraft } from "@/lib/final-pay";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId") ?? 1);
  const employeeId = Number(url.searchParams.get("employeeId") ?? 0);

  const denied = await assertPermission(user.id, organizationId, "hr:read");
  if (denied) return denied;

  const filter = employeeId > 0
    ? and(eq(separationRecords.organizationId, organizationId), eq(separationRecords.employeeId, employeeId))
    : eq(separationRecords.organizationId, organizationId);

  const records = await db.select({
    sep: separationRecords,
    employee: employees,
  })
    .from(separationRecords)
    .innerJoin(employees, eq(separationRecords.employeeId, employees.id))
    .where(filter)
    .orderBy(desc(separationRecords.id));

  return Response.json({
    separations: records.map(({ sep, employee }) => ({
      ...sep,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      employeeNo: employee.employeeNo,
      employeeTitle: employee.title,
      basicRate: employee.basicRate,
      hireDate: employee.startDate,
    })),
  });
}

/**
 * Creates or computes Final Pay for a separating employee.
 * Builds a final-pay draft for HR/finance review; final tax and timing must be validated against the complete separation facts:
 * 1. Prorated 13th month pay = Basic earned from Jan 1 to Last Day / 12
 * 2. Unused leave credit monetization = Unused days * ((Monthly Basic * 12) / company annual payroll divisor)
 * 3. Withholding tax adjustment (refund/collection)
 * 4. Less: Active loan balances
 * 5. Computes net final pay
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId ?? 1);
  const employeeId = Number(body.employeeId);
  const separationType = String(body.separationType ?? "resignation");
  const noticeDate = String(body.noticeDate ?? new Date().toISOString().slice(0, 10));
  const lastDay = String(body.lastDay ?? new Date().toISOString().slice(0, 10));
  const unusedLeaveCredits = Number(body.unusedLeaveCredits ?? 0);
  const previousEmployerTaxableCompensation = Number(body.previousEmployerTaxableCompensation ?? 0);
  const previousEmployerTaxWithheld = Number(body.previousEmployerTaxWithheld ?? 0);
  const additionalTaxablePay = Number(body.additionalTaxablePay ?? 0);
  const additionalNonTaxablePay = Number(body.additionalNonTaxablePay ?? 0);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDay) || Number.isNaN(Date.parse(`${lastDay}T12:00:00Z`))) {
    return Response.json({ error: "A valid last day is required." }, { status: 400 });
  }
  for (const [label, value] of [
    ["unused leave credits", unusedLeaveCredits],
    ["previous-employer taxable compensation", previousEmployerTaxableCompensation],
    ["previous-employer tax withheld", previousEmployerTaxWithheld],
    ["additional taxable pay", additionalTaxablePay],
    ["additional non-taxable pay", additionalNonTaxablePay],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      return Response.json({ error: `${label} must be a non-negative number.` }, { status: 400 });
    }
  }

  const denied = await assertPermission(user.id, organizationId, "hr:manage");
  if (denied) return denied;

  const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!employee || employee.organizationId !== organizationId) {
    return Response.json({ error: "Employee not found in this organization." }, { status: 404 });
  }

  const lastDate = new Date(`${lastDay}T12:00:00Z`);
  const taxYear = lastDate.getUTCFullYear();
  const yearStart = `${taxYear}-01-01`;

  // Termination annualization uses compensation actually paid by this employer
  // during the calendar year through the employee's last day. Draft-only
  // adjustments for unpaid salary or reviewed separation/retirement amounts
  // can be entered explicitly below instead of being inferred from separation type.
  const releasedEntries = await db.select({
    grossPay: payrollEntries.grossPay,
    lineItems: payrollEntries.lineItems,
  })
    .from(payrollEntries)
    .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
    .where(and(
      eq(payrollEntries.employeeId, employeeId),
      eq(payrollRuns.organizationId, organizationId),
      eq(payrollRuns.status, "Released"),
      gte(payrollRuns.payDate, yearStart),
      lte(payrollRuns.payDate, lastDay),
    ))
    .orderBy(asc(payrollRuns.payDate));

  const [organization] = await db.select({
    payrollAnnualDivisor: organizations.payrollAnnualDivisor,
  }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  const annualPayDivisor = Number(organization?.payrollAnnualDivisor ?? 365);

  const loans = await db.select().from(employeeLoans).where(
    and(
      eq(employeeLoans.organizationId, organizationId),
      eq(employeeLoans.employeeId, employeeId),
      eq(employeeLoans.status, "active"),
    ),
  );
  const loanDeductions = Number(loans.reduce((sum, loan) => sum + Number(loan.remainingBalance), 0).toFixed(2));

  const finalPay = computeFinalPayDraft({
    entries: releasedEntries,
    monthlyBasic: Number(employee.basicRate),
    annualPayDivisor,
    unusedLeaveCredits,
    loanDeductions,
    mwe: employee.mwe,
    previousEmployerTaxableCompensation,
    previousEmployerTaxWithheld,
    additionalTaxablePay,
    additionalNonTaxablePay,
  });

  const [created] = await db.insert(separationRecords).values({
    organizationId,
    employeeId,
    separationType,
    noticeDate,
    lastDay,
    clearanceStatus: "in_progress",
    itCleared: false,
    adminCleared: false,
    financeCleared: false,
    hrCleared: false,
    prorated13thMonth: finalPay.prorated13thDue.toFixed(2),
    unusedLeaveCredits: unusedLeaveCredits.toFixed(1),
    leaveMonetizationPay: finalPay.leaveMonetizationPay.toFixed(2),
    taxAdjustment: finalPay.taxCashEffect.toFixed(2),
    loanDeductions: finalPay.loanDeductions.toFixed(2),
    netFinalPay: finalPay.netFinalPay.toFixed(2),
    finalPayBreakdown: finalPay,
    status: "draft",
    coeIssued: false,
  }).returning();

  // Mark employee status as Separating
  await db.update(employees).set({ status: "Separating" }).where(eq(employees.id, employeeId));

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Separation and Final Pay computed",
    resource: `${employee.firstName} ${employee.lastName} (Final Pay: ₱${finalPay.netFinalPay.toFixed(2)})`,
    metadata: {
      separationId: created.id,
      taxYear,
      releasedPayrollEntries: releasedEntries.length,
      annualPayDivisor,
      finalPay,
    },
  });

  return Response.json(created, { status: 201 });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  const action = String(body.action ?? "clearance"); // "clearance", "approve", "release", "issue_coe"

  if (!Number.isInteger(id)) return Response.json({ error: "id is required." }, { status: 400 });

  const [sep] = await db.select().from(separationRecords).where(eq(separationRecords.id, id)).limit(1);
  if (!sep) return Response.json({ error: "Separation record not found." }, { status: 404 });

  const permission = action === "approve" ? "payroll:approve" : "hr:manage";
  const denied = await assertPermission(user.id, sep.organizationId, permission);
  if (denied) return denied;

  if (action === "clearance") {
    const itCleared = body.itCleared !== undefined ? Boolean(body.itCleared) : sep.itCleared;
    const adminCleared = body.adminCleared !== undefined ? Boolean(body.adminCleared) : sep.adminCleared;
    const financeCleared = body.financeCleared !== undefined ? Boolean(body.financeCleared) : sep.financeCleared;
    const hrCleared = body.hrCleared !== undefined ? Boolean(body.hrCleared) : sep.hrCleared;
    const allCleared = itCleared && adminCleared && financeCleared && hrCleared;

    const [updated] = await db.update(separationRecords).set({
      itCleared,
      adminCleared,
      financeCleared,
      hrCleared,
      clearanceStatus: allCleared ? "cleared" : "in_progress",
    }).where(eq(separationRecords.id, id)).returning();

    return Response.json(updated);
  }

  if (action === "approve") {
    const [updated] = await db.update(separationRecords).set({
      status: "approved",
    }).where(eq(separationRecords.id, id)).returning();

    return Response.json(updated);
  }

  if (action === "issue_coe") {
    const [updated] = await db.update(separationRecords).set({
      coeIssued: true,
    }).where(eq(separationRecords.id, id)).returning();

    return Response.json(updated);
  }

  return Response.json({ error: "Unknown action." }, { status: 400 });
}
