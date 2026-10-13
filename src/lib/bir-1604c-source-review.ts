import {
  validateBir1604cPreExport, type Bir1604CReviewedRecord,
  type Bir1604CPreExportIssue,
} from "./bir-1604c-pre-export";

/** Small, testable contract: the route supplies this from authenticated DB reads. */
export type Bir1604cSourceSnapshot = {
  employerTin: string;
  employerBranch: string;
  reconciliation: {
    sourceDigest: string;
    totals: { employees: number; payrollActualWithheld: string };
    issues: Array<{ code: string; severity: "blocker" | "warning"; message: string; employeeNo?: string }>;
    rows: Array<{
      employeeNo: string; mwe: boolean;
      payrollActualWithheld: string; annualTaxDue: string;
    }>;
  };
  employeeSources: Array<{
    employeeNo: string; firstName: string; middleName: string;
    lastName: string; nationality: string; tin: string; branch: string;
    mwe: boolean; taxableIncome: string; taxDue: string; legalEntityId: number | null;
  }>;
};
export type Bir1604cReviewedPayload = {
  taxYear: number;
  sourceDigest: string;
  records: Bir1604CReviewedRecord[];
};

const cents = (value: unknown): number | null => {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const text = String(value);
  if (!/^(0|[1-9][0-9]{0,10})(\.[0-9]{1,2})?$/.test(text)) return null;
  const parts = text.split(".");
  return Number(parts[0]) * 100 + Number((parts[1] ?? "").padEnd(2, "0"));
};
const exactMoney = (left: unknown, right: unknown) => {
  const a = cents(left), b = cents(right);
  return a !== null && b !== null && Math.abs(a - b) <= 1;
};
const sameName = (a: unknown, b: string) =>
  typeof a === "string" && a.trim().toUpperCase() === b.trim().toUpperCase();

/**
 * Hard stop against client-supplied employer identity or totals.
 *
 * The operator supplies all statutory fields with evidence. The DB remains the
 * authority for employer, employee population, BIR identities, MWE class, annual
 * tax/taxable income, released withholding and source fingerprint. "MWE premium
 * split needed" is the only reconciliation blocker that the independently
 * reviewed D2 premium evidence may satisfy for a DRAFT; all others are fatal.
 *
 * There is no claim that a reviewer-entered source proves previous-employer
 * income or that the government accepted the resulting file.
 */
export function bindBir1604cReviewToEmployer(
  input: Bir1604cReviewedPayload,
  source: Bir1604cSourceSnapshot,
  legalEntityId: number,
) {
  const issues: Bir1604CPreExportIssue[] = [];
  const add = (code: string, message: string, employeeNo?: string) =>
    issues.push({ code, message, ...(employeeNo ? { employeeNo } : {}) });

  if (!/^[a-f0-9]{64}$/i.test(input.sourceDigest) ||
      input.sourceDigest !== source.reconciliation.sourceDigest) {
    add("STALE_SOURCE", "Employer/year source changed; reconcile the employer again before exporting.");
  }
  const population = source.reconciliation.rows;
  if (source.reconciliation.totals.employees !== population.length)
    add("PAYROLL_POPULATION", "The employer reconciliation population itself is inconsistent.");
  if (!Array.isArray(input.records) || input.records.length !== population.length)
    add("REVIEW_POPULATION", "Reviewed records must match all employees paid by this exact legal employer.");
  if (!Array.isArray(input.records) || input.records.length > 500) {
    add("REVIEW_SIZE", "The candidate review is limited to 500 employees per request.");
    return { ok: false as const, issues };
  }

  const byNo = new Map(source.employeeSources.map(e => [e.employeeNo.toUpperCase(), e]));
  const paidByNo = new Map(population.map(r => [r.employeeNo.toUpperCase(), r]));
  if (byNo.size !== source.employeeSources.length ||
      paidByNo.size !== population.length) {
    add("SOURCE_EMPLOYEE_DUPLICATE", "The authoritative employer population contains repeated employee numbers.");
  }
  const reviewByNo = new Map<string, Bir1604CReviewedRecord>();
  for (const row of input.records) {
    if (!row || typeof row !== "object" || typeof row.employeeNo !== "string") {
      add("INVALID_REVIEW_ROW", "Every reviewed row needs an employee number.");
      continue;
    }
    const no = row.employeeNo.toUpperCase();
    if (reviewByNo.has(no)) {
      add("REVIEW_DUPLICATE", "Employee is duplicated in the reviewed records.", row.employeeNo);
    }
    reviewByNo.set(no, row);
    const employee = byNo.get(no), ledger = paidByNo.get(no);
    if (!employee || !ledger) {
      add("FOREIGN_EMPLOYEE", "Reviewed employee is not in this legal employer's released payroll population.", row.employeeNo);
      continue;
    }
    if (employee.legalEntityId !== legalEntityId) {
      add("EMPLOYER_DRIFT", "Employee master is assigned to a different legal employer.", row.employeeNo);
    }
    if (employee.mwe !== ledger.mwe || row.schedule !== (ledger.mwe ? "D2" : "D1")) {
      add("MWE_CLASS", "The reviewed D1/D2 schedule does not agree with recorded year-end minimum-wage classification.", row.employeeNo);
    }
    const fields = row.fields ?? {};
    if (!/^[0-9]{9}$/.test(employee.tin) || fields.TIN !== employee.tin)
      add("EMPLOYEE_TIN_MISMATCH", "Employee TIN is missing or differs from the protected employee record.", row.employeeNo);
    if (!/^[0-9]{4}$/.test(employee.branch) || fields.BRANCH_CODE !== employee.branch)
      add("EMPLOYEE_BRANCH_MISMATCH", "Employee branch is missing or differs from the protected employee record.", row.employeeNo);
    if (!sameName(fields.FIRST_NAME, employee.firstName) ||
        !sameName(fields.LAST_NAME, employee.lastName) ||
        !sameName(fields.MIDDLE_NAME, employee.middleName))
      add("EMPLOYEE_NAME_MISMATCH", "Reviewed first/middle/last names differ from payroll identity; correct or formally review before export.", row.employeeNo);
    if (!sameName(fields.NATIONALITY, employee.nationality))
      add("NATIONALITY_MISMATCH", "Reviewed nationality differs from the current employee master.", row.employeeNo);
    if (!exactMoney(fields.NET_TAXABLE_COMP_INCOME, employee.taxableIncome))
      add("TAXABLE_INCOME_MISMATCH", "Reviewed net taxable income does not reconcile to year-end payroll.", row.employeeNo);
    if (!exactMoney(fields.TAX_DUE, employee.taxDue) ||
        !exactMoney(fields.TAX_DUE, ledger.annualTaxDue))
      add("TAX_DUE_MISMATCH", "Reviewed annual tax due does not reconcile to the approved annual adjustment.", row.employeeNo);
    if (!exactMoney(fields.ACTUAL_AMT_WTHLD, ledger.payrollActualWithheld))
      add("EMPLOYEE_WITHHOLDING_MISMATCH", "Reviewed actual tax withheld does not reconcile to this employee's released payroll.", row.employeeNo);
  }
  for (const paid of population) {
    if (!reviewByNo.has(paid.employeeNo.toUpperCase())) {
      add("MISSING_EMPLOYEE_REVIEW", "Annual filing is missing one or more employees from released employer payroll.", paid.employeeNo);
    }
  }

  for (const item of source.reconciliation.issues) {
    if (item.severity !== "blocker") continue;
    if (item.code === "MWE_PREMIUM_SPLIT_REQUIRED") {
      // Only an actual D2 row with a separately reviewed split may resolve
      // this missing statutory schedule for a STRUCTURAL CANDIDATE.
      const review = reviewByNo.get((item.employeeNo ?? "").toUpperCase());
      if (review?.schedule === "D2" &&
          typeof review.mwePremiumEvidenceReference === "string" &&
          review.mwePremiumEvidenceReference.trim().length > 0) continue;
    }
    add("RECONCILIATION_" + item.code, item.message, item.employeeNo);
  }

  const ordered = [...input.records].sort((a,b) =>
    String(a?.employeeNo ?? "").localeCompare(String(b?.employeeNo ?? "")));
  const checked = validateBir1604cPreExport({
    taxYear: input.taxYear,
    employerTin: source.employerTin,
    employerBranch: source.employerBranch,
    expectedEmployees: source.reconciliation.totals.employees,
    expectedActualWithheld: source.reconciliation.totals.payrollActualWithheld,
    records: ordered,
  });
  issues.push(...checked.issues);
  return issues.length ? { ok: false as const, issues } : {
    ok: true as const, issues: [],
    input: {
      taxYear: input.taxYear,
      employerTin: source.employerTin,
      employerBranch: source.employerBranch,
      expectedEmployees: source.reconciliation.totals.employees,
      expectedActualWithheld: source.reconciliation.totals.payrollActualWithheld,
      records: ordered,
    },
  };
}
