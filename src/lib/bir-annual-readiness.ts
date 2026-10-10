/**
 * Local BIR 1604-C / 2316 source-readiness checks.
 *
 * This is NOT BIR ADES validation or certification. No official .DAT output
 * may be generated from these checks alone. The taxpayer still needs official
 * BIR validation and an independently reviewed filing acknowledgement.
 */
export type BirAnnualRow = {
  employeeId: number;
  employeeNo: string;
  tin: string | null | undefined;
  tinBranchCode: string | null | undefined;
  firstName: string;
  lastName: string;
  mwe: boolean;
  grossCompensation: number | string;
  nonTaxable: number | string;
  taxableIncome: number | string;
  taxDue: number | string;
  taxWithheld: number | string;
  adjustment: number | string;
  outcome: string;
  status: string;
};

export type BirAnnualIssue = {
  severity: "blocker" | "warning";
  code: string;
  message: string;
  employeeNo?: string;
};

export type BirAnnualReadinessInput = {
  taxYear: number;
  employerTin?: string | null;
  employerBranchCode?: string | null;
  legalEmployerCount: number;
  rows: BirAnnualRow[];
  payrollEmployeeIds: number[];
  releasedPayrollRunCount: number;
  importedHistoryCount?: number;
  payrollMonths?: string[];
  bir1601cMonths?: Array<{ month: string; reconciled: boolean }>;
  mismatchedLegalEmployerRunIds?: number[];
};

const digits = (value: string | null | undefined) => String(value ?? "").replace(/\D/g, "");
const cents = (value: number | string) => {
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) < 1e12 ? Math.round(number * 100) : null;
};

export function evaluateBirAnnualReadiness(input: BirAnnualReadinessInput) {
  const issues: BirAnnualIssue[] = [];
  const add = (severity: BirAnnualIssue["severity"], code: string, message: string, employeeNo?: string) => {
    issues.push({ severity, code, message, ...(employeeNo ? { employeeNo } : {}) });
  };

  if (!Number.isInteger(input.taxYear) || input.taxYear < 2018 || input.taxYear > 2100) {
    add("blocker", "INVALID_TAX_YEAR", "Select a valid tax year before preparing BIR records.");
  }
  if (input.legalEmployerCount !== 1) {
    add("blocker", "LEGAL_EMPLOYER_SCOPE",
      "This annualization is organization-wide. Configure exactly one active legal employer; multi-employer 1604-C and 2316 filings require employer-scoped annualization.");
  }
  if (digits(input.employerTin).length !== 9 || digits(input.employerBranchCode).length !== 4) {
    add("blocker", "EMPLOYER_BIR_ID",
      "The legal employer requires a 9-digit BIR TIN and a 4-digit branch code.");
  }
  if (input.mismatchedLegalEmployerRunIds?.length) {
    add("blocker", "MIXED_LEGAL_EMPLOYER_RUNS",
      "Released payroll includes runs belonging to a different legal employer. Resolve the employer scope before annual filing.");
  }
  if (!input.rows.length) {
    add("blocker", "NO_ANNUALIZATION", "No year-end annualization rows were found. Compute and review annualization first.");
  }

  const seenEmployees = new Set<number>();
  const seenEmployeeNos = new Set<string>();
  const seenTins = new Set<string>();
  const annualized = new Set<number>();
  let annualGrossCents = 0;
  let annualTaxDueCents = 0;
  let annualTaxWithheldCents = 0;

  for (const row of input.rows) {
    const employeeNo = String(row.employeeNo ?? "").trim() || "(missing employee number)";
    annualized.add(row.employeeId);
    if (seenEmployees.has(row.employeeId)) {
      add("blocker", "DUPLICATE_EMPLOYEE", "Duplicate annualization rows for the same employee.", employeeNo);
    }
    seenEmployees.add(row.employeeId);
    if (seenEmployeeNos.has(employeeNo.toUpperCase())) {
      add("blocker", "DUPLICATE_EMPLOYEE_NO", "Duplicate employee number in the annual Alphalist.", employeeNo);
    }
    seenEmployeeNos.add(employeeNo.toUpperCase());

    const tin = digits(row.tin);
    const branch = digits(row.tinBranchCode);
    if (tin.length !== 9 || branch.length !== 4) {
      add("blocker", "EMPLOYEE_BIR_ID", "Employee requires a 9-digit TIN and 4-digit branch code.", employeeNo);
    } else {
      const identity = tin + ":" + branch;
      if (seenTins.has(identity)) {
        add("blocker", "DUPLICATE_EMPLOYEE_TIN", "Employee TIN/branch combination is already used by another employee.", employeeNo);
      }
      seenTins.add(identity);
    }
    if (!String(row.firstName ?? "").trim() || !String(row.lastName ?? "").trim()) {
      add("blocker", "EMPLOYEE_NAME", "Employee legal first and last names are required.", employeeNo);
    }

    const gross = cents(row.grossCompensation);
    const nonTaxable = cents(row.nonTaxable);
    const taxable = cents(row.taxableIncome);
    const due = cents(row.taxDue);
    const withheld = cents(row.taxWithheld);
    const adjustment = cents(row.adjustment);
    if ([gross, nonTaxable, taxable, due, withheld, adjustment].some((v) => v === null)) {
      add("blocker", "INVALID_ANNUAL_AMOUNT", "Annual compensation or withholding has an invalid amount.", employeeNo);
      continue;
    }

    const safeGross = gross!;
    const safeNonTaxable = nonTaxable!;
    const safeTaxable = taxable!;
    const safeDue = due!;
    const safeWithheld = withheld!;
    const safeAdjustment = adjustment!;
    annualGrossCents += safeGross;
    annualTaxDueCents += safeDue;
    annualTaxWithheldCents += safeWithheld;

    if ([safeGross, safeNonTaxable, safeTaxable, safeDue, safeWithheld].some((v) => v < 0)
      || safeTaxable > safeGross + 1) {
      add("blocker", "IMPOSSIBLE_ANNUAL_AMOUNT", "Check negative amounts or taxable income exceeding gross compensation.", employeeNo);
    }
    if (!row.mwe && Math.abs(safeGross - safeNonTaxable - safeTaxable) > 1) {
      add("blocker", "ANNUAL_TAXABLE_SPLIT", "Gross compensation does not reconcile to taxable and non-taxable compensation.", employeeNo);
    }
    // The annualization adjustment is tax due MINUS taxes already withheld.
    // When settled, final actual withholding must be independently reconciled
    // against the payroll ledger and the filed BIR 1601-C monthly returns.
    if (Math.abs(safeDue - safeWithheld - safeAdjustment) > 1) {
      add("blocker", "YEAR_END_TAX_VARIANCE", "Tax due does not equal withholding plus the year-end adjustment.", employeeNo);
    }
    const expectedOutcome = safeAdjustment < 0 ? "refund" : safeAdjustment > 0 ? "collect" : "balanced";
    if (row.outcome !== expectedOutcome) {
      add("blocker", "ADJUSTMENT_OUTCOME", "Refund/collection outcome disagrees with the year-end tax adjustment.", employeeNo);
    }
    if (safeAdjustment !== 0 && row.status !== "settled") {
      add("blocker", "ADJUSTMENT_UNSETTLED",
        "The year-end tax adjustment must be settled in released payroll before the source extract can be used for final filing review.", employeeNo);
    }
    if (row.status === "computed") {
      add("warning", "ANNUALIZATION_REVIEW",
        "Annualization is only computed; an independent payroll/tax review is still required.", employeeNo);
    }
  }

  const sourceIds = new Set(input.payrollEmployeeIds);
  if (sourceIds.size === 0) {
    add("blocker", "NO_PAYROLL_SOURCE",
      "No released payroll or imported historical payroll exists for the selected tax year.");
  }
  for (const employeeId of sourceIds) {
    if (!annualized.has(employeeId)) {
      add("blocker", "MISSING_ANNUAL_EMPLOYEE",
        "An employee present in the tax-year payroll source is missing from annualization.");
    }
  }
  if ((input.importedHistoryCount ?? 0) > 0) {
    add("warning", "IMPORTED_HISTORY_REVIEW",
      "Imported historical payroll amounts require independent reconciliation against prior provider records and BIR Form 2316.");
  }

  const reconciledMonths = new Map((input.bir1601cMonths ?? []).map((item) => [item.month, item.reconciled]));
  for (const month of new Set(input.payrollMonths ?? [])) {
    if (!reconciledMonths.get(month)) {
      add("warning", "MONTHLY_1601C_NOT_RECONCILED",
        `Reconcile BIR Form 1601-C filing and payment evidence for ${month} to the released payroll ledger.`);
    }
  }

  const blockers = issues.filter((issue) => issue.severity === "blocker");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  return {
    taxYear: input.taxYear,
    canExportSource: blockers.length === 0,
    filingReady: false as const,
    outputType: "source-csv-not-bir-dat" as const,
    requiredExternalStep: "Independent BIR Alphalist Data Entry and Validation Module validation, prescribed .DAT generation and actual BIR filing acceptance.",
    summary: {
      annualizedEmployees: input.rows.length,
      payrollEmployees: sourceIds.size,
      releasedPayrollRuns: input.releasedPayrollRunCount,
      importedHistoryRows: input.importedHistoryCount ?? 0,
      annualGrossCompensation: (annualGrossCents / 100).toFixed(2),
      annualTaxDue: (annualTaxDueCents / 100).toFixed(2),
      annualPreSettlementWithholding: (annualTaxWithheldCents / 100).toFixed(2),
      blockers: blockers.length,
      warnings: warnings.length,
    },
    blockers,
    warnings,
  };
}
