import { createHash } from "node:crypto";
import { taxWithheldFromLineItems } from "@/lib/exporters";

/**
 * Conservative BIR compensation filing cross-check for ONE legal employer.
 * Does not rewrite the organization-wide payroll settlement ledger.
 * Cross-employer transfers and unattributed imported history fail closed.
 */
export type BirEmployerRun = {
  id: number;
  legalEntityId: number | null;
  payDate: string;
  status: string;
};
export type BirEmployerEntry = {
  payrollRunId: number;
  employeeId: number;
  grossPay: number | string;
  lineItems: unknown;
};
export type BirEmployerAnnualRow = {
  employeeId: number;
  employeeNo: string;
  firstName: string;
  lastName: string;
  employeeLegalEntityId: number | null;
  mwe: boolean;
  grossCompensation: number | string;
  nonTaxable: number | string;
  taxableIncome: number | string;
  taxDue: number | string;
  taxWithheld: number | string;
  adjustment: number | string;
  status: string;
};
export type BirEmployerIssue = {
  code: string;
  severity: "blocker" | "warning";
  message: string;
  employeeNo?: string;
  month?: string;
};
export type BirEmployerReconciliationInput = {
  legalEntityId: number;
  taxYear: number;
  runs: BirEmployerRun[];
  entries: BirEmployerEntry[];
  annualized: BirEmployerAnnualRow[];
  historicalEmployeeIds: number[];
  monthlyBatches: Array<{
    applicableMonth: string;
    status: string;
    expectedTaxWithheld: string | number;
  }>;
};
const roundCents = (amount: string | number) => {
  const n = Number(amount);
  return Number.isFinite(n) && Math.abs(n) <= 1e11 ? Math.round(n * 100) : null;
};
const asAmount = (centavos: number) => (centavos / 100).toFixed(2);

export function reconcileBirEmployerYear(input: BirEmployerReconciliationInput) {
  const issues: BirEmployerIssue[] = [];
  const add = (code: string, severity: BirEmployerIssue["severity"], message: string,
    employeeNo?: string, month?: string) =>
    issues.push({ code, severity, message, ...(employeeNo ? { employeeNo } : {}), ...(month ? { month } : {}) });
  const active = input.runs.filter(run => run.status === "Released");
  const runById = new Map(active.map(run => [run.id, run]));
  const selectedRunIds = new Set(active.filter(run => run.legalEntityId === input.legalEntityId).map(run => run.id));
  const selected = input.entries.filter(entry => selectedRunIds.has(entry.payrollRunId));
  const employeesByEntity = new Map<number, Set<number | null>>();
  const allPayrollEmployeeIds = new Set<number>();
  for (const entry of input.entries) {
    const run = runById.get(entry.payrollRunId);
    if (!run) continue;
    let ids = employeesByEntity.get(entry.employeeId);
    if (!ids) { ids = new Set(); employeesByEntity.set(entry.employeeId, ids); }
    ids.add(run.legalEntityId);
    if (run.legalEntityId === input.legalEntityId) allPayrollEmployeeIds.add(entry.employeeId);
  }
  for (const run of input.runs) {
    if (run.legalEntityId === input.legalEntityId && run.status !== "Released") {
      add("UNRELEASED_PAYROLL", "blocker", "A run paid in this tax year has not been released.");
    }
  }
  if (!selected.length) {
    add("NO_RELEASED_PAYROLL", "blocker", "No released payroll entries belong to the selected legal employer.");
  }

  const years = new Map<number, { withheld: number; gross: number; months: Map<string, number> }>();
  const monthlyLedger = new Map<string, number>();
  for (const entry of selected) {
    const run = runById.get(entry.payrollRunId)!;
    const withheld = taxWithheldFromLineItems(entry.lineItems);
    const withheldCents = roundCents(withheld);
    const grossCents = roundCents(entry.grossPay);
    if (withheldCents === null || grossCents === null) {
      add("INVALID_PAYROLL_AMOUNT", "blocker", "Released payroll contains an invalid gross or tax amount.");
      continue;
    }
    const month = run.payDate.slice(0, 7);
    const summary = years.get(entry.employeeId) ?? { withheld: 0, gross: 0, months: new Map() };
    summary.withheld += withheldCents;
    summary.gross += grossCents;
    summary.months.set(month, (summary.months.get(month) ?? 0) + withheldCents);
    years.set(entry.employeeId, summary);
    monthlyLedger.set(month, (monthlyLedger.get(month) ?? 0) + withheldCents);
  }

  const annualById = new Map(input.annualized.map(row => [row.employeeId, row]));
  const imported = new Set(input.historicalEmployeeIds);
  const rows: Array<{
    employeeId: number; employeeNo: string; name: string; mwe: boolean;
    yearEndStatus: string; payrollGross: string; payrollActualWithheld: string;
    annualTaxDue: string; annualizedGross: string; yearEndAdjustment: string;
  }> = [];
  let withholding = 0;
  let taxDue = 0;
  for (const [employeeId, ledger] of years) {
    const annual = annualById.get(employeeId);
    const employeeNo = annual?.employeeNo ?? `employee #${employeeId}`;
    withholding += ledger.withheld;
    const scoped = employeesByEntity.get(employeeId) ?? new Set<number | null>();
    if (scoped.size !== 1 || !scoped.has(input.legalEntityId)) {
      add("CROSS_EMPLOYER_PAY", "blocker",
        "Employee has payroll from another legal employer or from an unattributed payroll run. Annualization cannot safely allocate withholding.",
        employeeNo);
    }
    if (imported.has(employeeId)) {
      add("IMPORTED_HISTORY_SCOPE", "blocker",
        "Historical payroll has no legal-employer ID. Verify and attribute it before producing an employer filing.", employeeNo);
    }
    if (!annual) {
      add("ANNUALIZATION_MISSING", "blocker", "Payroll employee is missing from year-end annualization.", employeeNo);
      continue;
    }
    if (annual.employeeLegalEntityId !== input.legalEntityId) {
      add("EMPLOYEE_ENTITY_DRIFT", "blocker",
        "Employee master currently belongs to a different legal employer. Verify the historical employment interval.",
        employeeNo);
    }
    const before = roundCents(annual.taxWithheld);
    const adjustment = roundCents(annual.adjustment);
    const due = roundCents(annual.taxDue);
    if (before === null || adjustment === null || due === null) {
      add("INVALID_YEAR_END", "blocker", "Year-end amounts are not valid peso values.", employeeNo);
      continue;
    }
    taxDue += due;
    if (annual.status !== "settled" && adjustment !== 0) {
      add("UNSETTLED_YEAR_END", "blocker", "Tax refund or collection is not settled in released payroll.", employeeNo);
    }
    if (Math.abs(before + adjustment - ledger.withheld) > 1) {
      add("WITHHOLDING_MISMATCH", "blocker",
        "Annualized pre-settlement withholding and the settled adjustment do not equal actual released-payroll withholding.", employeeNo);
    }
    if (Math.abs(due - ledger.withheld) > 1) {
      add("TAX_DUE_MISMATCH", "blocker",
        "Actual payroll withholding does not agree with annual tax due. Reconcile refunds, corrections and remittances.", employeeNo);
    }
    const gross = roundCents(annual.grossCompensation);
    if (gross !== null && gross > ledger.gross + 1) {
      add("UNPAID_COMPENSATION_REVIEW", "warning",
        "Annualization gross exceeds released payroll gross; review 13th-month accrual and reimbursements before filing.", employeeNo);
    }
    if (annual.mwe) {
      add("MWE_PREMIUM_SPLIT_REQUIRED", "blocker",
        "BIR Schedule D2 requires separate statutory wage, holiday, OT, night differential and hazard components, not only annual aggregates.", employeeNo);
    }
    rows.push({
      employeeId, employeeNo, name: `${annual.lastName}, ${annual.firstName}`, mwe: annual.mwe,
      yearEndStatus: annual.status,
      payrollGross: asAmount(ledger.gross),
      payrollActualWithheld: asAmount(ledger.withheld),
      annualTaxDue: asAmount(due),
      annualizedGross: String(annual.grossCompensation),
      yearEndAdjustment: asAmount(adjustment),
    });
  }
  for (const employeeId of imported) {
    const employee = annualById.get(employeeId);
    if (employee?.employeeLegalEntityId === input.legalEntityId && !years.has(employeeId)) {
      add("IMPORTED_ONLY_EMPLOYEE", "blocker",
        "Employee appears only in unattributed imported payroll history; employer scope cannot be established.",
        employee.employeeNo);
    }
  }

  const batches = new Map(input.monthlyBatches.map(item => [item.applicableMonth, item]));
  const monthly: Array<{ month: string; payrollWithheld: string; reportedWithheld: string | null; state: string }> = [];
  for (const [month, tax] of [...monthlyLedger].sort(([a], [b]) => a.localeCompare(b))) {
    const batch = batches.get(month);
    const reportedCents = batch ? roundCents(batch.expectedTaxWithheld) : null;
    if (!batch || batch.status !== "reconciled") {
      add("MONTHLY_1601C_NOT_RECONCILED", "blocker",
        "No accepted, matched and paid BIR 1601-C month-close evidence is recorded.", undefined, month);
    } else if (reportedCents === null || Math.abs(reportedCents - tax) > 1) {
      add("MONTHLY_1601C_AMOUNT_MISMATCH", "blocker",
        "BIR 1601-C recorded liability differs from released payroll withholding.", undefined, month);
    }
    monthly.push({ month, payrollWithheld: asAmount(tax),
      reportedWithheld: reportedCents === null ? null : asAmount(reportedCents),
      state: batch?.status ?? "missing" });
  }
  const blockers = issues.filter(issue => issue.severity === "blocker");
  const sourceDigest = createHash("sha256").update(JSON.stringify({
    legalEntityId: input.legalEntityId, taxYear: input.taxYear,
    rows: [...rows].sort((a,b)=>a.employeeId-b.employeeId), monthly,
  })).digest("hex");
  return {
    legalEntityId: input.legalEntityId, taxYear: input.taxYear,
    sourceDigest, sourceStatus: blockers.length ? "blocked" as const : "review-required" as const,
    canGenerateDat: false as const,
    certification: "NOT BIR-VALIDATED",
    totals: {
      employees: rows.length, payrollRuns: selectedRunIds.size,
      grossFromPayroll: asAmount([...years.values()].reduce((s,r)=>s+r.gross,0)),
      payrollActualWithheld: asAmount(withholding), annualTaxDue: asAmount(taxDue),
      blockers: blockers.length, warnings: issues.length-blockers.length,
    },
    rows: rows.sort((a,b)=>a.name.localeCompare(b.name)),
    monthly, issues,
  };
}
