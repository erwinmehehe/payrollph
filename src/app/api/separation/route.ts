import { enforceSameOriginMutation } from "@/lib/security-request";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, like, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  employeeLoans,
  employeePayProfiles,
  employees,
  historicalPayrollEntries,
  hcmBusinessProcessInstances,
  hcmEmploymentDecisionEvents,
  hcmEmploymentTermDecisions,
  loanPayments,
  payrollEntries,
  payrollRuns,
  positionAssignments,
  positions,
  separationRecords,
  workerEffectiveChanges,
  workerEmploymentEvents,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import {
  APPROVAL_ADMIN_ROLES,
  assertOrganizationRole,
  assertScope,
  getAccess,
  PAYROLL_RELEASE_ROLES,
  PEOPLE_PAYROLL_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { ensureEmployeePayProfiles } from "@/lib/pay-basis-schema";
import { resolvePayProfile } from "@/lib/pay-basis";
import { computeFinalPay, finalPayDueDate, readBasicAndThirteenth } from "@/lib/final-pay";
import { ensureMigrationSchema } from "@/lib/migration-schema";
import { ensureSeparationSchema } from "@/lib/separation-schema";
import { enforceSensitiveActionRateLimit, requireSensitiveActionMfa } from "@/lib/security-request";
import { runLifecycleAutomations } from "@/lib/automation";
import { runEmployeeFieldChangeAutomations } from "@/lib/automation-change-events";
import { startHcmBusinessProcessTx, supervisoryOrgForEffectiveChange } from "@/lib/hcm-business-process";
import { freezeSeparationIntent, separationEvidenceFromDefinition, separationIntentFingerprint, type HcmSeparationIntent } from "@/lib/hcm-separation-business-process";

export const dynamic = "force-dynamic";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const money = (value: number) => (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);

function nonNegative(value: unknown, label: string) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be zero or greater.`);
  return number;
}

async function loadFinalPaySources(input: {
  organizationId: number;
  employeeId: number;
  lastDay: string;
}) {
  await Promise.all([
    ensureEmployeePayProfiles(input.organizationId),
    ensureMigrationSchema(),
    ensureSeparationSchema(),
  ]);

  const taxYear = Number(input.lastDay.slice(0, 4));
  const [employee] = await db.select().from(employees).where(and(
    eq(employees.id, input.employeeId),
    eq(employees.organizationId, input.organizationId),
  )).limit(1);
  if (!employee) throw new Error("Employee not found in this organization.");

  const [payProfile] = await db.select().from(employeePayProfiles).where(and(
    eq(employeePayProfiles.employeeId, input.employeeId),
    eq(employeePayProfiles.organizationId, input.organizationId),
  )).limit(1);
  if (!payProfile) throw new Error("Employee pay profile is missing. Configure it before computing final pay.");

  const released = await db.select({
    runId: payrollRuns.id,
    entryId: payrollEntries.id,
    periodStart: payrollRuns.periodStart,
    periodEnd: payrollRuns.periodEnd,
    payDate: payrollRuns.payDate,
    grossPay: payrollEntries.grossPay,
    lineItems: payrollEntries.lineItems,
    trace: payrollEntries.trace,
  })
    .from(payrollEntries)
    .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
    .where(and(
      eq(payrollRuns.organizationId, input.organizationId),
      eq(payrollEntries.employeeId, input.employeeId),
      eq(payrollRuns.status, "Released"),
      sql`extract(year from ${payrollRuns.periodEnd}) = ${taxYear}`,
      lte(payrollRuns.periodEnd, input.lastDay),
    ));

  const crossing = await db.select({ id: payrollRuns.id, periodLabel: payrollRuns.periodLabel })
    .from(payrollEntries)
    .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
    .where(and(
      eq(payrollRuns.organizationId, input.organizationId),
      eq(payrollEntries.employeeId, input.employeeId),
      eq(payrollRuns.status, "Released"),
      lte(payrollRuns.periodStart, input.lastDay),
      gte(payrollRuns.periodEnd, input.lastDay),
      sql`${payrollRuns.periodEnd} > ${input.lastDay}`,
    ));

  if (crossing.length > 0) {
    throw new Error(
      `Released payroll ${crossing[0].periodLabel} crosses the employee's last day. Split or correct that payroll period before computing final pay.`,
    );
  }

  const historical = await db.select().from(historicalPayrollEntries).where(and(
    eq(historicalPayrollEntries.organizationId, input.organizationId),
    eq(historicalPayrollEntries.employeeId, input.employeeId),
    sql`extract(year from ${historicalPayrollEntries.payDate}) = ${taxYear}`,
    lte(historicalPayrollEntries.payDate, input.lastDay),
  ));

  const loans = await db.select().from(employeeLoans).where(and(
    eq(employeeLoans.organizationId, input.organizationId),
    eq(employeeLoans.employeeId, input.employeeId),
    eq(employeeLoans.status, "active"),
  ));

  let releasedBasicYtd = 0;
  let thirteenthPaidYtd = 0;
  let ordinaryGrossYtd = 0;
  let statutoryContributionsYtd = 0;
  let taxWithheldYtd = 0;
  let deMinimisPaidYtd = 0;
  let deMinimisExcessYtd = 0;
  let mweTaxableSupplementaryCompensationYtd = 0;

  const traceNumber = (trace: unknown, prefix: string) => {
    if (!trace || typeof trace !== "object") return 0;
    const inputs = (trace as { inputs?: unknown }).inputs;
    if (!Array.isArray(inputs)) return 0;
    const raw = inputs.find((item) => typeof item === "string" && item.startsWith(prefix));
    if (typeof raw !== "string") return 0;
    const value = Number(raw.slice(prefix.length));
    return Number.isFinite(value) ? value : 0;
  };

  for (const row of released) {
    const parsed = readBasicAndThirteenth(row.lineItems);
    releasedBasicYtd += parsed.basic;
    thirteenthPaidYtd += parsed.thirteenthPaid;
    statutoryContributionsYtd += parsed.contributions;
    taxWithheldYtd += parsed.taxWithheld;
    deMinimisPaidYtd += parsed.deMinimisPaid;
    deMinimisExcessYtd += parsed.deMinimisExcess;
    mweTaxableSupplementaryCompensationYtd += traceNumber(
      row.trace,
      "mweTaxableSupplementaryCompensation=",
    );
    ordinaryGrossYtd += Math.max(0, Number(row.grossPay) - parsed.thirteenthPaid);
  }

  for (const row of historical) {
    thirteenthPaidYtd += Number(row.thirteenthMonth);
    statutoryContributionsYtd += Number(row.sssEmployee) + Number(row.philHealthEmployee) + Number(row.pagIbigEmployee);
    taxWithheldYtd += Number(row.taxWithheld);
    ordinaryGrossYtd += Math.max(0, Number(row.grossPay) - Number(row.thirteenthMonth));
  }

  const resolvedPayProfile = resolvePayProfile({
    payBasis: payProfile.payBasis,
    rateAmount: payProfile.rateAmount,
    standardWorkDaysPerMonth: payProfile.standardWorkDaysPerMonth,
    standardHoursPerDay: payProfile.standardHoursPerDay,
  });

  return {
    employee,
    payProfile,
    resolvedPayProfile,
    released,
    historical,
    loans,
    totals: {
      releasedBasicYtd: Number(money(releasedBasicYtd)),
      thirteenthPaidYtd: Number(money(thirteenthPaidYtd)),
      ordinaryGrossYtd: Number(money(ordinaryGrossYtd)),
      statutoryContributionsYtd: Number(money(statutoryContributionsYtd)),
      taxWithheldYtd: Number(money(taxWithheldYtd)),
      deMinimisYtd: Number(money(Math.max(0, deMinimisPaidYtd - deMinimisExcessYtd))),
      deMinimisExcessYtd: Number(money(deMinimisExcessYtd)),
      mweTaxableSupplementaryCompensationYtd: Number(money(mweTaxableSupplementaryCompensationYtd)),
      activeLoanBalance: Number(money(loans.reduce((sum, loan) => sum + Number(loan.remainingBalance), 0))),
    },
  };
}

function fingerprint(sources: Awaited<ReturnType<typeof loadFinalPaySources>>) {
  return {
    employeeStatus: sources.employee.status,
    employeeBasicRate: Number(sources.employee.basicRate),
    payProfile: {
      payBasis: sources.payProfile.payBasis,
      rateAmount: Number(sources.payProfile.rateAmount),
      standardWorkDaysPerMonth: Number(sources.payProfile.standardWorkDaysPerMonth),
      standardHoursPerDay: Number(sources.payProfile.standardHoursPerDay),
      updatedAt: sources.payProfile.updatedAt?.toISOString?.() ?? String(sources.payProfile.updatedAt),
    },
    released: sources.released.map((row) => ({
      runId: row.runId,
      entryId: row.entryId,
      grossPay: Number(row.grossPay),
      periodEnd: String(row.periodEnd),
      lineItems: row.lineItems,
      trace: row.trace,
    })),
    historical: sources.historical.map((row) => ({
      id: row.id,
      grossPay: Number(row.grossPay),
      basicSalary: row.basicSalary == null ? null : Number(row.basicSalary),
      thirteenthMonth: Number(row.thirteenthMonth),
      taxWithheld: Number(row.taxWithheld),
      payDate: String(row.payDate),
    })),
    loans: sources.loans.map((loan) => ({
      id: loan.id,
      remainingBalance: Number(loan.remainingBalance),
      status: loan.status,
    })),
  };
}

function sameSnapshot(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  await ensureSeparationSchema();
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
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const filter = employeeId > 0
    ? and(eq(separationRecords.organizationId, organizationId), eq(separationRecords.employeeId, employeeId))
    : eq(separationRecords.organizationId, organizationId);

  const records = await db.select({
    sep: separationRecords,
    employee: employees,
  })
    .from(separationRecords)
    .innerJoin(employees, eq(separationRecords.employeeId, employees.id))
    .where(access.companyWide ? filter : and(filter, eq(employees.orgUnitId, access.orgUnitId!)))
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

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId ?? 1);
  const employeeId = Number(body.employeeId);
  const separationType = String(body.separationType ?? "resignation");
  const noticeDate = String(body.noticeDate ?? "");
  const lastDay = String(body.lastDay ?? "");
  const employmentTermDecisionId = body.employmentTermDecisionId == null || body.employmentTermDecisionId === ""
    ? null
    : Number(body.employmentTermDecisionId);

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Your role is not allowed to manage this HR workflow.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  if (!Number.isInteger(employeeId) || !datePattern.test(noticeDate) || !datePattern.test(lastDay)) {
    return Response.json({ error: "employeeId, noticeDate and lastDay are required." }, { status: 400 });
  }
  if (employmentTermDecisionId !== null && !Number.isInteger(employmentTermDecisionId)) {
    return Response.json({ error: "employmentTermDecisionId must be a valid decision id." }, { status: 400 });
  }
  if (noticeDate > lastDay) {
    return Response.json({ error: "Notice date cannot be after the employee last day." }, { status: 400 });
  }

  try {
    const sources = await loadFinalPaySources({ organizationId, employeeId, lastDay });
    const scope = assertScope(access, sources.employee.orgUnitId);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });
    if (lastDay < String(sources.employee.startDate)) {
      return Response.json({ error: "Last day cannot be before the employee's hire date." }, { status: 400 });
    }

    const [readyTermHandoff] = await db.select().from(hcmEmploymentTermDecisions).where(and(
      eq(hcmEmploymentTermDecisions.organizationId, organizationId),
      eq(hcmEmploymentTermDecisions.employeeId, employeeId),
      eq(hcmEmploymentTermDecisions.decisionKind, "non_renew"),
      eq(hcmEmploymentTermDecisions.status, "applied"),
      inArray(hcmEmploymentTermDecisions.separationHandoffStatus, ["ready", "started"]),
    )).orderBy(desc(hcmEmploymentTermDecisions.id)).limit(1);

    let handoffDecision: typeof hcmEmploymentTermDecisions.$inferSelect | null = null;
    if (employmentTermDecisionId !== null) {
      const [selectedDecision] = await db.select().from(hcmEmploymentTermDecisions).where(and(
        eq(hcmEmploymentTermDecisions.id, employmentTermDecisionId),
        eq(hcmEmploymentTermDecisions.organizationId, organizationId),
        eq(hcmEmploymentTermDecisions.employeeId, employeeId),
      )).limit(1);
      if (!selectedDecision) {
        return Response.json({ error: "Employment-term decision not found for this worker." }, { status: 404 });
      }
      if (selectedDecision.decisionKind !== "non_renew" || selectedDecision.status !== "applied") {
        return Response.json({ error: "Only an applied non-renewal decision can start a Separation handoff." }, { status: 409 });
      }
      if (!["ready", "started"].includes(selectedDecision.separationHandoffStatus)) {
        return Response.json({ error: "This non-renewal handoff is not ready to start Separation." }, { status: 409 });
      }
      if (String(selectedDecision.proposedSeparationLastDay ?? "") !== lastDay) {
        return Response.json({
          error: "Separation last day must match the approved non-renewal decision.",
          approvedLastDay: selectedDecision.proposedSeparationLastDay,
        }, { status: 409 });
      }
      if (separationType !== "end_of_contract") {
        return Response.json({
          error: "A non-renewal handoff must use the end_of_contract separation type.",
        }, { status: 400 });
      }
      handoffDecision = selectedDecision;
    } else if (readyTermHandoff) {
      return Response.json({
        error: "This worker has a ready non-renewal handoff. Start Separation from that governed decision so the lifecycle remains linked.",
        employmentTermDecisionId: readyTermHandoff.id,
        proposedLastDay: readyTermHandoff.proposedSeparationLastDay,
      }, { status: 409 });
    }

    const [unresolvedEffectiveChange] = await db.select({ id: workerEffectiveChanges.id, status: workerEffectiveChanges.status, effectiveDate: workerEffectiveChanges.effectiveDate })
      .from(workerEffectiveChanges)
      .where(and(
        eq(workerEffectiveChanges.organizationId, organizationId),
        eq(workerEffectiveChanges.employeeId, employeeId),
        inArray(workerEffectiveChanges.status, ["pending_approval", "scheduled", "failed"]),
      ))
      .limit(1);
    if (unresolvedEffectiveChange) {
      return Response.json({
        error: "Cancel or resolve the worker's effective-dated HCM change before starting Separation.",
        effectiveChangeId: unresolvedEffectiveChange.id,
        effectiveChangeStatus: unresolvedEffectiveChange.status,
        effectiveDate: unresolvedEffectiveChange.effectiveDate,
      }, { status: 409 });
    }

    const [existingOpen] = await db.select().from(separationRecords).where(and(
      eq(separationRecords.organizationId, organizationId),
      eq(separationRecords.employeeId, employeeId),
    )).orderBy(desc(separationRecords.id)).limit(1);

    if (existingOpen && existingOpen.status !== "released"
      && (String(existingOpen.lastDay) !== lastDay
        || String(existingOpen.noticeDate) !== noticeDate
        || existingOpen.separationType !== separationType)) {
      return Response.json({
        error: "An open Separation package cannot change its approved dates or category through a recomputation. Rescind or resolve the existing lifecycle decision first.",
        separationRecordId: existingOpen.id,
      }, { status: 409 });
    }

    if (handoffDecision?.separationRecordId) {
      if (!existingOpen || existingOpen.id !== handoffDecision.separationRecordId || existingOpen.status === "released") {
        return Response.json({
          error: "The non-renewal decision is already linked to a different or closed Separation record.",
          separationRecordId: handoffDecision.separationRecordId,
        }, { status: 409 });
      }
    }

    if (handoffDecision && !handoffDecision.separationRecordId && existingOpen && existingOpen.status !== "released") {
      if (existingOpen.separationType !== "end_of_contract" || String(existingOpen.lastDay) !== lastDay) {
        return Response.json({
          error: "Resolve the worker's existing open Separation package before linking this non-renewal handoff.",
          separationRecordId: existingOpen.id,
        }, { status: 409 });
      }
    }

    const legacyHistoryMissingBasic = sources.historical.filter((row) => row.basicSalary == null).length;
    const storedHistoricalBasic = sources.historical.reduce(
      (sum, row) => sum + (row.basicSalary == null ? 0 : Number(row.basicSalary)),
      0,
    );
    const historicalBasicOverride = nonNegative(body.historicalBasicSalaryEarned, "Legacy imported basic salary earned");
    if (legacyHistoryMissingBasic > 0 && body.historicalBasicSalaryEarned === undefined) {
      return Response.json({
        error: "Legacy imported payroll rows are missing basic salary. Enter the total basic salary actually earned in those legacy rows so 13th-month pay is not guessed.",
        missingBasicSalaryRows: legacyHistoryMissingBasic,
      }, { status: 422 });
    }
    const historicalBasicSalaryEarned = Number(money(storedHistoricalBasic + historicalBasicOverride));

    const unpaidBasicSalary = nonNegative(body.unpaidBasicSalary, "Unpaid basic salary");
    const finalStatutoryDeductions = nonNegative(body.finalStatutoryDeductions, "Final statutory deductions");
    const finalStatutoryReviewed = Boolean(body.finalStatutoryReviewed);
    if (unpaidBasicSalary > 0 && !finalStatutoryReviewed) {
      return Response.json({
        error: "Unpaid basic salary needs a reviewed final SSS/PhilHealth/Pag-IBIG adjustment. Confirm the review and enter the employee statutory deductions due in final pay, using zero only when payroll review confirms none is due.",
      }, { status: 422 });
    }
    const unusedLeaveCredits = nonNegative(body.unusedLeaveCredits, "Convertible unused leave credits");
    const separationPay = nonNegative(body.separationPay, "Separation pay");
    const retirementPay = nonNegative(body.retirementPay, "Retirement pay");
    const otherBenefits = nonNegative(body.otherBenefits, "Other final-pay benefits");
    const deductOutstandingLoans = Boolean(body.deductOutstandingLoans);
    const specialPayTaxReviewed = Boolean(body.specialPayTaxReviewed);
    const separationPayTaxExempt = Boolean(body.separationPayTaxExempt);
    const retirementPayTaxExempt = Boolean(body.retirementPayTaxExempt);

    if ((separationPay > 0 || retirementPay > 0) && !specialPayTaxReviewed) {
      return Response.json({
        error: "Separation or retirement pay has special tax-treatment conditions. Confirm that its tax treatment has been reviewed before computing the package.",
      }, { status: 422 });
    }

    const leaveMonetizationPay = Number(money(unusedLeaveCredits * sources.resolvedPayProfile.dailyRate));
    const leaveTaxReviewed = Boolean(body.leaveTaxReviewed);
    const leaveMonetizationTaxExempt = Boolean(body.leaveMonetizationTaxExempt);
    if (leaveMonetizationPay > 0 && !leaveTaxReviewed) {
      return Response.json({
        error: "Leave monetization tax treatment must be reviewed before computing final pay. Confirm whether the convertible leave cash amount is taxable or exempt.",
      }, { status: 422 });
    }
    const loanDeductions = deductOutstandingLoans ? sources.totals.activeLoanBalance : 0;

    const result = computeFinalPay({
      releasedBasicYtd: sources.totals.releasedBasicYtd,
      historicalBasicYtd: historicalBasicSalaryEarned,
      unpaidBasicSalary,
      thirteenthPaidYtd: sources.totals.thirteenthPaidYtd,
      grossCompensationYtd: sources.totals.ordinaryGrossYtd,
      deMinimisYtd: sources.totals.deMinimisYtd,
      deMinimisExcessYtd: sources.totals.deMinimisExcessYtd,
      statutoryContributionsYtd: sources.totals.statutoryContributionsYtd,
      taxWithheldYtd: sources.totals.taxWithheldYtd,
      mwe: sources.employee.mwe,
      mweTaxableSupplementaryCompensationYtd: sources.totals.mweTaxableSupplementaryCompensationYtd,
      leaveMonetizationPay,
      taxableLeaveMonetizationPay: leaveMonetizationTaxExempt ? 0 : leaveMonetizationPay,
      separationPay,
      retirementPay,
      taxableSeparationPay: separationPayTaxExempt ? 0 : separationPay,
      taxableRetirementPay: retirementPayTaxExempt ? 0 : retirementPay,
      otherBenefits,
      finalStatutoryDeductions,
      loanDeductions,
    });

    const dueDate = finalPayDueDate(lastDay);
    const sourceFingerprint = fingerprint(sources);
    const computationSnapshot = {
      rule: "13th month = total basic salary earned in calendar year / 12, less 13th month already paid",
      taxRuleVersion: "PH-2026.03",
      sourceFingerprint,
      releasedBasicYtd: sources.totals.releasedBasicYtd,
      historicalBasicSalaryEarned,
      historicalBasicStored: Number(money(storedHistoricalBasic)),
      historicalBasicOverride: Number(money(historicalBasicOverride)),
      legacyHistoryMissingBasic,
      unpaidBasicSalary,
      thirteenthPaidYtd: result.thirteenthPaidYtd,
      thirteenthEntitlement: result.thirteenthEntitlement,
      deMinimisYtd: sources.totals.deMinimisYtd,
      deMinimisExcessYtd: sources.totals.deMinimisExcessYtd,
      mweTaxableSupplementaryCompensationYtd: sources.totals.mweTaxableSupplementaryCompensationYtd,
      deductOutstandingLoans,
      requestedLoanDeductions: result.requestedLoanDeductions,
      collectibleLoanDeductions: result.loanDeductions,
      deferredLoanBalance: result.deferredLoanBalance,
      annualization: result.annualization,
      specialPayTaxReviewed,
      separationPayTaxExempt,
      retirementPayTaxExempt,
      activeLoanBalanceAtComputation: sources.totals.activeLoanBalance,
      importedHistoryRows: sources.historical.length,
      releasedPayrollEntries: sources.released.length,
      payBasis: sources.resolvedPayProfile.payBasis,
      dailyRate: sources.resolvedPayProfile.dailyRate,
      leaveTaxReviewed,
      leaveMonetizationTaxExempt,
      employmentTermDecisionId: handoffDecision?.id ?? null,
      employmentTermDecisionKind: handoffDecision?.decisionKind ?? null,
    };

    const newSeparation = !existingOpen || existingOpen.status === "released";
    const separationIntent: HcmSeparationIntent = {
      organizationId,
      employeeId,
      employeeStatus: sources.employee.status,
      employeeOrgUnitId: sources.employee.orgUnitId,
      employeeStartDate: String(sources.employee.startDate),
      employmentTermDecisionId,
      separationType,
      noticeDate,
      lastDay,
    };
    const intentFingerprint = separationIntentFingerprint(separationIntent);
    let separationProcess: typeof hcmBusinessProcessInstances.$inferSelect | null = null;

    if (newSeparation) {
      const supervisoryOrgUnitId = await supervisoryOrgForEffectiveChange({ organizationId, employeeId });
      const review = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(4106, ${employeeId})`);
        const [liveEmployee] = await tx.select({
          id: employees.id,
          status: employees.status,
          orgUnitId: employees.orgUnitId,
          startDate: employees.startDate,
        }).from(employees).where(and(
          eq(employees.id, employeeId),
          eq(employees.organizationId, organizationId),
        )).limit(1);
        if (!liveEmployee || ["Separating", "Separated"].includes(liveEmployee.status)
          || separationIntentFingerprint({
            ...separationIntent,
            employeeStatus: liveEmployee.status,
            employeeOrgUnitId: liveEmployee.orgUnitId,
            employeeStartDate: String(liveEmployee.startDate),
          }) !== intentFingerprint) {
          throw new Error("Employee lifecycle changed before the separation could be submitted.");
        }

        const [anotherOpen] = await tx.select({ id: separationRecords.id, status: separationRecords.status })
          .from(separationRecords).where(and(
            eq(separationRecords.organizationId, organizationId),
            eq(separationRecords.employeeId, employeeId),
          )).orderBy(desc(separationRecords.id)).limit(1);
        if (anotherOpen && anotherOpen.status !== "released") {
          throw new Error("An active Separation package already exists. Refresh and recompute it instead.");
        }

        const [existingReview] = await tx.select().from(hcmBusinessProcessInstances).where(and(
          eq(hcmBusinessProcessInstances.organizationId, organizationId),
          eq(hcmBusinessProcessInstances.sourceType, "separation_initiation"),
          like(hcmBusinessProcessInstances.sourceKey, `${employeeId}:%`),
          inArray(hcmBusinessProcessInstances.status, ["in_progress", "approved"]),
        )).orderBy(desc(hcmBusinessProcessInstances.id)).limit(1);

        if (existingReview) {
          const frozen = separationEvidenceFromDefinition(existingReview.definitionSnapshot);
          if (!frozen || frozen.organizationId !== organizationId || frozen.employeeId !== employeeId
            || frozen.fingerprint !== intentFingerprint) {
            throw new Error("This worker already has a different active separation request. Complete or decline it before changing exit terms.");
          }
          return { instance: existingReview, submitted: false };
        }
        const instance = await startHcmBusinessProcessTx(tx, {
          organizationId,
          processType: "termination",
          sourceType: "separation_initiation",
          sourceKey: `${employeeId}:${randomUUID()}`,
          employeeId,
          employeeLabel: `${sources.employee.firstName} ${sources.employee.lastName}`,
          supervisoryOrgUnitId,
          effectiveDate: lastDay,
          initiatedByUserId: user.id,
          initiatedByName: user.name,
          sourceEvidence: { ...freezeSeparationIntent(separationIntent) },
        });
        return { instance, submitted: true };
      });
      separationProcess = review.instance;
      if (review.submitted) {
        await recordAuditEvent({
          organizationId,
          actor: user.name,
          action: "Separation intent submitted to HCM business process",
          resource: `Employee #${employeeId}`,
          metadata: {
            employeeId,
            businessProcessInstanceId: separationProcess.id,
            noticeDate,
            lastDay,
            separationType,
            intentFingerprint,
          },
        });
      }
      if (separationProcess.status !== "approved") {
        return Response.json({
          approvalRequired: true,
          separationCreated: false,
          businessProcess: {
            id: separationProcess.id,
            status: separationProcess.status,
            definitionCode: separationProcess.definitionCode,
          },
          nextAction: "Complete independent HCM Inbox approvals, then resubmit the same separation dates and category to prepare final pay.",
        }, { status: 202 });
      }
    }

    const created = await db.transaction(async (tx) => {
      if (newSeparation) {
        // Serialize initiation and claim the approved intent before any employee
        // status or final-pay source record may be changed.
        await tx.execute(sql`select pg_advisory_xact_lock(4106, ${employeeId})`);
        const [liveEmployee] = await tx.select({
          status: employees.status,
          orgUnitId: employees.orgUnitId,
          startDate: employees.startDate,
        }).from(employees).where(and(
          eq(employees.id, employeeId),
          eq(employees.organizationId, organizationId),
        )).limit(1);
        const [activeReview] = separationProcess
          ? await tx.select().from(hcmBusinessProcessInstances).where(and(
              eq(hcmBusinessProcessInstances.id, separationProcess.id),
              eq(hcmBusinessProcessInstances.organizationId, organizationId),
              eq(hcmBusinessProcessInstances.status, "approved"),
              eq(hcmBusinessProcessInstances.sourceType, "separation_initiation"),
            )).limit(1)
          : [];
        const frozen = activeReview ? separationEvidenceFromDefinition(activeReview.definitionSnapshot) : null;
        if (!liveEmployee || !frozen || frozen.organizationId !== organizationId
          || frozen.employeeId !== employeeId || frozen.fingerprint !== intentFingerprint
          || separationIntentFingerprint({
            ...separationIntent,
            employeeStatus: liveEmployee.status,
            employeeOrgUnitId: liveEmployee.orgUnitId,
            employeeStartDate: String(liveEmployee.startDate),
          }) !== frozen.fingerprint) {
          throw new Error("The approved termination intent no longer matches authoritative employee evidence.");
        }
        const [livePackage] = await tx.select({ id: separationRecords.id, status: separationRecords.status })
          .from(separationRecords).where(and(
            eq(separationRecords.organizationId, organizationId),
            eq(separationRecords.employeeId, employeeId),
          )).orderBy(desc(separationRecords.id)).limit(1);
        if (livePackage && livePackage.status !== "released") {
          throw new Error("A competing Separation package was created before this intent could be applied.");
        }
      }

      const financialValues = {
        separationType,
        noticeDate,
        lastDay,
        prorated13thMonth: money(result.thirteenthDue),
        thirteenthEntitlement: money(result.thirteenthEntitlement),
        thirteenthPaidYtd: money(result.thirteenthPaidYtd),
        basicSalaryEarnedYtd: money(result.basicSalaryEarnedYtd),
        historicalBasicSalaryEarned: money(historicalBasicSalaryEarned),
        unpaidBasicSalary: money(unpaidBasicSalary),
        unusedLeaveCredits: unusedLeaveCredits.toFixed(1),
        leaveMonetizationPay: money(result.leaveMonetizationPay),
        separationPay: money(result.separationPay),
        retirementPay: money(result.retirementPay),
        otherBenefits: money(result.otherBenefits),
        taxAdjustment: money(result.taxAdjustment),
        finalStatutoryDeductions: money(result.finalStatutoryDeductions),
        loanDeductions: money(result.loanDeductions),
        grossFinalPay: money(result.grossFinalPay),
        netFinalPay: money(result.netFinalPay),
        finalPayDueDate: dueDate,
        computationSnapshot,
        status: "draft",
        approvedAt: null,
        releasedAt: null,
        releaseReference: null,
        preparedByUserId: user.id,
        approvedByUserId: null,
        releasedByUserId: null,
      } as const;

      let record: typeof separationRecords.$inferSelect;
      if (existingOpen && existingOpen.status !== "released") {
        const separationFactsChanged =
          String(existingOpen.lastDay) !== lastDay
          || existingOpen.separationType !== separationType;
        const [updated] = await tx.update(separationRecords).set({
          ...financialValues,
          // Every recomputation invalidates Finance approval. A changed last
          // day/category also invalidates operational clearance and any COE
          // already marked issued from the previous separation facts.
          financeCleared: false,
          itCleared: separationFactsChanged ? false : existingOpen.itCleared,
          adminCleared: separationFactsChanged ? false : existingOpen.adminCleared,
          hrCleared: separationFactsChanged ? false : existingOpen.hrCleared,
          coeIssued: separationFactsChanged ? false : existingOpen.coeIssued,
          clearanceStatus: "in_progress",
        }).where(and(
          eq(separationRecords.id, existingOpen.id),
          eq(separationRecords.organizationId, organizationId),
        )).returning();
        if (!updated) throw new Error("Open separation package changed while it was being recomputed.");
        record = updated;
      } else {
        const [inserted] = await tx.insert(separationRecords).values({
          organizationId,
          employeeId,
          ...financialValues,
          clearanceStatus: "in_progress",
          itCleared: false,
          adminCleared: false,
          financeCleared: false,
          hrCleared: false,
          coeIssued: false,
        }).returning();
        record = inserted;
      }

      await tx.update(employees)
        .set({ status: "Separating" })
        .where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId)));

      if (handoffDecision) {
        if (handoffDecision.separationRecordId && handoffDecision.separationRecordId !== record.id) {
          throw new Error("The non-renewal decision is already linked to another Separation record.");
        }
        const [linked] = await tx.update(hcmEmploymentTermDecisions).set({
          separationRecordId: record.id,
          separationHandoffStatus: "started",
          separationHandoffStartedAt: handoffDecision.separationHandoffStartedAt ?? new Date(),
          separationHandoffCompletedAt: null,
          updatedAt: new Date(),
        }).where(and(
          eq(hcmEmploymentTermDecisions.id, handoffDecision.id),
          eq(hcmEmploymentTermDecisions.organizationId, organizationId),
          eq(hcmEmploymentTermDecisions.employeeId, employeeId),
          eq(hcmEmploymentTermDecisions.decisionKind, "non_renew"),
          eq(hcmEmploymentTermDecisions.status, "applied"),
          inArray(hcmEmploymentTermDecisions.separationHandoffStatus, ["ready", "started"]),
        )).returning();
        if (!linked) throw new Error("The non-renewal handoff changed before Separation could start.");
        if (handoffDecision.separationHandoffStatus === "ready") {
          await tx.insert(hcmEmploymentDecisionEvents).values({
            organizationId,
            decisionId: linked.id,
            employeeId,
            eventType: "separation_started",
            actorUserId: user.id,
            actorName: user.name,
            metadata: {
              separationRecordId: record.id,
              lastDay,
              separationType,
            },
          });
        }
      }

      if (!(existingOpen && existingOpen.status !== "released")) {
        await tx.insert(workerEmploymentEvents).values({
          organizationId,
          employeeId,
          effectiveDate: noticeDate,
          eventType: "separation_started",
          fromOrgUnitId: sources.employee.orgUnitId,
          toOrgUnitId: sources.employee.orgUnitId,
          fromLegalEntityId: sources.employee.legalEntityId,
          toLegalEntityId: sources.employee.legalEntityId,
          fromEmploymentType: sources.employee.employmentType,
          toEmploymentType: sources.employee.employmentType,
          fromStatus: sources.employee.status,
          toStatus: "Separating",
          reason: `Separation initiated: ${separationType}`.slice(0, 240),
          metadata: {
            separationId: record.id,
            separationType,
            noticeDate,
            lastDay,
            employmentTermDecisionId: handoffDecision?.id ?? null,
          },
          actorUserId: user.id,
          actorName: user.name,
        });
      }

      if (newSeparation && separationProcess) {
        const [claimed] = await tx.update(hcmBusinessProcessInstances)
          .set({ status: "applied", updatedAt: new Date() })
          .where(and(
            eq(hcmBusinessProcessInstances.id, separationProcess.id),
            eq(hcmBusinessProcessInstances.organizationId, organizationId),
            eq(hcmBusinessProcessInstances.status, "approved"),
          )).returning({ id: hcmBusinessProcessInstances.id });
        if (!claimed) throw new Error("Separation approval changed before it could be applied.");
      }
      return record;
    });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: existingOpen && existingOpen.status !== "released"
        ? "Separation final pay recomputed"
        : "Separation final pay computed",
      resource: `${sources.employee.firstName} ${sources.employee.lastName} (Final Pay: ₱${result.netFinalPay.toFixed(2)})`,
      metadata: {
        separationId: created.id,
        businessProcessInstanceId: separationProcess?.id ?? null,
        lastDay,
        finalPayDueDate: dueDate,
        basicSalaryEarnedYtd: result.basicSalaryEarnedYtd,
        thirteenthEntitlement: result.thirteenthEntitlement,
        thirteenthAlreadyPaid: result.thirteenthPaidYtd,
        thirteenthDue: result.thirteenthDue,
        unpaidBasicSalary,
        leaveMonetizationPay,
        leaveTaxReviewed,
        leaveMonetizationTaxExempt,
        separationPay,
        retirementPay,
        separationPayTaxExempt,
        retirementPayTaxExempt,
        otherBenefits,
        finalStatutoryDeductions,
        finalStatutoryReviewed,
        taxAdjustment: result.taxAdjustment,
        requestedLoanDeductions: result.requestedLoanDeductions,
        loanDeductions: result.loanDeductions,
        deferredLoanBalance: result.deferredLoanBalance,
        netFinalPay: result.netFinalPay,
      },
    });

    return Response.json({
      ...created,
      approvalRequired: false,
      businessProcess: separationProcess ? { id: separationProcess.id, status: "applied" } : null,
    }, { status: 201 });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Could not compute final pay.",
    }, { status: error instanceof Error && /changed|already exists|approval|different active separation/i.test(error.message) ? 409 : 422 });
  }
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  await ensureSeparationSchema();
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
  const access = await getAccess(user.id, sep.organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  const [employee] = await db.select({
    orgUnitId: employees.orgUnitId,
    legalEntityId: employees.legalEntityId,
    title: employees.title,
    employmentType: employees.employmentType,
    status: employees.status,
  }).from(employees)
    .where(and(eq(employees.id, sep.employeeId), eq(employees.organizationId, sep.organizationId)))
    .limit(1);
  if (!employee) return Response.json({ error: "Employee not found in this workspace." }, { status: 404 });
  const scope = assertScope(access, employee.orgUnitId);
  if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

  if (action === "approve" || action === "release") {
    const mfaDenied = requireSensitiveActionMfa(user);
    if (mfaDenied) return mfaDenied;
    const limitDenied = await enforceSensitiveActionRateLimit(request, {
      userId: user.id,
      action: `separation-final-pay-${action}`,
      resourceId: id,
      limit: 5,
      windowMs: 15 * 60_000,
    });
    if (limitDenied) return limitDenied;
    if (!access.companyWide) {
      return Response.json({
        code: "FINAL_PAY_COMPANY_WIDE_REQUIRED",
        error: "Final-pay approval or release requires company-wide financial authority.",
      }, { status: 403 });
    }
  }

  if (action === "approve") {
    const approvalDenied = await assertOrganizationRole(
      user.id,
      sep.organizationId,
      APPROVAL_ADMIN_ROLES,
      "Only an authorized HR/administrative approver can approve final pay.",
    );
    if (approvalDenied) return approvalDenied;
  }
  if (action === "release") {
    const releaseDenied = await assertOrganizationRole(
      user.id,
      sep.organizationId,
      PAYROLL_RELEASE_ROLES,
      "Only payroll release roles can release final pay.",
    );
    if (releaseDenied) return releaseDenied;
  }

  if (action === "clearance") {
    if (sep.status === "released") return Response.json({ error: "Released final pay is immutable." }, { status: 409 });
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

  if (action === "issue_coe") {
    const [updated] = await db.update(separationRecords).set({ coeIssued: true })
      .where(eq(separationRecords.id, id)).returning();
    await recordAuditEvent({
      organizationId: sep.organizationId,
      actor: user.name,
      action: "Certificate of Employment issued",
      resource: `Separation #${sep.id}`,
      metadata: { employeeId: sep.employeeId },
    });
    return Response.json(updated);
  }

  if (action === "approve" || action === "release") {
    if (!(sep.itCleared && sep.adminCleared && sep.financeCleared && sep.hrCleared)) {
      return Response.json({ error: "IT, Admin, Finance, and HR clearance must all be complete first." }, { status: 409 });
    }

    const snapshot = (sep.computationSnapshot ?? {}) as Record<string, unknown>;
    const storedFingerprint = snapshot.sourceFingerprint;
    const sources = await loadFinalPaySources({
      organizationId: sep.organizationId,
      employeeId: sep.employeeId,
      lastDay: String(sep.lastDay),
    });
    const currentFingerprint = fingerprint(sources);
    if (!sameSnapshot(storedFingerprint, currentFingerprint)) {
      return Response.json({
        error: "Payroll, pay-profile, imported-history, or loan data changed after final pay was computed. Recompute the final pay package before approval or release.",
      }, { status: 409 });
    }

    if (action === "approve") {
      if (sep.status !== "draft") {
        return Response.json({ error: "Only a draft final-pay package can be approved." }, { status: 409 });
      }
      try {
        const updated = await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT id FROM separation_records
            WHERE id = ${id} AND organization_id = ${sep.organizationId} FOR UPDATE`);
          const [fresh] = await tx.select().from(separationRecords).where(and(
            eq(separationRecords.id, id),
            eq(separationRecords.organizationId, sep.organizationId),
          )).limit(1);
          if (!fresh || fresh.status !== "draft") {
            throw new Error("FINAL_PAY_APPROVAL_CHANGED");
          }
          // Stable actor IDs, never display names. Historical packages with
          // unknown preparers require a fresh evidence-backed recomputation.
          if (fresh.preparedByUserId == null) {
            throw new Error("FINAL_PAY_MAKER_EVIDENCE_MISSING");
          }
          if (fresh.preparedByUserId === user.id) {
            throw new Error("FINAL_PAY_MAKER_CHECKER_REQUIRED");
          }
          if (!(fresh.itCleared && fresh.adminCleared && fresh.financeCleared && fresh.hrCleared)) {
            throw new Error("FINAL_PAY_CLEARANCE_STALE");
          }
          const frozen = (fresh.computationSnapshot ?? {}) as Record<string, unknown>;
          if (!sameSnapshot(frozen.sourceFingerprint, currentFingerprint)) {
            throw new Error("FINAL_PAY_SOURCE_CHANGED");
          }
          const [approved] = await tx.update(separationRecords).set({
            status: "approved",
            approvedAt: new Date(),
            approvedByUserId: user.id,
          }).where(and(
            eq(separationRecords.id, id),
            eq(separationRecords.organizationId, sep.organizationId),
            eq(separationRecords.status, "draft"),
          )).returning();
          if (!approved) throw new Error("FINAL_PAY_APPROVAL_CHANGED");
          await tx.insert(auditEvents).values({
            organizationId: sep.organizationId,
            actor: user.name,
            action: "Final pay independently approved",
            resource: `Separation #${sep.id}`,
            metadata: {
              employeeId: sep.employeeId,
              netFinalPay: Number(fresh.netFinalPay),
              preparerUserId: fresh.preparedByUserId,
              approverUserId: user.id,
              sourceFingerprint: frozen.sourceFingerprint,
              clearanceConfirmedUnderLock: true,
            },
          });
          return approved;
        });
        return Response.json(updated);
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        if (code.startsWith("FINAL_PAY_")) {
          return Response.json({
            code,
            error: code === "FINAL_PAY_MAKER_EVIDENCE_MISSING"
              ? "This legacy final-pay draft has no stable preparer identity. Recompute against verified source records before independent approval."
              : code === "FINAL_PAY_MAKER_CHECKER_REQUIRED"
                ? "The employee final-pay preparer cannot approve their own computation."
                : "The final-pay package, clearance or supporting payroll evidence changed. Refresh, reconcile and reapprove.",
          }, { status: 409 });
        }
        throw error;
      }
    }

    if (sep.status !== "approved") {
      return Response.json({ error: "Final pay must be approved before release." }, { status: 409 });
    }
    const releaseReference = String(body.releaseReference ?? "").trim();
    if (!releaseReference) {
      return Response.json({
        error: "Enter a payout or bank reference before marking Final Pay released.",
      }, { status: 422 });
    }

    const released = await db.transaction(async (tx) => {
      const [fresh] = await tx.select().from(separationRecords).where(eq(separationRecords.id, id)).limit(1);
      if (!fresh || fresh.status !== "approved") {
        throw new Error("Final-pay release state changed. Refresh and try again.");
      }

      const [linkedTermDecision] = await tx.select().from(hcmEmploymentTermDecisions).where(and(
        eq(hcmEmploymentTermDecisions.separationRecordId, fresh.id),
        eq(hcmEmploymentTermDecisions.organizationId, fresh.organizationId),
        eq(hcmEmploymentTermDecisions.employeeId, fresh.employeeId),
      )).limit(1);
      if (linkedTermDecision && (
        linkedTermDecision.decisionKind !== "non_renew"
        || linkedTermDecision.status !== "applied"
        || linkedTermDecision.separationHandoffStatus !== "started"
      )) {
        throw new Error("The linked non-renewal handoff is no longer in a releasable state.");
      }

      const freshSnapshot = (fresh.computationSnapshot ?? {}) as Record<string, unknown>;
      if (!sameSnapshot(freshSnapshot.sourceFingerprint, currentFingerprint)) {
        throw new Error("Final-pay source data changed before release. Recompute the package.");
      }

      const [activeAssignment] = await tx.select().from(positionAssignments).where(and(
        eq(positionAssignments.organizationId, fresh.organizationId),
        eq(positionAssignments.employeeId, fresh.employeeId),
        eq(positionAssignments.assignmentType, "primary"),
        isNull(positionAssignments.effectiveUntil),
      )).limit(1);

      const [activePosition] = activeAssignment
        ? await tx.select().from(positions).where(and(
            eq(positions.id, activeAssignment.positionId),
            eq(positions.organizationId, fresh.organizationId),
          )).limit(1)
        : [];

      if (activeAssignment && String(activeAssignment.effectiveFrom) > String(fresh.lastDay)) {
        throw new Error("The active position assignment begins after the employee last day. Correct the HCM assignment before releasing final pay.");
      }

      const deductOutstandingLoans = Boolean(freshSnapshot.deductOutstandingLoans);
      if (deductOutstandingLoans) {
        let collectible = Number(fresh.loanDeductions);
        const orderedLoans = [...sources.loans].sort((a, b) => {
          const aGovernment = /SSS|Pag-IBIG|HDMF/i.test(a.loanType) ? 0 : 1;
          const bGovernment = /SSS|Pag-IBIG|HDMF/i.test(b.loanType) ? 0 : 1;
          return aGovernment - bGovernment || a.id - b.id;
        });

        for (const loan of orderedLoans) {
          if (collectible <= 0.004) break;
          const remaining = Number(loan.remainingBalance);
          const amount = Math.min(remaining, collectible);
          if (amount <= 0) continue;

          await tx.insert(loanPayments).values({
            loanId: loan.id,
            payrollRunId: null,
            amount: money(amount),
            paymentDate: String(fresh.lastDay),
            reference: `Final pay separation #${fresh.id}`,
          });

          const newBalance = Math.max(0, remaining - amount);
          const [settledLoan] = await tx.update(employeeLoans).set({
            totalPaid: money(Number(loan.totalPaid) + amount),
            remainingBalance: money(newBalance),
            status: newBalance <= 0.004 ? "paid_off" : "active",
          }).where(and(
            eq(employeeLoans.id, loan.id),
            eq(employeeLoans.status, "active"),
            eq(employeeLoans.remainingBalance, loan.remainingBalance),
          )).returning({ id: employeeLoans.id });

          if (!settledLoan) {
            throw new Error(`Loan ${loan.id} changed during final-pay release. Recompute the package before release.`);
          }
          collectible = Math.max(0, collectible - amount);
        }

        if (collectible > 0.01) {
          throw new Error(
            `Final-pay loan collection has ₱${collectible.toFixed(2)} that cannot be matched to an active loan. Recompute before release.`,
          );
        }
      }

      const [updated] = await tx.update(separationRecords).set({
        status: "released",
        releasedAt: new Date(),
        releaseReference: releaseReference.slice(0, 160),
      }).where(and(
        eq(separationRecords.id, id),
        eq(separationRecords.status, "approved"),
      )).returning();
      if (!updated) throw new Error("Final-pay release state changed.");

      await tx.update(employees).set({ status: "Separated" }).where(and(
        eq(employees.id, fresh.employeeId),
        eq(employees.organizationId, fresh.organizationId),
      ));

      if (activeAssignment) {
        await tx.update(positionAssignments).set({
          effectiveUntil: fresh.lastDay,
        }).where(and(
          eq(positionAssignments.id, activeAssignment.id),
          isNull(positionAssignments.effectiveUntil),
        ));
      }

      if (activePosition) {
        await tx.update(positions).set({
          status: "open",
          updatedAt: new Date(),
        }).where(eq(positions.id, activePosition.id));
      }

      await tx.insert(workerEmploymentEvents).values({
        organizationId: fresh.organizationId,
        employeeId: fresh.employeeId,
        effectiveDate: fresh.lastDay,
        eventType: "separation_released",
        positionAssignmentId: activeAssignment?.id ?? null,
        fromPositionId: activePosition?.id ?? null,
        fromOrgUnitId: employee.orgUnitId,
        fromLegalEntityId: employee.legalEntityId,
        fromManagerEmployeeId: activePosition?.managerEmployeeId ?? null,
        fromEmploymentType: employee.employmentType,
        toEmploymentType: employee.employmentType,
        fromStatus: employee.status,
        toStatus: "Separated",
        reason: `Separation released: ${fresh.separationType}`.slice(0, 240),
        metadata: {
          separationId: fresh.id,
          separationType: fresh.separationType,
          releaseReference: releaseReference.slice(0, 160),
          positionClosed: Boolean(activeAssignment),
          employmentTermDecisionId: linkedTermDecision?.id ?? null,
        },
        actorUserId: user.id,
        actorName: user.name,
      });

      if (linkedTermDecision) {
        const [completedHandoff] = await tx.update(hcmEmploymentTermDecisions).set({
          separationHandoffStatus: "completed",
          separationHandoffCompletedAt: new Date(),
          updatedAt: new Date(),
        }).where(and(
          eq(hcmEmploymentTermDecisions.id, linkedTermDecision.id),
          eq(hcmEmploymentTermDecisions.separationRecordId, fresh.id),
          eq(hcmEmploymentTermDecisions.separationHandoffStatus, "started"),
        )).returning();
        if (!completedHandoff) {
          throw new Error("The linked non-renewal handoff changed before final-pay release.");
        }
        await tx.insert(hcmEmploymentDecisionEvents).values({
          organizationId: completedHandoff.organizationId,
          decisionId: completedHandoff.id,
          employeeId: completedHandoff.employeeId,
          eventType: "separation_completed",
          actorUserId: user.id,
          actorName: user.name,
          metadata: {
            separationRecordId: fresh.id,
            lastDay: fresh.lastDay,
            releaseReference: releaseReference.slice(0, 160),
          },
        });
      }

      return updated;
    });

    await recordAuditEvent({
      organizationId: sep.organizationId,
      actor: user.name,
      action: "Final pay released",
      resource: `Separation #${sep.id}`,
      metadata: {
        employeeId: sep.employeeId,
        releasedAt: released.releasedAt,
        finalPayDueDate: sep.finalPayDueDate,
        netFinalPay: Number(sep.netFinalPay),
        loanDeductions: Number(sep.loanDeductions),
        deferredLoanBalance: Number(
          (sep.computationSnapshot as Record<string, unknown> | null)?.deferredLoanBalance ?? 0,
        ),
        releaseReference: releaseReference.slice(0, 160),
        offboarding2316Available: true,
      },
    });

    const automation = await runLifecycleAutomations({
      organizationId: sep.organizationId,
      employeeId: sep.employeeId,
      trigger: "employee.separated",
      eventKey: "separation-release:" + sep.id,
      context: {
        orgUnitId: employee.orgUnitId,
        employmentType: employee.employmentType,
        title: employee.title,
      },
    });

    const fieldChangeAutomation = await runEmployeeFieldChangeAutomations({
      organizationId: sep.organizationId,
      employeeId: sep.employeeId,
      eventKey: "separation-release:" + sep.id + ":field-change",
      changes: [
        {
          field: "employeeStatus",
          previousValue: employee.status,
          newValue: "Separated",
          effectiveDate: String(sep.lastDay),
          source: "separation-release",
          metadata: { separationId: sep.id, separationType: sep.separationType },
        },
      ],
    });

    return Response.json({
      ...released,
      automation,
      fieldChangeAutomation,
      offboarding2316: {
        status: "available",
        href: `/api/separation/${released.id}/2316`,
        requiresRecentMfa: true,
        draftOnly: true,
      },
    });
  }

  return Response.json({ error: "Unknown action." }, { status: 400 });
}
