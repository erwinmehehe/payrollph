export type ComplianceEvidenceDomain = {
  key: "rules" | "payroll" | "filing" | "remittance" | "bank";
  label: string;
  points: number;
  maxPoints: 20;
  status: "proven" | "partial" | "missing" | "blocked";
  detail: string;
};

export type ComplianceEvidenceScoreInput = {
  activeApprovedRules: number;
  latestPayrollBlockingFindings: number | null;
  acceptedFilingForms: number;
  requiredFilingForms: number;
  dueRemittanceObligations: number;
  confirmedDueRemittances: number;
  overdueRemittances: number;
  acceptedBankValidations: number;
};

function boundedPoints(value: number) {
  return Math.max(0, Math.min(20, Math.round(value)));
}

/**
 * This is an evidence-readiness score, not a legal-compliance certification.
 * Each domain is capped at 20 points and the API always returns the underlying
 * facts so the UI cannot hide what is still unproven.
 */
export function calculateComplianceEvidenceScore(
  input: ComplianceEvidenceScoreInput,
): { score: number; domains: ComplianceEvidenceDomain[] } {
  const rulePoints = input.activeApprovedRules > 0 ? 20 : 0;

  const payrollPoints =
    input.latestPayrollBlockingFindings == null
      ? 0
      : input.latestPayrollBlockingFindings === 0
        ? 20
        : input.latestPayrollBlockingFindings <= 2
          ? 10
          : 0;

  const filingPoints =
    input.requiredFilingForms > 0
      ? boundedPoints((input.acceptedFilingForms / input.requiredFilingForms) * 20)
      : 0;

  const remittancePoints =
    input.dueRemittanceObligations > 0
      ? boundedPoints((input.confirmedDueRemittances / input.dueRemittanceObligations) * 20)
      : 0;

  const bankPoints = input.acceptedBankValidations > 0 ? 20 : 0;

  const domains: ComplianceEvidenceDomain[] = [
    {
      key: "rules",
      label: "Rule governance",
      points: rulePoints,
      maxPoints: 20,
      status: rulePoints === 20 ? "proven" : "missing",
      detail: input.activeApprovedRules > 0
        ? `${input.activeApprovedRules} approved rule version(s) are effective today.`
        : "No approved effective compliance-rule record is available for today.",
    },
    {
      key: "payroll",
      label: "Payroll assurance",
      points: payrollPoints,
      maxPoints: 20,
      status:
        input.latestPayrollBlockingFindings == null
          ? "missing"
          : input.latestPayrollBlockingFindings === 0
            ? "proven"
            : "blocked",
      detail:
        input.latestPayrollBlockingFindings == null
          ? "No calculated payroll run is available for assurance evidence."
          : input.latestPayrollBlockingFindings === 0
            ? "The latest calculated payroll has no release-blocking assurance finding."
            : `${input.latestPayrollBlockingFindings} release-blocking assurance finding(s) remain on the latest calculated payroll.`,
    },
    {
      key: "filing",
      label: "Government filing evidence",
      points: filingPoints,
      maxPoints: 20,
      status:
        input.acceptedFilingForms >= input.requiredFilingForms && input.requiredFilingForms > 0
          ? "proven"
          : input.acceptedFilingForms > 0
            ? "partial"
            : "missing",
      detail: `${input.acceptedFilingForms}/${input.requiredFilingForms} tracked filing format(s) have accepted current-version evidence.`,
    },
    {
      key: "remittance",
      label: "Contribution remittance",
      points: remittancePoints,
      maxPoints: 20,
      status:
        input.overdueRemittances > 0
          ? "blocked"
          : input.dueRemittanceObligations > 0
            ? input.confirmedDueRemittances === input.dueRemittanceObligations
              ? "proven"
              : "partial"
            : "missing",
      detail:
        input.dueRemittanceObligations === 0
          ? "No due statutory remittance obligation has evidence yet."
          : `${input.confirmedDueRemittances}/${input.dueRemittanceObligations} due obligation(s) are confirmed; ${input.overdueRemittances} overdue.`,
    },
    {
      key: "bank",
      label: "Bank payout UAT",
      points: bankPoints,
      maxPoints: 20,
      status: bankPoints === 20 ? "proven" : "missing",
      detail:
        input.acceptedBankValidations > 0
          ? `${input.acceptedBankValidations} bank-file validation(s) have portal acceptance evidence.`
          : "No accepted bank-portal UAT evidence is recorded.",
    },
  ];

  return {
    score: domains.reduce((sum, domain) => sum + domain.points, 0),
    domains,
  };
}
