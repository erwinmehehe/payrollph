/**
 * M-10 read-only review of fictional or explicitly supplied statutory evidence.
 *
 * This is NOT a statutory retro attribution rule, a payroll correction, or an
 * agency remittance workflow. It never selects an assessed contribution month,
 * uses an agency rate, approves an adjustment, emits a remittance file, or writes
 * money. An original work month is evidence, not a filing instruction.
 *
 * Source proof and worksheet amounts MUST be independently checked before
 * real use. This pure function cannot authenticate a receipt or reviewer.
 */
export type M10Agency = "SSS" | "Pag-IBIG";

export type M10RemittanceState =
  | "unfiled"
  | "submitted_unposted"
  | "paid_unposted"
  | "posted"
  | "correction_accepted"
  | "rejected"
  | "unknown";

export type M10SssShares = Readonly<{
  agency: "SSS";
  employeeRegularCentavos: number;
  employeeMpfCentavos: number;
  employerRegularCentavos: number;
  employerMpfCentavos: number;
  employerEcCentavos: number;
}>;

export type M10PagIbigShares = Readonly<{
  agency: "Pag-IBIG";
  employeeSavingsCentavos: number;
  employerSavingsCentavos: number;
}>;

export type M10WorksheetShares = M10SssShares | M10PagIbigShares;

/** Signed arithmetic differences, NOT assessed or collectible contributions. */
export type M10WorksheetDifference = M10WorksheetShares & Readonly<{
  totalCentavos: number;
}>;

export type M10ReviewInput = Readonly<{
  caseId: string;
  agency: M10Agency;
  organizationId: number;
  employeeId: number;
  adjustmentId: number;
  sourceRunId: number | null;
  sourceEntryId: number | null;
  sourceOrganizationId: number | null;
  sourceEntryEmployeeId: number | null;
  sourceRunStatus: string | null;
  sourcePeriodStart: string | null;
  sourcePeriodEnd: string | null;
  correctionPeriodStart: string;
  correctionPeriodEnd: string;
  /** Intentionally integer money: never infer cents from rounded floats. */
  wageDeltaCentavos: number;
  remittanceState: M10RemittanceState;
  submissionReference?: string | null;
  originalReceiptReference?: string | null;
  correctionReceiptReference?: string | null;
  rejectionReference?: string | null;
  /** Reviewer supplied, never derived from source, payroll, or posting dates. */
  candidateContributionMonth?: string | null;
  /** Independently entered hypothetical worksheets; never approved liability. */
  originalWorksheetShares?: M10WorksheetShares | null;
  revisedWorksheetShares?: M10WorksheetShares | null;
  /** Explicitly cannot override statutory review gates. */
  acknowledgeExceptions?: boolean;
}>;

export type M10ReviewIssue =
  | "INVALID_CASE_ID"
  | "INVALID_IDENTITY"
  | "INVALID_WAGE_CENTAVOS"
  | "SOURCE_NOT_RELEASED"
  | "SOURCE_TENANT_MISMATCH"
  | "SOURCE_EMPLOYEE_MISMATCH"
  | "SOURCE_RUN_OR_ENTRY_MISSING"
  | "SOURCE_MONTH_UNVERIFIED"
  | "CORRECTION_MONTH_UNVERIFIED"
  | "INVALID_CANDIDATE_MONTH"
  | "UNKNOWN_REMITTANCE_STATE"
  | "SUBMISSION_REFERENCE_MISSING"
  | "PAYMENT_RECEIPT_MISSING"
  | "CORRECTION_RECEIPT_MISSING"
  | "REJECTION_REFERENCE_MISSING"
  | "PARTIAL_WORKSHEET"
  | "INVALID_WORKSHEET_CENTAVOS"
  | "ZERO_WAGE_WITH_NONZERO_WORKSHEET"
  | "DUPLICATE_CASE";

export type M10ReviewRow = Readonly<{
  caseId: string;
  agency: M10Agency;
  organizationId: number;
  employeeId: number;
  adjustmentId: number;
  caseKey: string | null;
  sourceWorkMonth: string | null;
  payrollCorrectionMonth: string | null;
  /** Null without a specific reviewer-supplied month. */
  candidateContributionMonth: string | null;
  remittanceState: M10RemittanceState;
  wageDeltaCentavos: number | null;
  sourceDiffersFromPayrollMonth: boolean | null;
  evidenceIssues: readonly M10ReviewIssue[];
  evidenceStatus: "NEEDS_EVIDENCE" | "POLICY_UNRESOLVED";
  sssPolicyDecision: "NOT_OBTAINED";
  pagIbigPolicyDecision: "NOT_OBTAINED";
  /** Worksheet-only difference; null means UNKNOWN, not zero. */
  hypotheticalWorksheetDifference: M10WorksheetDifference | null;
  approvedAgencyLiabilityCentavos: null;
  /** Remains false even with acknowledgeExceptions=true. */
  canPostAgencyCorrection: false;
  agencyFilingAction: "NOT_AUTHORIZED";
}>;

const STATES: readonly M10RemittanceState[] = [
  "unfiled", "submitted_unposted", "paid_unposted", "posted",
  "correction_accepted", "rejected", "unknown",
];

function validId(value: number | null): value is number {
  return Number.isSafeInteger(value) && value !== null && value > 0;
}

function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function singleMonth(start: string | null, end: string | null): string | null {
  if (!validDate(start) || !validDate(end) || start > end) return null;
  return start.slice(0, 7) === end.slice(0, 7) ? start.slice(0, 7) : null;
}

function validMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function validCentavos(value: number): boolean {
  return Number.isSafeInteger(value) && Number.isFinite(value);
}

function validSnapshot(snapshot: M10WorksheetShares, agency: M10Agency): boolean {
  if (snapshot.agency !== agency) return false;
  const fields = snapshot.agency === "SSS"
    ? [
      snapshot.employeeRegularCentavos, snapshot.employeeMpfCentavos,
      snapshot.employerRegularCentavos, snapshot.employerMpfCentavos,
      snapshot.employerEcCentavos,
    ]
    : [snapshot.employeeSavingsCentavos, snapshot.employerSavingsCentavos];
  return fields.every(value => validCentavos(value) && value >= 0)
    && validCentavos(fields.reduce((sum, value) => sum + value, 0));
}

/**
 * Compute *only* the signed subtraction of two externally provided worksheets.
 * This neither validates the statutory month/rate nor authorizes collection.
 */
function worksheetDifference(
  agency: M10Agency,
  original: M10WorksheetShares,
  revised: M10WorksheetShares,
): M10WorksheetDifference | null {
  if (!validSnapshot(original, agency) || !validSnapshot(revised, agency)) return null;
  if (original.agency === "SSS" && revised.agency === "SSS") {
    const fields = {
      agency: "SSS" as const,
      employeeRegularCentavos: revised.employeeRegularCentavos - original.employeeRegularCentavos,
      employeeMpfCentavos: revised.employeeMpfCentavos - original.employeeMpfCentavos,
      employerRegularCentavos: revised.employerRegularCentavos - original.employerRegularCentavos,
      employerMpfCentavos: revised.employerMpfCentavos - original.employerMpfCentavos,
      employerEcCentavos: revised.employerEcCentavos - original.employerEcCentavos,
    };
    const totalCentavos = fields.employeeRegularCentavos + fields.employeeMpfCentavos
      + fields.employerRegularCentavos + fields.employerMpfCentavos + fields.employerEcCentavos;
    return validCentavos(totalCentavos) ? { ...fields, totalCentavos } : null;
  }
  if (original.agency === "Pag-IBIG" && revised.agency === "Pag-IBIG") {
    const employeeSavingsCentavos = revised.employeeSavingsCentavos - original.employeeSavingsCentavos;
    const employerSavingsCentavos = revised.employerSavingsCentavos - original.employerSavingsCentavos;
    const totalCentavos = employeeSavingsCentavos + employerSavingsCentavos;
    return validCentavos(totalCentavos)
      ? { agency: "Pag-IBIG", employeeSavingsCentavos, employerSavingsCentavos, totalCentavos }
      : null;
  }
  return null;
}

/**
 * Generates reproducible M-10 agency-specific read-only review rows.
 * No state, database, export, network, pay run, or agency integration.
 */
export function buildM10ReadOnlyReview(inputs: readonly M10ReviewInput[]): M10ReviewRow[] {
  const keys = inputs.map(input => {
    if (![input.organizationId, input.employeeId, input.adjustmentId].every(validId)) return null;
    if (input.agency !== "SSS" && input.agency !== "Pag-IBIG") return null;
    return [input.organizationId, input.employeeId, input.adjustmentId, input.agency].join(":");
  });
  const keyCounts = new Map<string, number>();
  for (const key of keys) if (key) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);

  return inputs.map((input, index): M10ReviewRow => {
    const evidenceIssues: M10ReviewIssue[] = [];
    if (!input.caseId.trim()) evidenceIssues.push("INVALID_CASE_ID");
    if (![input.organizationId, input.employeeId, input.adjustmentId].every(validId)) {
      evidenceIssues.push("INVALID_IDENTITY");
    }
    if (!validCentavos(input.wageDeltaCentavos)) evidenceIssues.push("INVALID_WAGE_CENTAVOS");
    if (input.sourceRunStatus !== "Released") evidenceIssues.push("SOURCE_NOT_RELEASED");
    if (!validId(input.sourceRunId) || !validId(input.sourceEntryId)) {
      evidenceIssues.push("SOURCE_RUN_OR_ENTRY_MISSING");
    }
    if (input.organizationId !== input.sourceOrganizationId) {
      evidenceIssues.push("SOURCE_TENANT_MISMATCH");
    }
    if (input.employeeId !== input.sourceEntryEmployeeId) {
      evidenceIssues.push("SOURCE_EMPLOYEE_MISMATCH");
    }

    const sourceWorkMonth = singleMonth(input.sourcePeriodStart, input.sourcePeriodEnd);
    const payrollCorrectionMonth = singleMonth(input.correctionPeriodStart, input.correctionPeriodEnd);
    if (!sourceWorkMonth) evidenceIssues.push("SOURCE_MONTH_UNVERIFIED");
    if (!payrollCorrectionMonth) evidenceIssues.push("CORRECTION_MONTH_UNVERIFIED");
    if (input.candidateContributionMonth != null
      && !validMonth(input.candidateContributionMonth)) {
      evidenceIssues.push("INVALID_CANDIDATE_MONTH");
    }
    if (!STATES.includes(input.remittanceState)) evidenceIssues.push("UNKNOWN_REMITTANCE_STATE");
    if (input.remittanceState === "unknown") evidenceIssues.push("UNKNOWN_REMITTANCE_STATE");
    const has = (ref: string | null | undefined) => typeof ref === "string" && ref.trim().length > 0;
    if (input.remittanceState === "submitted_unposted" && !has(input.submissionReference)) {
      evidenceIssues.push("SUBMISSION_REFERENCE_MISSING");
    }
    if (["paid_unposted", "posted", "correction_accepted"].includes(input.remittanceState)
      && !has(input.originalReceiptReference)) {
      evidenceIssues.push("PAYMENT_RECEIPT_MISSING");
    }
    if (input.remittanceState === "correction_accepted" && !has(input.correctionReceiptReference)) {
      evidenceIssues.push("CORRECTION_RECEIPT_MISSING");
    }
    if (input.remittanceState === "rejected" && !has(input.rejectionReference)) {
      evidenceIssues.push("REJECTION_REFERENCE_MISSING");
    }

    const original = input.originalWorksheetShares;
    const revised = input.revisedWorksheetShares;
    let hypotheticalWorksheetDifference: M10WorksheetDifference | null = null;
    if ((original == null) !== (revised == null)) {
      evidenceIssues.push("PARTIAL_WORKSHEET");
    } else if (original != null && revised != null) {
      hypotheticalWorksheetDifference = worksheetDifference(input.agency, original, revised);
      if (hypotheticalWorksheetDifference === null) evidenceIssues.push("INVALID_WORKSHEET_CENTAVOS");
      if (hypotheticalWorksheetDifference !== null
        && input.wageDeltaCentavos === 0
        && hypotheticalWorksheetDifference.totalCentavos !== 0) {
        evidenceIssues.push("ZERO_WAGE_WITH_NONZERO_WORKSHEET");
        hypotheticalWorksheetDifference = null;
      }
    }
    const key = keys[index];
    if (key && (keyCounts.get(key) ?? 0) > 1) evidenceIssues.push("DUPLICATE_CASE");
    // Incomplete provenance cannot justify a what-if delta for any agency.
    if (evidenceIssues.length > 0) hypotheticalWorksheetDifference = null;

    return {
      caseId: input.caseId,
      agency: input.agency,
      organizationId: input.organizationId,
      employeeId: input.employeeId,
      adjustmentId: input.adjustmentId,
      caseKey: key,
      sourceWorkMonth,
      payrollCorrectionMonth,
      candidateContributionMonth: validMonth(input.candidateContributionMonth ?? "")
        ? input.candidateContributionMonth ?? null : null,
      remittanceState: input.remittanceState,
      wageDeltaCentavos: validCentavos(input.wageDeltaCentavos)
        ? input.wageDeltaCentavos : null,
      sourceDiffersFromPayrollMonth: sourceWorkMonth && payrollCorrectionMonth
        ? sourceWorkMonth !== payrollCorrectionMonth : null,
      evidenceIssues,
      evidenceStatus: evidenceIssues.length ? "NEEDS_EVIDENCE" : "POLICY_UNRESOLVED",
      sssPolicyDecision: "NOT_OBTAINED",
      pagIbigPolicyDecision: "NOT_OBTAINED",
      hypotheticalWorksheetDifference,
      approvedAgencyLiabilityCentavos: null,
      canPostAgencyCorrection: false,
      agencyFilingAction: "NOT_AUTHORIZED",
    };
  });
}
