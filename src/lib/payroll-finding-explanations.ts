import type { AssuranceFinding } from "./payroll-assurance";
import { automationModelAllowedForOrganization } from "./automation-model-consent";
import { criticalReleaseFlagEnabled } from "./critical-release-flags";

/**
 * Explanation text is an OPTIONAL read-only view of already-computed findings.
 * Do not add calculation, payroll release, employee context or external model
 * calls here. A future model adapter may implement the same signature only
 * after a separate Privacy / Finance review.
 */
export type PayrollFindingExplanationGenerator =
  (findings: readonly AssuranceFinding[]) => string;
export type PayrollExplanationAccess = "disabled" | "consent-required" | "allowed";

export function payrollExplanationAccess(
  organizationId: number,
  env: Readonly<Record<string, string | undefined>> = process.env,
): PayrollExplanationAccess {
  if (!criticalReleaseFlagEnabled("payrollExplanationAi", env)) return "disabled";
  // Reuse the existing DPA/retention/notice/API-key/tenant allowlist gate.
  // An env switch alone never represents a contractual or privacy approval.
  if (!automationModelAllowedForOrganization(organizationId, env)) return "consent-required";
  return "allowed";
}

type ExplanationTemplate = Readonly<{ what: string; why: string; next: string }>;
// Verbatim code keys emitted by phase-1 pre-run and existing assurance sources.
// Templates must make NO additional payroll decisions and carry NO source PII.
export const PAYROLL_FINDING_EXPLANATION_TEMPLATES: Readonly<Record<string, ExplanationTemplate>> =
{
  "PRERUN_INVALID_PERIOD": {
    "what": "Payroll period needs correction.",
    "why": "The recorded cutoff dates are not valid or are out of order.",
    "next": "Correct the cutoff dates before calculation."
  },
  "PRERUN_INVALID_PAY_DATE": {
    "what": "Payment date needs correction.",
    "why": "The recorded pay date is not a valid calendar date.",
    "next": "Correct the pay date before calculation."
  },
  "PRERUN_PAY_DATE_BEFORE_END": {
    "what": "Payment date is before the cutoff ends.",
    "why": "The existing finding says the payment date precedes the payroll period end.",
    "next": "Move the pay date to a valid date that is not earlier than the cutoff end."
  },
  "PRERUN_EMPLOYER_UNRESOLVED": {
    "what": "The legal employer is not resolved.",
    "why": "The source run does not resolve to an active, matching legal employer.",
    "next": "Select and verify the organization-owned legal employer."
  },
  "PRERUN_NONCANONICAL_PERIOD": {
    "what": "The cutoff does not match the employer calendar.",
    "why": "The source employer uses a Philippine semi-monthly calendar.",
    "next": "Review the recorded cutoff against that employer's approved calendar."
  },
  "PRERUN_PERIOD_OVERLAP": {
    "what": "The payroll period overlaps an existing run.",
    "why": "The source readiness check found an overlapping payroll period for this scope.",
    "next": "Review the existing run and resolve the period overlap."
  },
  "PRERUN_NO_EMPLOYEES": {
    "what": "No eligible employees were found in this run's existing scope.",
    "why": "The source pre-run evaluator found no employees in its selected population.",
    "next": "Review the run scope and employee assignments before calculation."
  },
  "PRERUN_STATUTORY_WATCH_INCOMPLETE": {
    "what": "Required statutory rule-watch evidence is incomplete.",
    "why": "A required statutory family lacks exactly one baseline source record.",
    "next": "Restore the required baseline evidence and have it reviewed."
  },
  "PRERUN_STATUTORY_VERIFICATION_UNRECORDED": {
    "what": "Statutory source verification has not been recorded.",
    "why": "The source rule-watch evidence lacks a recorded valid official-source review.",
    "next": "Check the official source and record verified review evidence."
  },
  "PRERUN_STATUTORY_REVIEW_DUE": {
    "what": "A statutory source review is due.",
    "why": "The existing rule-watch finding marks its source review as due.",
    "next": "Complete and document the required source review."
  },
  "PRERUN_STATUTORY_UPDATE_OVERDUE": {
    "what": "A statutory rule update is overdue.",
    "why": "The source rule-watch finding marks an update overdue.",
    "next": "Review and record the applicable source update."
  },
  "PRERUN_STATUTORY_NO_COVERAGE": {
    "what": "Statutory rule-watch coverage is missing.",
    "why": "The existing rule-watch finding reports no coverage for a required source.",
    "next": "Restore and verify the applicable statutory source coverage."
  },
  "PRERUN_LEGAL_ENTITY_UNASSIGNED": {
    "what": "An employee has no legal employer assignment.",
    "why": "The source readiness finding reports missing legal-entity attribution.",
    "next": "Assign and verify the employee's legal employer."
  },
  "PRERUN_PAY_PROFILE_MISSING": {
    "what": "An employee's pay profile is missing.",
    "why": "The existing finding reports no saved pay-basis and rate profile.",
    "next": "Complete and review the source pay profile."
  },
  "PRERUN_ATTENDANCE_STALE": {
    "what": "Attendance is stale or an attendance correction is still pending.",
    "why": "The source records a stale timesheet or an unresolved correction in this cutoff.",
    "next": "Resolve the correction and obtain current attendance approval."
  },
  "PRERUN_ATTENDANCE_UNREVIEWED": {
    "what": "Recorded attendance has not been approved for this period.",
    "why": "Punches exist but there is no valid approved current-period timesheet.",
    "next": "Review and approve the current-period timesheet."
  },
  "PRERUN_ATTENDANCE_MISSING": {
    "what": "Approved attendance is missing for this period.",
    "why": "The source finding reports no punches or approved current-period timesheet.",
    "next": "Record and review the missing period attendance."
  },
  "PRERUN_REST_DAY_REVISION_UNRESOLVED": {
    "what": "A mid-period rest-day change needs review.",
    "why": "The source finding reports a rest-day revision without a subsequent approved timesheet.",
    "next": "Review the revision and approve attendance covering the change."
  },
  "PRERUN_SCHEDULE_REVISION_UNRESOLVED": {
    "what": "A mid-period schedule change needs review.",
    "why": "A shift assignment, pending override or swap remains unresolved in the source finding.",
    "next": "Resolve the schedule change and review the related attendance."
  },
  "NO_PRIOR_PAYROLL": {
    "what": "There is no previous payroll entry to compare.",
    "why": "The assurance record has no earlier payroll entry for this employee.",
    "next": "Review the current entry using its recorded evidence; no prior variance is available."
  },
  "ENGINE_EXCEPTION": {
    "what": "The calculation recorded an exception.",
    "why": "The existing assurance record contains an engine exception or trace warning.",
    "next": "Review the original exception and obtain the existing required sign-off."
  },
  "STATUTORY_RETRO_ATTRIBUTION_UNVERIFIED": {
    "what": "Retroactive statutory attribution remains unverified.",
    "why": "The assurance record has not reconciled the source period for SSS or Pag-IBIG treatment.",
    "next": "Resolve the original period and independently verify the statutory treatment."
  },
  "MANDATORY_DEDUCTIONS_UNCOLLECTED": {
    "what": "Mandatory deductions are uncollected or unverified.",
    "why": "The recorded mandatory deduction evidence shows a shortfall or inconsistent trace.",
    "next": "Correct the source data and recalculate through the existing payroll process."
  },
  "INVALID_PAYROLL_LOAN_SCHEDULE": {
    "what": "A loan deduction schedule is invalid.",
    "why": "The assurance finding reports a source loan-schedule error.",
    "next": "Correct the loan schedule and recalculate before existing approval or release."
  },
  "WFM_PREMIUM_ALLOCATION_UNVERIFIED": {
    "what": "Workforce premium allocation is not verified.",
    "why": "The assurance finding reports ambiguous attendance, break or shift evidence.",
    "next": "Verify the affected attendance and recalculate before checker approval."
  },
  "MISSING_ATTENDANCE": {
    "what": "Attendance requires review.",
    "why": "The calculated entry has positive gross pay with no recorded punches.",
    "next": "Check the recorded attendance and earning source before approval."
  },
  "UNUSUAL_OVERTIME": {
    "what": "Overtime is marked unusually high.",
    "why": "The existing assurance finding identified overtime needing review.",
    "next": "Verify the overtime source and approval."
  },
  "SALARY_CHANGE": {
    "what": "Basic pay changed materially from the prior run.",
    "why": "The assurance comparison identified a material basic-pay change.",
    "next": "Review the approved source for the change."
  },
  "STATUTORY_CHANGE": {
    "what": "Statutory contribution amounts changed materially.",
    "why": "The existing assurance comparison identified a statutory deduction change.",
    "next": "Review the contribution source and comparison."
  },
  "DUPLICATE_EARNING": {
    "what": "A possible duplicate earning was found.",
    "why": "The stored payroll entry includes a repeated positive earning code.",
    "next": "Check whether the earning or allowance was added twice."
  },
  "MISSING_BANK_DETAILS": {
    "what": "Bank payout details are incomplete.",
    "why": "The existing finding reports missing account or bank-code information for positive net pay.",
    "next": "Complete and verify the payout details before release."
  },
  "NEW_EMPLOYEE": {
    "what": "An employee started within this cutoff.",
    "why": "The source employee start date falls inside the payroll period.",
    "next": "Review onboarding and pay proration for the period."
  },
  "SEPARATING_EMPLOYEE": {
    "what": "A separating employee is included.",
    "why": "The source employment status indicates separation, resignation or termination.",
    "next": "Review final-pay treatment and the cutoff."
  },
  "WAGE_FLOOR": {
    "what": "The mapped wage floor needs review.",
    "why": "The assurance finding reports a basic rate below the configured regional wage-floor equivalent.",
    "next": "Review the mapped wage order and employee classification."
  },
  "NONPOSITIVE_NET": {
    "what": "Calculated net pay is not positive.",
    "why": "The existing finding records positive gross compensation with zero or negative net pay.",
    "next": "Resolve the deductions before release."
  },
  "DEDUCTIONS_EXCEED_GROSS": {
    "what": "Deductions exceed gross compensation.",
    "why": "The source assurance finding reports deductions larger than gross pay.",
    "next": "Review and resolve the deduction sources before release."
  },
  "MISSING_STATUTORY": {
    "what": "Statutory line-item treatment needs review.",
    "why": "The stored breakdown is missing statutory line items; that can be valid for a zero or excluded contribution.",
    "next": "Confirm the recorded statutory treatment before approval."
  },
  "HIGH_DEDUCTION_RATIO": {
    "what": "Deductions take a high share of gross pay.",
    "why": "The existing assurance finding identified a high deduction ratio.",
    "next": "Review loans, advances, benefits and tax in the source payroll."
  },
  "MATERIAL_NET_VARIANCE": {
    "what": "Net pay changed materially from the previous payroll.",
    "why": "The assurance comparison identified a material net-pay change.",
    "next": "Review the recorded variance and underlying approved source."
  },
  "MWE_CLASSIFICATION_GOVERNANCE": {
    "what": "Minimum-wage-earner classification evidence is incomplete.",
    "why": "The assurance server reports missing or ambiguous effective-dated classification evidence.",
    "next": "Review the classification history and supporting wage-order evidence."
  },
  "INCOMPLETE_PAYROLL_RUN": {
    "what": "The payroll calculation is incomplete.",
    "why": "The assurance server found missing entries or incomplete processing chunks.",
    "next": "Complete or recalculate the existing run before checker approval."
  }
};

/** Pure deterministic stub: existing AssuranceFinding[] in, explanation text out. */
export const generatePayrollFindingExplanation: PayrollFindingExplanationGenerator = (findings) => {
  if (findings.some(finding => !/^[A-Z][A-Z0-9_]*$/.test(finding.code))) {
    throw new Error("PAYROLL_EXPLANATION_INVALID_SOURCE_CODE");
  }

  // Use ONLY original finding codes and the original blocking boolean. No
  // recalc, computed amounts, guessed quantities, inference or copied PII.
  const codes = [...new Set(findings.map(finding => finding.code))];
  const blockers = [...new Set(findings.filter(finding => finding.blocking === true)
    .map(finding => finding.code))];
  const blocking = new Set(blockers);
  const overview = blockers.length
    ? "What's blocking: " + blockers.join(", ") + " (marked blocking by existing findings)."
    : "What's blocking: No supplied finding is marked blocking. This is not a payroll approval.";

  const paragraphs = codes.map(code => {
    const template = PAYROLL_FINDING_EXPLANATION_TEMPLATES[code];
    const status = blocking.has(code) ? "Existing blocking finding." : "Existing review finding.";
    const what = template?.what ?? "An existing source finding requires review.";
    const why = template?.why ?? "The original finding records a condition not mapped to a template here.";
    const next = template?.next ?? "Review the original finding and follow the existing payroll review process.";
    return "[" + code + "] " + status + " " + what
      + "\nWhy: " + why
      + "\nNext: " + next;
  });

  return overview + "\n\nWhy and what to do next:\n"
    + (paragraphs.length ? paragraphs.join("\n\n")
      : "No pre-run or assurance findings were supplied for this explanation.")
    + "\n\nExplanation only. The original payroll findings and existing approval gates remain authoritative.";
};
