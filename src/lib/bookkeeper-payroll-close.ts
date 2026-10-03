export type PayrollCloseEvidence = {
  agency: string;
  form: string;
  status: string;
  proven: boolean;
  reference?: string | null;
};

export type PayrollCloseLiabilities = {
  sss: number;
  philHealth: number;
  pagIbig: number;
  birWithholding: number;
  governmentLoans: number;
  totalStatutoryLiabilities: number;
  netPayroll: number;
  employerStatutoryExpense: number;
};

export function buildBookkeeperPayrollClose(input: {
  runStatus: string;
  payoutCompleted: boolean;
  journalExported: boolean;
  liabilities: PayrollCloseLiabilities | null;
  filingEvidence: PayrollCloseEvidence[];
  closedAt?: string | null;
}) {
  const released = input.runStatus === "Released";
  const liabilitiesReady = Boolean(
    input.liabilities
    && [
      input.liabilities.sss,
      input.liabilities.philHealth,
      input.liabilities.pagIbig,
      input.liabilities.birWithholding,
      input.liabilities.totalStatutoryLiabilities,
    ].every((value) => Number.isFinite(value) && value >= 0),
  );
  const filingEvidenceProven = input.filingEvidence.filter((item) => item.proven);
  const filingEvidenceGaps = input.filingEvidence.filter((item) => !item.proven);
  const closed = Boolean(input.closedAt);
  const hardBlockers = [
    !released ? "Payroll must be released before bookkeeping close." : null,
    released && !input.payoutCompleted ? "Payroll payout must be confirmed or provider-settled before close." : null,
    released && !input.journalExported ? "Export the final accounting journal before close." : null,
    released && !liabilitiesReady ? "Statutory liability totals could not be prepared from the payroll journal." : null,
  ].filter((item): item is string => Boolean(item));

  return {
    released,
    payoutCompleted: input.payoutCompleted,
    journalExported: input.journalExported,
    liabilitiesReady,
    filingEvidenceProven,
    filingEvidenceGaps,
    filingEvidenceComplete: filingEvidenceGaps.length === 0 && input.filingEvidence.length > 0,
    requiresFilingEvidenceAcknowledgement: filingEvidenceGaps.length > 0,
    closed,
    closedAt: input.closedAt ?? null,
    hardBlockers,
    canClose: !closed && hardBlockers.length === 0,
  };
}
