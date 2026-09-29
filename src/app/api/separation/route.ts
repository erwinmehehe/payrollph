import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  employeeLoans,
  employeePayProfiles,
  employeePayRateChanges,
  employees,
  payrollEntries,
  payrollRuns,
  separationRecords,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { computeThirteenthMonthPay } from "@/lib/ph-compliance";
import { buildEmployeeYearLedger } from "@/lib/compensation-ledger";
import { ensureEmployeePayHistory } from "@/lib/pay-basis-schema";
import { effectiveProfileAt, round2 } from "@/lib/pay-history";

export const dynamic = "force-dynamic";

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

function addCalendarDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function money(value: number) {
  return round2(value).toFixed(2);
}

function asBreakdown(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

async function latestReleasedPayrollThrough(input: {
  organizationId: number;
  employeeId: number;
  lastDay: string;
}) {
  const runs = await db.select().from(payrollRuns).where(and(
    eq(payrollRuns.organizationId, input.organizationId),
    eq(payrollRuns.status, "Released"),
    lte(payrollRuns.periodEnd, input.lastDay),
  )).orderBy(desc(payrollRuns.periodEnd));

  if (runs.length === 0) return null;
  const runIds = runs.map((run) => run.id);
  const entries = await db.select({ payrollRunId: payrollEntries.payrollRunId })
    .from(payrollEntries)
    .where(and(
      eq(payrollEntries.employeeId, input.employeeId),
      inArray(payrollEntries.payrollRunId, runIds),
    ));
  const employeeRunIds = new Set(entries.map((entry) => entry.payrollRunId));
  return runs.find((run) => employeeRunIds.has(run.id))?.periodEnd ?? null;
}

async function effectivePayProfile(input: {
  organizationId: number;
  employeeId: number;
  lastDay: string;
}) {
  await ensureEmployeePayHistory(input.organizationId);
  const [current] = await db.select().from(employeePayProfiles)
    .where(eq(employeePayProfiles.employeeId, input.employeeId))
    .limit(1);
  if (!current) throw new Error("Employee pay profile is missing.");

  const changes = await db.select().from(employeePayRateChanges)
    .where(and(
      eq(employeePayRateChanges.organizationId, input.organizationId),
      eq(employeePayRateChanges.employeeId, input.employeeId),
      lte(employeePayRateChanges.effectiveFrom, input.lastDay),
    ));

  return effectiveProfileAt({
    fallback: {
      payBasis: current.payBasis,
      rateAmount: current.rateAmount,
      standardWorkDaysPerMonth: current.standardWorkDaysPerMonth,
      standardHoursPerDay: current.standardHoursPerDay,
    },
    changes: changes.map((change) => ({
      id: change.id,
      effectiveFrom: String(change.effectiveFrom),
      payBasis: change.payBasis,
      rateAmount: change.rateAmount,
      standardWorkDaysPerMonth: change.standardWorkDaysPerMonth,
      standardHoursPerDay: change.standardHoursPerDay,
    })),
    date: input.lastDay,
  });
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId") ?? 1);
  const employeeId = Number(url.searchParams.get("employeeId") ?? 0);

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Your role is not allowed to manage this HR workflow.",
  );
  if (denied) return denied;

  await ensureEmployeePayHistory(organizationId);

  const filter = employeeId > 0
    ? and(eq(separationRecords.organizationId, organizationId), eq(separationRecords.employeeId, employeeId))
    : eq(separationRecords.organizationId, organizationId);

  const records = await db.select({
    sep: separationRecords,
    employee: employees,
    payProfile: employeePayProfiles,
  })
    .from(separationRecords)
    .innerJoin(employees, eq(separationRecords.employeeId, employees.id))
    .leftJoin(employeePayProfiles, eq(employees.id, employeePayProfiles.employeeId))
    .where(filter)
    .orderBy(desc(separationRecords.id));

  return Response.json({
    separations: records.map(({ sep, employee, payProfile }) => ({
      ...sep,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      employeeNo: employee.employeeNo,
      employeeTitle: employee.title,
      basicRate: employee.basicRate,
      payBasis: payProfile?.payBasis ?? "monthly",
      payRate: payProfile?.rateAmount ?? employee.basicRate,
      hireDate: employee.startDate,
    })),
  });
}

/**
 * Creates a reviewable final-pay package from actual payroll history.
 *
 * The computation intentionally fails closed when migrated payroll lacks
 * basic-salary-earned data or when released Linaw payroll does not reach the
 * last day and the operator has not supplied the unpaid basic salary.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const employeeId = Number(body.employeeId);
  const separationType = String(body.separationType ?? "resignation");
  const noticeDate = String(body.noticeDate ?? "");
  const lastDay = String(body.lastDay ?? "");
  const unusedLeaveCredits = Number(body.unusedLeaveCredits ?? 0);
  const hasUnpaidBasicSalary =
    body.unpaidBasicSalary !== undefined &&
    body.unpaidBasicSalary !== null &&
    String(body.unpaidBasicSalary).trim() !== "";
  const unpaidBasicSalary = hasUnpaidBasicSalary ? Number(body.unpaidBasicSalary) : 0;
  const taxAdjustment = Number(body.taxAdjustment ?? 0);
  const taxReviewed = Boolean(body.taxReviewed);
  const deductOutstandingLoans = body.deductOutstandingLoans === true;

  if (!Number.isInteger(organizationId) || !Number.isInteger(employeeId)) {
    return Response.json({ error: "organizationId and employeeId are required." }, { status: 400 });
  }
  if (!isIsoDate(noticeDate) || !isIsoDate(lastDay) || noticeDate > lastDay) {
    return Response.json({ error: "Notice date and last day must be valid YYYY-MM-DD dates, with notice date on or before last day." }, { status: 400 });
  }
  if (!Number.isFinite(unusedLeaveCredits) || unusedLeaveCredits < 0) {
    return Response.json({ error: "Unused leave credits must be zero or greater." }, { status: 400 });
  }
  if (hasUnpaidBasicSalary && (!Number.isFinite(unpaidBasicSalary) || unpaidBasicSalary < 0)) {
    return Response.json({ error: "Unpaid basic salary must be zero or greater." }, { status: 400 });
  }
  if (!Number.isFinite(taxAdjustment)) {
    return Response.json({ error: "Tax adjustment must be a valid amount." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Your role is not allowed to manage this HR workflow.",
  );
  if (denied) return denied;

  const [employee] = await db.select().from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId)))
    .limit(1);
  if (!employee) {
    return Response.json({ error: "Employee not found in this organization." }, { status: 404 });
  }
  if (lastDay < String(employee.startDate)) {
    return Response.json({ error: "Last day cannot be before the employee start date." }, { status: 400 });
  }

  const previous = await db.select().from(separationRecords)
    .where(and(
      eq(separationRecords.organizationId, organizationId),
      eq(separationRecords.employeeId, employeeId),
    ))
    .orderBy(desc(separationRecords.id))
    .limit(1);
  if (previous[0] && previous[0].status !== "released") {
    return Response.json({
      error: "This employee already has an open separation package. Finish or correct that record instead of creating another one.",
      separationId: previous[0].id,
    }, { status: 409 });
  }

  await ensureEmployeePayHistory(organizationId);
  const taxYear = Number(lastDay.slice(0, 4));
  const ledger = await buildEmployeeYearLedger({
    organizationId,
    employeeId,
    taxYear,
    throughDate: lastDay,
  });

  if (!ledger.dataComplete) {
    return Response.json({
      error: "Final pay cannot be calculated from incomplete migrated payroll history. Add Basic Salary Earned to the affected payroll-history rows and re-import them.",
      missingImportedBasicRows: ledger.importedBasicSalaryMissing,
      employeeNo: employee.employeeNo,
    }, { status: 422 });
  }

  const coveredThrough = await latestReleasedPayrollThrough({
    organizationId,
    employeeId,
    lastDay,
  });
  const requiresUnpaidBasicSalary = coveredThrough !== lastDay;
  if (requiresUnpaidBasicSalary && !hasUnpaidBasicSalary) {
    return Response.json({
      error: "Released payroll does not cover the employee through the last day. Enter the unpaid basic salary still due after the latest released cutoff.",
      requiresUnpaidBasicSalary: true,
      latestReleasedPayrollThrough: coveredThrough,
      lastDay,
    }, { status: 422 });
  }

  const payProfile = await effectivePayProfile({ organizationId, employeeId, lastDay });
  const basicSalaryEarnedYtd = round2(ledger.basicSalaryEarned + unpaidBasicSalary);
  const thirteenthAccrued = computeThirteenthMonthPay(basicSalaryEarnedYtd);
  const thirteenthDue = round2(Math.max(0, thirteenthAccrued - ledger.thirteenthMonthPreviouslyPaid));
  const leaveMonetizationPay = round2(unusedLeaveCredits * payProfile.dailyRate);

  const loans = await db.select().from(employeeLoans).where(and(
    eq(employeeLoans.organizationId, organizationId),
    eq(employeeLoans.employeeId, employeeId),
    eq(employeeLoans.status, "active"),
  ));
  const outstandingLoanBalance = round2(
    loans.reduce((sum, loan) => sum + Math.max(0, Number(loan.remainingBalance)), 0),
  );
  const loanDeductions = deductOutstandingLoans ? outstandingLoanBalance : 0;

  const finalPayBeforeFloor = round2(
    unpaidBasicSalary +
    thirteenthDue +
    leaveMonetizationPay +
    taxAdjustment -
    loanDeductions
  );
  const netFinalPay = round2(Math.max(0, finalPayBeforeFloor));
  const employeeBalanceDue = round2(Math.max(0, -finalPayBeforeFloor));
  const finalPayDueDate = addCalendarDays(lastDay, 30);

  const breakdown = {
    rule: "actual-basic-salary-ledger",
    taxYear,
    sourceDataComplete: true,
    releasedPayrollPeriods: ledger.releasedPeriods,
    importedPayrollPeriods: ledger.importedPeriods,
    latestReleasedPayrollThrough: coveredThrough,
    unpaidBasicSalary,
    basicSalaryEarnedYtd,
    thirteenthMonthAccrued: thirteenthAccrued,
    thirteenthMonthPreviouslyPaid: ledger.thirteenthMonthPreviouslyPaid,
    thirteenthMonthDue: thirteenthDue,
    payBasisAtSeparation: payProfile.payBasis,
    rateAtSeparation: payProfile.rateAmount,
    dailyRateAtSeparation: round2(payProfile.dailyRate),
    unusedLeaveCredits,
    leaveMonetizationPay,
    outstandingLoanBalance,
    deductOutstandingLoans,
    loanDeductions,
    taxAdjustment,
    taxReviewed,
    taxReviewRequired: !taxReviewed,
    netFinalPay,
    employeeBalanceDue,
    finalPayDueDate,
  };

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
    prorated13thMonth: money(thirteenthDue),
    unpaidSalary: money(unpaidBasicSalary),
    basicSalaryEarnedYtd: money(basicSalaryEarnedYtd),
    thirteenthMonthPreviouslyPaid: money(ledger.thirteenthMonthPreviouslyPaid),
    finalPayDueDate,
    finalPayBreakdown: breakdown,
    unusedLeaveCredits: unusedLeaveCredits.toFixed(1),
    leaveMonetizationPay: money(leaveMonetizationPay),
    taxAdjustment: money(taxAdjustment),
    loanDeductions: money(loanDeductions),
    netFinalPay: money(netFinalPay),
    status: "draft",
    coeIssued: false,
  }).returning();

  await db.update(employees).set({ status: "Separating" }).where(eq(employees.id, employeeId));

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Separation final pay package computed",
    resource: `${employee.firstName} ${employee.lastName} (Final Pay: ₱${money(netFinalPay)})`,
    metadata: {
      separationId: created.id,
      finalPayDueDate,
      basicSalaryEarnedYtd,
      thirteenthAccrued,
      thirteenthPreviouslyPaid: ledger.thirteenthMonthPreviouslyPaid,
      thirteenthDue,
      unpaidBasicSalary,
      leaveMonetizationPay,
      loanDeductions,
      taxReviewed,
      netFinalPay,
    },
  });

  return Response.json({
    ...created,
    calculation: breakdown,
  }, { status: 201 });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  const action = String(body.action ?? "clearance");

  if (!Number.isInteger(id)) return Response.json({ error: "id is required." }, { status: 400 });

  const [sep] = await db.select().from(separationRecords).where(eq(separationRecords.id, id)).limit(1);
  if (!sep) return Response.json({ error: "Separation record not found." }, { status: 404 });

  const denied = await assertOrganizationRole(
    user.id,
    sep.organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Your role is not allowed to manage separation and final pay.",
  );
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
    if (sep.status !== "draft") {
      return Response.json({ error: "Only a draft final-pay package can be approved." }, { status: 409 });
    }

    const breakdown = asBreakdown(sep.finalPayBreakdown);
    const taxReviewed = body.taxReviewed === true || breakdown.taxReviewed === true;
    if (!taxReviewed) {
      return Response.json({
        error: "Review the final withholding-tax adjustment before approving final pay.",
        taxReviewRequired: true,
      }, { status: 409 });
    }

    const nextTaxAdjustment = body.taxAdjustment === undefined
      ? Number(sep.taxAdjustment)
      : Number(body.taxAdjustment);
    if (!Number.isFinite(nextTaxAdjustment)) {
      return Response.json({ error: "Tax adjustment must be a valid amount." }, { status: 400 });
    }

    const beforeFloor = round2(
      Number(sep.unpaidSalary) +
      Number(sep.prorated13thMonth) +
      Number(sep.leaveMonetizationPay) +
      nextTaxAdjustment -
      Number(sep.loanDeductions)
    );
    const netFinalPay = round2(Math.max(0, beforeFloor));
    const employeeBalanceDue = round2(Math.max(0, -beforeFloor));
    const nextBreakdown = {
      ...breakdown,
      taxAdjustment: nextTaxAdjustment,
      taxReviewed: true,
      taxReviewRequired: false,
      netFinalPay,
      employeeBalanceDue,
      approvedBy: user.name,
      approvedAt: new Date().toISOString(),
    };

    const [updated] = await db.update(separationRecords).set({
      taxAdjustment: money(nextTaxAdjustment),
      netFinalPay: money(netFinalPay),
      finalPayBreakdown: nextBreakdown,
      status: "approved",
    }).where(eq(separationRecords.id, id)).returning();

    await recordAuditEvent({
      organizationId: sep.organizationId,
      actor: user.name,
      action: "Final pay approved",
      resource: `Separation #${sep.id}`,
      metadata: { netFinalPay, taxAdjustment: nextTaxAdjustment, taxReviewed: true },
    });

    return Response.json(updated);
  }

  if (action === "release") {
    if (sep.status !== "approved") {
      return Response.json({ error: "Final pay must be approved before it can be marked released." }, { status: 409 });
    }
    const breakdown = asBreakdown(sep.finalPayBreakdown);
    if (breakdown.taxReviewed !== true) {
      return Response.json({ error: "Final-pay tax review is incomplete." }, { status: 409 });
    }

    const [updated] = await db.update(separationRecords).set({
      status: "released",
      finalPayBreakdown: {
        ...breakdown,
        releasedBy: user.name,
        releasedAt: new Date().toISOString(),
        clearanceIncompleteAtRelease: sep.clearanceStatus !== "cleared",
      },
    }).where(eq(separationRecords.id, id)).returning();

    await db.update(employees)
      .set({ status: "Inactive" })
      .where(and(
        eq(employees.id, sep.employeeId),
        eq(employees.organizationId, sep.organizationId),
      ));

    await recordAuditEvent({
      organizationId: sep.organizationId,
      actor: user.name,
      action: "Final pay marked released",
      resource: `Separation #${sep.id}`,
      metadata: {
        netFinalPay: sep.netFinalPay,
        finalPayDueDate: sep.finalPayDueDate,
        clearanceStatus: sep.clearanceStatus,
      },
    });

    return Response.json({
      ...updated,
      warning: sep.clearanceStatus === "cleared"
        ? null
        : "Final pay was marked released while internal clearance is still incomplete.",
    });
  }

  if (action === "issue_coe") {
    const [updated] = await db.update(separationRecords).set({
      coeIssued: true,
    }).where(eq(separationRecords.id, id)).returning();

    return Response.json(updated);
  }

  return Response.json({ error: "Unknown action." }, { status: 400 });
}
