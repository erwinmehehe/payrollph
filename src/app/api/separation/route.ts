import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { employeeLoans, employees, payrollEntries, payrollRuns, separationRecords } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertMembership, canManageSeparation, getAccess } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { calculateFinalPay } from "@/lib/final-pay";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId") ?? 1);
  const employeeId = Number(url.searchParams.get("employeeId") ?? 0);

  const denied = await assertMembership(user.id, organizationId);
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!canManageSeparation(access)) {
    return Response.json({ error: "Separation and final-pay operations require an owner, admin, bookkeeper, HR, or payroll role." }, { status: 403 });
  }

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
 * Computes a reviewable final-pay package from released payroll history:
 * 1. Prorated 13th month from actual BASIC lines already released in the tax year.
 * 2. Explicit leave conversion with a selected tax treatment.
 * 3. Annualized withholding settlement (additional withholding or refund).
 * 4. Outstanding active loan balances.
 * 5. A trace in the audit event so HR/payroll can review the basis before approval.
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
  const unusedLeaveTaxTreatment =
    body.unusedLeaveTaxTreatment === "non_taxable" ? "non_taxable" : "taxable";
  const unpaidBasic = Number(body.unpaidBasic ?? 0);
  const otherTaxableEarnings = Number(body.otherTaxableEarnings ?? 0);
  const nonTaxableEarnings = Number(body.nonTaxableEarnings ?? 0);
  const priorEmployerTaxable = Number(body.priorEmployerTaxable ?? 0);
  const priorEmployerTaxWithheld = Number(body.priorEmployerTaxWithheld ?? 0);

  const denied = await assertMembership(user.id, organizationId);
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!canManageSeparation(access)) {
    return Response.json({ error: "Separation and final-pay operations require an owner, admin, bookkeeper, HR, or payroll role." }, { status: 403 });
  }

  const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!employee || employee.organizationId !== organizationId) {
    return Response.json({ error: "Employee not found in this organization." }, { status: 404 });
  }

  const lastDate = new Date(`${lastDay}T12:00:00Z`);
  if (Number.isNaN(lastDate.getTime())) {
    return Response.json({ error: "lastDay must be a valid date." }, { status: 400 });
  }
  const taxYear = lastDate.getUTCFullYear();
  const yearStart = `${taxYear}-01-01`;

  const releasedRuns = await db
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.organizationId, organizationId), eq(payrollRuns.status, "Released")));
  const eligibleRunIds = releasedRuns
    .filter((run) => run.payDate >= yearStart && run.payDate <= lastDay)
    .map((run) => run.id);

  const history = eligibleRunIds.length
    ? await db
        .select()
        .from(payrollEntries)
        .where(and(eq(payrollEntries.employeeId, employeeId), inArray(payrollEntries.payrollRunId, eligibleRunIds)))
    : [];

  const monthlyBasic = Number(employee.basicRate);
  const dailyRate = monthlyBasic / 22;
  const leaveMonetizationPay = Number((Math.max(0, unusedLeaveCredits) * dailyRate).toFixed(2));

  const loans = await db.select().from(employeeLoans).where(
    and(eq(employeeLoans.organizationId, organizationId), eq(employeeLoans.employeeId, employeeId), eq(employeeLoans.status, "active")),
  );
  const loanDeductions = Number(loans.reduce((sum, l) => sum + Number(l.remainingBalance), 0).toFixed(2));

  const finalPay = calculateFinalPay({
    history,
    unpaidBasic,
    otherTaxableEarnings,
    nonTaxableEarnings,
    unusedLeaveConversion: leaveMonetizationPay,
    unusedLeaveTaxTreatment,
    otherDeductions: loanDeductions,
    priorEmployerTaxable,
    priorEmployerTaxWithheld,
    mwe: employee.mwe,
  });

  if (!history.length) {
    return Response.json({
      error: "No released payroll history exists for this employee in the separation tax year. Final pay cannot be annualized safely yet.",
    }, { status: 409 });
  }

  const prorated13th = finalPay.thirteenthMonth.gross;
  const netFinalPay = finalPay.netFinalPay;

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
    prorated13thMonth: prorated13th.toFixed(2),
    unusedLeaveCredits: unusedLeaveCredits.toFixed(1),
    leaveMonetizationPay: leaveMonetizationPay.toFixed(2),
    taxAdjustment: finalPay.taxSettlement.toFixed(2),
    loanDeductions: loanDeductions.toFixed(2),
    netFinalPay: netFinalPay.toFixed(2),
    status: "draft",
    coeIssued: false,
  }).returning();

  // Mark employee status as Separating
  await db.update(employees).set({ status: "Separating" }).where(eq(employees.id, employeeId));

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Separation and Final Pay computed",
    resource: `${employee.firstName} ${employee.lastName} (Final Pay: ₱${netFinalPay.toFixed(2)})`,
    metadata: {
      separationId: created.id,
      taxYear,
      releasedPeriods: finalPay.releasedPeriods,
      ytdGross: finalPay.ytdGross,
      ytdTaxable: finalPay.ytdTaxable,
      ytdTaxWithheld: finalPay.ytdTaxWithheld,
      basicSalaryEarnedYtd: finalPay.basicSalaryEarnedYtd,
      thirteenthPaidYtd: finalPay.thirteenthPaidYtd,
      prorated13th,
      taxable13th: finalPay.thirteenthMonth.taxable,
      leaveMonetizationPay,
      unusedLeaveTaxTreatment,
      annualTaxable: finalPay.annualTaxable,
      annualTax: finalPay.annualTax,
      taxToWithhold: finalPay.taxToWithhold,
      taxRefund: finalPay.taxRefund,
      taxSettlement: finalPay.taxSettlement,
      loanDeductions,
      netFinalPay,
      amountDueFromEmployee: finalPay.amountDueFromEmployee,
      warnings: finalPay.warnings,
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

  const denied = await assertMembership(user.id, sep.organizationId);
  if (denied) return denied;
  const access = await getAccess(user.id, sep.organizationId);
  if (!canManageSeparation(access)) {
    return Response.json({ error: "Separation and final-pay operations require an owner, admin, bookkeeper, HR, or payroll role." }, { status: 403 });
  }

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
