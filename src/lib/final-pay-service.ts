import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  employeeLoans,
  employeePayProfiles,
  employeePayRevisions,
  employeePayRetroAdjustments,
  employees,
  historicalPayrollEntries,
  leaveBalances,
  payrollEntries,
  payrollRuns,
} from "@/db/schema";
import { ensureEmployeePayProfiles } from "@/lib/pay-basis-schema";
import { ensureMigrationSchema } from "@/lib/migration-schema";
import { ensureFinalPaySchema } from "@/lib/final-pay-schema";
import { profileForDate, resolvePayTimeline } from "@/lib/pay-basis";
import {
  computeFinalPayTaxAdjustment,
  computeStatutoryRetirementPay,
  computeStatutorySeparationPay,
  computeThirteenthMonthBalance,
  finalPayDueDate,
  payrollTaxSummary,
  thirteenthMonthBasicFromEntry,
  type SeparationCause,
} from "@/lib/final-pay";
import { round2 } from "@/lib/round";

export type FinalPayInputs = {
  organizationId: number;
  employeeId: number;
  separationType: SeparationCause;
  noticeDate: string;
  lastDay: string;
  unusedLeaveCredits: number;
  leaveBasisNote: string;
  finalPayrollVerified: boolean;
  unpaidBasicSalary: number;
  otherUnpaidTaxableEarnings: number;
  additionalThirteenthMonthBasic: number;
  deductOutstandingLoans: boolean;
  separationPayTaxExemptConfirmed: boolean;
  retirementPlanBenefit: number;
  retirementPlanReference: string;
  retirementTaxExemptConfirmed: boolean;
  additionalCompanyBenefit: number;
  additionalCompanyBenefitTaxable: boolean;
};

function iso(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must use YYYY-MM-DD.`);
  return value;
}

function daysBetween(start: string, end: string) {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return Math.floor((endMs - startMs) / 86_400_000);
}

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function money(value: number) {
  return round2(Number.isFinite(value) ? value : 0);
}

export async function computeFinalPayPackage(input: FinalPayInputs) {
  await ensureMigrationSchema();
  await ensureFinalPaySchema();
  await ensureEmployeePayProfiles(input.organizationId);

  const noticeDate = iso(input.noticeDate, "Notice date");
  const lastDay = iso(input.lastDay, "Last day");
  if (lastDay < noticeDate && input.separationType !== "just_cause") {
    throw new Error("Last day cannot be before the notice date.");
  }

  const [employee] = await db.select().from(employees).where(and(
    eq(employees.id, input.employeeId),
    eq(employees.organizationId, input.organizationId),
  )).limit(1);
  if (!employee) throw new Error("Employee not found in this organization.");
  if (lastDay < String(employee.startDate)) throw new Error("Last day cannot be before the employee hire date.");

  const [profileRow] = await db.select().from(employeePayProfiles).where(eq(employeePayProfiles.employeeId, employee.id)).limit(1);
  if (!profileRow) throw new Error("Employee pay profile is missing.");

  const payRevisions = await db.select().from(employeePayRevisions).where(and(
    eq(employeePayRevisions.organizationId, input.organizationId),
    eq(employeePayRevisions.employeeId, employee.id),
    lte(employeePayRevisions.effectiveDate, lastDay),
  )).orderBy(asc(employeePayRevisions.effectiveDate), asc(employeePayRevisions.id));

  const payTimeline = resolvePayTimeline({
    currentProfile: {
      payBasis: profileRow.payBasis,
      rateAmount: profileRow.rateAmount,
      standardWorkDaysPerMonth: profileRow.standardWorkDaysPerMonth,
      standardHoursPerDay: profileRow.standardHoursPerDay,
    },
    revisions: payRevisions.map((revision) => ({
      effectiveDate: String(revision.effectiveDate),
      previousPayBasis: revision.previousPayBasis,
      previousRateAmount: revision.previousRateAmount,
      previousStandardWorkDaysPerMonth: revision.previousStandardWorkDaysPerMonth,
      previousStandardHoursPerDay: revision.previousStandardHoursPerDay,
      newPayBasis: revision.newPayBasis,
      newRateAmount: revision.newRateAmount,
      newStandardWorkDaysPerMonth: revision.newStandardWorkDaysPerMonth,
      newStandardHoursPerDay: revision.newStandardHoursPerDay,
      reason: revision.reason,
    })),
    periodStart: lastDay,
    periodEnd: lastDay,
  });
  const profileAtSeparation = profileForDate(payTimeline, lastDay);

  const entryRows = await db.select({
    entry: payrollEntries,
    run: payrollRuns,
  }).from(payrollEntries)
    .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
    .where(and(
      eq(payrollEntries.employeeId, employee.id),
      eq(payrollRuns.organizationId, input.organizationId),
      eq(payrollRuns.status, "Released"),
      lte(payrollRuns.periodStart, lastDay),
    ))
    .orderBy(asc(payrollRuns.periodEnd), asc(payrollEntries.id));

  const taxYear = Number(lastDay.slice(0, 4));
  const currentYearEntries = entryRows.filter(({ run }) =>
    String(run.periodEnd).slice(0, 4) === String(taxYear) && String(run.periodStart) <= lastDay,
  );

  const importedHistory = await db.select().from(historicalPayrollEntries).where(and(
    eq(historicalPayrollEntries.organizationId, input.organizationId),
    eq(historicalPayrollEntries.employeeId, employee.id),
    lte(historicalPayrollEntries.payDate, lastDay),
  ));
  const importedCurrentYear = importedHistory.filter((row) => String(row.payDate).slice(0, 4) === String(taxYear));

  const retroRows = await db.select().from(employeePayRetroAdjustments).where(and(
    eq(employeePayRetroAdjustments.organizationId, input.organizationId),
    eq(employeePayRetroAdjustments.employeeId, employee.id),
  )).orderBy(asc(employeePayRetroAdjustments.id));
  const sourceRunIds = [...new Set(retroRows.map((row) => row.sourcePayrollRunId))];
  const sourceRuns = sourceRunIds.length
    ? await db.select().from(payrollRuns).where(inArray(payrollRuns.id, sourceRunIds))
    : [];
  const sourceRunById = new Map(sourceRuns.map((run) => [run.id, run]));
  const eligibleRetroIds = new Set(
    retroRows
      .filter((row) => {
        const source = sourceRunById.get(row.sourcePayrollRunId);
        return source
          && String(source.periodEnd).slice(0, 4) === String(taxYear)
          && String(source.periodEnd) <= lastDay;
      })
      .map((row) => row.id),
  );

  let basicSalaryEarned = 0;
  let thirteenthAlreadyPaid = 0;
  let grossCompensation = 0;
  let statutoryContributions = 0;
  let taxWithheld = 0;
  let otherNonTaxable = 0;

  for (const { entry } of currentYearEntries) {
    basicSalaryEarned += thirteenthMonthBasicFromEntry(entry, { eligibleRetroIds });
    const tax = payrollTaxSummary(entry);
    grossCompensation += tax.grossCompensation;
    thirteenthAlreadyPaid += tax.thirteenthMonth;
    statutoryContributions += tax.statutoryContributions;
    taxWithheld += tax.taxWithheld;
    otherNonTaxable += tax.otherNonTaxable;
  }

  const blockers: string[] = [];
  for (const row of importedCurrentYear) {
    basicSalaryEarned += Number(row.basicSalaryEarned);
    thirteenthAlreadyPaid += Number(row.thirteenthMonth);
    grossCompensation += Number(row.grossPay);
    statutoryContributions += Number(row.sssEmployee) + Number(row.philHealthEmployee) + Number(row.pagIbigEmployee);
    taxWithheld += Number(row.taxWithheld);
    otherNonTaxable += Number(row.otherNonTaxable);
    if (Number(row.grossPay) > 0 && Number(row.basicSalaryEarned) <= 0 && Number(row.thirteenthMonth) <= 0) {
      blockers.push(
        `Migrated payroll row ${row.sourceReference} is missing Basic Salary Earned. Re-import it before approving final pay.`,
      );
    }
  }

  const releasedEnds = entryRows.map(({ run }) => String(run.periodEnd));
  const coverageThrough = releasedEnds.filter((date) => date <= lastDay).sort().at(-1) ?? null;
  const payrollPastLastDay = releasedEnds.find((date) => date > lastDay) ?? null;
  if (payrollPastLastDay) {
    blockers.push(
      `Released payroll extends past the employee's last day (${payrollPastLastDay}). Correct that payroll before approving final pay.`,
    );
  }
  if (coverageThrough !== lastDay && !input.finalPayrollVerified) {
    blockers.push(
      `Released payroll does not end on the last day. Verify the final unpaid payroll amounts for ${coverageThrough ? `the gap after ${coverageThrough}` : "the employee's unpaid service"} before approval.`,
    );
  }

  const pendingRetro = retroRows.filter((row) => row.status === "pending" && row.settledPayrollRunId == null && row.settledSeparationId == null);
  const pendingRetroTotal = money(pendingRetro.reduce((sum, row) => sum + Number(row.amount), 0));
  const pendingRetroBasicThisYear = money(pendingRetro.reduce((sum, row) => {
    return sum + (eligibleRetroIds.has(row.id) ? Number(row.amount) : 0);
  }, 0));

  const unpaidBasicSalary = money(Math.max(0, Number(input.unpaidBasicSalary) || 0));
  const otherUnpaidTaxableEarnings = money(Math.max(0, Number(input.otherUnpaidTaxableEarnings) || 0));
  const additionalThirteenthMonthBasic = money(Math.max(0, Number(input.additionalThirteenthMonthBasic) || 0));

  basicSalaryEarned = money(
    basicSalaryEarned + pendingRetroBasicThisYear + unpaidBasicSalary + additionalThirteenthMonthBasic,
  );

  if (!employee.thirteenthMonthEligible && !employee.thirteenthMonthExclusionReason?.trim()) {
    blockers.push("13th-month pay is marked ineligible but no exclusion reason is recorded on the employee profile.");
  }

  const thirteenth = computeThirteenthMonthBalance({
    basicSalaryEarned,
    alreadyPaid: thirteenthAlreadyPaid,
    eligible: employee.thirteenthMonthEligible,
  });

  const balances = await db.select().from(leaveBalances).where(and(
    eq(leaveBalances.organizationId, input.organizationId),
    eq(leaveBalances.employeeId, employee.id),
    eq(leaveBalances.year, taxYear),
  ));
  const availableLeaveDays = money(balances.reduce((sum, balance) => {
    return sum + Math.max(0, Number(balance.opening) + Number(balance.accrued) - Number(balance.used) - Number(balance.pending));
  }, 0));
  const unusedLeaveCredits = money(Math.max(0, Number(input.unusedLeaveCredits) || 0));
  if (unusedLeaveCredits > availableLeaveDays + 0.001) {
    blockers.push(
      `Convertible leave entered (${unusedLeaveCredits} day(s)) exceeds the current recorded available balance (${availableLeaveDays} day(s)).`,
    );
  }
  if (unusedLeaveCredits > 0 && !input.leaveBasisNote.trim()) {
    blockers.push("State the policy or leave type that makes the entered unused leave credits cash-convertible.");
  }
  const leaveMonetizationPay = money(unusedLeaveCredits * profileAtSeparation.dailyRate);

  const separation = computeStatutorySeparationPay({
    cause: input.separationType,
    monthlyEquivalent: profileAtSeparation.monthlyEquivalent,
    startDate: String(employee.startDate),
    lastDay,
  });

  const authorizedNoticeCauses: SeparationCause[] = [
    "labor_saving_device",
    "redundancy",
    "retrenchment",
    "closure_not_serious_losses",
  ];
  if (authorizedNoticeCauses.includes(input.separationType) && daysBetween(noticeDate, lastDay) < 30) {
    blockers.push("This authorized-cause separation has less than 30 days between notice and the intended termination date.");
  }

  const retirement = computeStatutoryRetirementPay({
    dailyRate: profileAtSeparation.dailyRate,
    startDate: String(employee.startDate),
    lastDay,
    birthDate: employee.birthDate,
  });
  const retirementPlanBenefit = money(Math.max(0, Number(input.retirementPlanBenefit) || 0));
  let retirementPay = 0;
  if (input.separationType === "retirement") {
    if (retirement.eligible) {
      retirementPay = money(Math.max(retirement.amount, retirementPlanBenefit));
    } else if (retirementPlanBenefit > 0 && input.retirementPlanReference.trim()) {
      retirementPay = retirementPlanBenefit;
    } else {
      blockers.push(retirement.blocker ?? "Retirement basis needs review.");
    }
    if (retirementPlanBenefit > 0 && !input.retirementPlanReference.trim()) {
      blockers.push("Provide the retirement plan, CBA, or agreement reference for a manual retirement benefit.");
    }
  }

  const loans = await db.select().from(employeeLoans).where(and(
    eq(employeeLoans.organizationId, input.organizationId),
    eq(employeeLoans.employeeId, employee.id),
    eq(employeeLoans.status, "active"),
  )).orderBy(asc(employeeLoans.id));
  const outstandingLoanBalance = money(loans.reduce((sum, loan) => sum + Math.max(0, Number(loan.remainingBalance)), 0));
  const loanDeductions = input.deductOutstandingLoans ? outstandingLoanBalance : 0;

  const additionalCompanyBenefit = money(Math.max(0, Number(input.additionalCompanyBenefit) || 0));
  const separationPayTaxExempt = Boolean(
    input.separationPayTaxExemptConfirmed
      && ["labor_saving_device", "redundancy", "retrenchment", "closure_not_serious_losses", "closure_serious_losses", "disease"].includes(input.separationType),
  );
  const retirementPayTaxExempt = Boolean(
    input.separationType === "retirement"
      && (retirement.eligible || input.retirementTaxExemptConfirmed),
  );

  const tax = computeFinalPayTaxAdjustment({
    grossCompensationBeforeFinalPay: grossCompensation,
    thirteenthMonthPaidBeforeFinalPay: thirteenthAlreadyPaid,
    statutoryContributions,
    taxWithheld,
    otherNonTaxable,
    finalUnpaidBasicSalary: unpaidBasicSalary,
    finalOtherTaxableEarnings:
      otherUnpaidTaxableEarnings
      + pendingRetroTotal
      + (input.additionalCompanyBenefitTaxable ? additionalCompanyBenefit : 0),
    finalOtherNonTaxableEarnings:
      input.additionalCompanyBenefitTaxable ? 0 : additionalCompanyBenefit,
    thirteenthMonthBalance: thirteenth.balanceDue,
    leaveMonetization: leaveMonetizationPay,
    statutorySeparationPay: separation.amount,
    statutoryRetirementPay: retirementPay,
    separationPayTaxExempt,
    retirementPayTaxExempt,
    mwe: employee.mwe,
  });

  const taxAdjustment = money(tax.adjustment);
  const earnings = money(
    unpaidBasicSalary
      + otherUnpaidTaxableEarnings
      + pendingRetroTotal
      + thirteenth.balanceDue
      + leaveMonetizationPay
      + separation.amount
      + retirementPay
      + additionalCompanyBenefit,
  );
  const netFinalPay = money(Math.max(0, earnings - loanDeductions - taxAdjustment));

  const snapshot = {
    inputs: {
      organizationId: input.organizationId,
      employeeId: input.employeeId,
      separationType: input.separationType,
      noticeDate,
      lastDay,
      unusedLeaveCredits,
      leaveBasisNote: input.leaveBasisNote.trim(),
      finalPayrollVerified: input.finalPayrollVerified,
      unpaidBasicSalary,
      otherUnpaidTaxableEarnings,
      additionalThirteenthMonthBasic,
      deductOutstandingLoans: input.deductOutstandingLoans,
      separationPayTaxExemptConfirmed: input.separationPayTaxExemptConfirmed,
      retirementPlanBenefit,
      retirementPlanReference: input.retirementPlanReference.trim(),
      retirementTaxExemptConfirmed: input.retirementTaxExemptConfirmed,
      additionalCompanyBenefit,
      additionalCompanyBenefitTaxable: input.additionalCompanyBenefitTaxable,
    },
    employeeId: employee.id,
    employeeNo: employee.employeeNo,
    separationType: input.separationType,
    noticeDate,
    lastDay,
    finalPayDueDate: finalPayDueDate(lastDay),
    payProfileAtSeparation: {
      payBasis: profileAtSeparation.payBasis,
      rateAmount: profileAtSeparation.rateAmount,
      monthlyEquivalent: profileAtSeparation.monthlyEquivalent,
      dailyRate: profileAtSeparation.dailyRate,
      hourlyRate: profileAtSeparation.hourlyRate,
    },
    payrollCoverage: {
      releasedThrough: coverageThrough,
      payrollPastLastDay,
      finalPayrollVerified: input.finalPayrollVerified,
      unpaidBasicSalary,
      otherUnpaidTaxableEarnings,
    },
    thirteenthMonth: {
      eligible: thirteenth.eligible,
      exclusionReason: employee.thirteenthMonthExclusionReason,
      basicSalaryEarned: thirteenth.basicSalaryEarned,
      alreadyPaid: thirteenth.alreadyPaid,
      entitlement: thirteenth.entitlement,
      balanceDue: thirteenth.balanceDue,
      overpaid: thirteenth.overpaid,
      additionalBasicSalary: additionalThirteenthMonthBasic,
    },
    retro: {
      pendingIds: pendingRetro.map((row) => row.id),
      pendingTotal: pendingRetroTotal,
      currentYearBasic: pendingRetroBasicThisYear,
    },
    leave: {
      availableDays: availableLeaveDays,
      convertibleDays: unusedLeaveCredits,
      basisNote: input.leaveBasisNote.trim(),
      monetizationPay: leaveMonetizationPay,
    },
    separationPay: {
      years: separation.years,
      basis: separation.basis,
      amount: separation.amount,
      taxExemptConfirmed: separationPayTaxExempt,
    },
    retirement: {
      ...retirement,
      planBenefit: retirementPlanBenefit,
      planReference: input.retirementPlanReference.trim(),
      amount: retirementPay,
      taxExempt: retirementPayTaxExempt,
    },
    companyBenefit: {
      amount: additionalCompanyBenefit,
      taxable: input.additionalCompanyBenefitTaxable,
    },
    loans: {
      ids: loans.map((loan) => loan.id),
      outstandingBalance: outstandingLoanBalance,
      deductFromFinalPay: input.deductOutstandingLoans,
      deduction: loanDeductions,
    },
    tax: {
      grossCompensationBeforeFinalPay: money(grossCompensation),
      statutoryContributions: money(statutoryContributions),
      taxWithheld: money(taxWithheld),
      otherNonTaxable: money(otherNonTaxable),
      annualized: tax,
      adjustment: taxAdjustment,
    },
    earnings,
    netFinalPay,
    blockers,
  };

  const calculationKey = stableHash({
    employee: {
      id: employee.id,
      status: employee.status,
      startDate: employee.startDate,
      birthDate: employee.birthDate,
      thirteenthMonthEligible: employee.thirteenthMonthEligible,
      thirteenthMonthExclusionReason: employee.thirteenthMonthExclusionReason,
    },
    inputs: {
      ...input,
      organizationId: input.organizationId,
      employeeId: input.employeeId,
    },
    payroll: currentYearEntries.map(({ entry, run }) => ({
      entryId: entry.id,
      runId: run.id,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      grossPay: entry.grossPay,
      deductions: entry.deductions,
      netPay: entry.netPay,
      lineItems: entry.lineItems,
      trace: entry.trace,
    })),
    importedHistory: importedCurrentYear.map((row) => ({
      id: row.id,
      sourceReference: row.sourceReference,
      payDate: row.payDate,
      grossPay: row.grossPay,
      basicSalaryEarned: row.basicSalaryEarned,
      otherNonTaxable: row.otherNonTaxable,
      taxWithheld: row.taxWithheld,
      thirteenthMonth: row.thirteenthMonth,
    })),
    payRevisions: payRevisions.map((row) => ({
      id: row.id,
      effectiveDate: row.effectiveDate,
      newPayBasis: row.newPayBasis,
      newRateAmount: row.newRateAmount,
    })),
    retro: retroRows.map((row) => ({
      id: row.id,
      amount: row.amount,
      status: row.status,
      settledPayrollRunId: row.settledPayrollRunId,
      settledSeparationId: row.settledSeparationId,
    })),
    leaveBalances: balances.map((row) => ({
      id: row.id,
      leaveType: row.leaveType,
      opening: row.opening,
      accrued: row.accrued,
      used: row.used,
      pending: row.pending,
    })),
    loans: loans.map((loan) => ({
      id: loan.id,
      remainingBalance: loan.remainingBalance,
      status: loan.status,
    })),
  });

  return {
    employee,
    calculationKey,
    snapshot,
    columns: {
      prorated13thMonth: thirteenth.balanceDue,
      unusedLeaveCredits,
      leaveMonetizationPay,
      taxAdjustment,
      loanDeductions,
      netFinalPay,
      finalPayDueDate: finalPayDueDate(lastDay),
    },
  };
}
