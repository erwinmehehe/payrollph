/**
 * HCM hire-to-payroll INPUT EVIDENCE, not payroll clearance.
 * Every section is a presence/snapshot check against existing source records.
 * No result grants pay approval, money movement or statutory verification.
 */
export type HirePayrollEvidenceState =
  | "recorded" | "needs_review" | "not_recorded" | "partial" | "not_assessed";

export type HirePayrollEvidence = {
  key: "employment" | "onboarding" | "pay_profile" | "government_ids" |
    "payout" | "rest_day" | "attendance" | "payroll_approval";
  label: string;
  state: HirePayrollEvidenceState;
  source: string;
  detail: string;
};

export type HirePayrollInputReview = {
  organizationId: number;
  employeeId: number;
  observedAt: string;
  sections: HirePayrollEvidence[];
  onboardingPreviewHasMore: boolean;
  payrollAuthorized: false;
  incompleteEvidence: true;
};

export function hirePayrollReviewEnabledForEmployer(
  organizationId: number,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) return false;
  if (env.HCM_HIRE_PAYROLL_REVIEW_ENABLED !== "true" ||
      env.NEXT_PUBLIC_HCM_HIRE_PAYROLL_REVIEW_ENABLED !== "true") return false;
  return (env.HCM_HIRE_PAYROLL_REVIEW_ORG_IDS ?? "").split(",")
    .map((item) => item.trim())
    .some((item) => /^[1-9]\d*$/.test(item) &&
      Number.isSafeInteger(Number(item)) && Number(item) === organizationId);
}

/**
 * Caller provides only employer-filtered booleans, never raw worker identity,
 * compensation, financial account values, or statutory identifiers.
 */
export function buildHirePayrollInputReview(input: {
  organizationId: number;
  employeeId: number;
  observedAt: string;
  employee: {
    active: boolean;
    statutoryIdsRecorded: boolean;
    payoutDetailsRecorded: boolean;
    restDayRecorded: boolean;
  };
  payProfile: {
    basisRecognized: boolean;
    ratePositive: boolean;
    standardDaysPositive: boolean;
    standardHoursPositive: boolean;
  } | null;
  recordedOnboardingTasks: readonly { done: boolean }[];
  onboardingPreviewHasMore: boolean;
}): HirePayrollInputReview {
  if (!Number.isSafeInteger(input.organizationId) || input.organizationId <= 0 ||
      !Number.isSafeInteger(input.employeeId) || input.employeeId <= 0) {
    throw new Error("A real selected employer and worker are required.");
  }
  const onboarding = input.recordedOnboardingTasks;
  const unfinished = onboarding.filter((task) => !task.done).length;
  const onboardingState: HirePayrollEvidenceState = input.onboardingPreviewHasMore
    ? "partial"
    : onboarding.length === 0
      ? "not_recorded"
      : unfinished > 0 ? "needs_review" : "recorded";
  const payProfilePresent = Boolean(input.payProfile &&
    input.payProfile.basisRecognized && input.payProfile.ratePositive &&
    input.payProfile.standardDaysPositive && input.payProfile.standardHoursPositive);

  return {
    organizationId: input.organizationId,
    employeeId: input.employeeId,
    observedAt: input.observedAt,
    onboardingPreviewHasMore: input.onboardingPreviewHasMore,
    payrollAuthorized: false,
    incompleteEvidence: true,
    sections: [
      {
        key: "employment", label: "Current employment record", source: "employees",
        state: input.employee.active ? "recorded" : "needs_review",
        detail: input.employee.active
          ? "Current worker status is Active. Hire approval history is not certified here."
          : "Current worker status is not Active. Review the authoritative employment workflow.",
      },
      {
        key: "onboarding", label: "Onboarding checklist", source: "provisioning_tasks",
        state: onboardingState,
        detail: input.onboardingPreviewHasMore
          ? "The onboarding task preview is capped; outstanding tasks may be omitted."
          : onboarding.length === 0
            ? "No onboarding tasks were recorded for this worker; completion is unknown."
            : unfinished > 0
              ? "Recorded onboarding tasks remain open in their owning workflow."
              : "All recorded tasks are marked complete; this does not independently verify them.",
      },
      {
        key: "pay_profile", label: "Payroll basis and standard hours", source: "employee_pay_profiles",
        state: payProfilePresent ? "recorded" : "needs_review",
        detail: payProfilePresent
          ? "Recognized pay basis and positive rate, work-day and hour fields are recorded; approval is not verified."
          : "An explicit pay profile is missing or its required fields need review.",
      },
      {
        key: "government_ids", label: "Statutory identifiers", source: "employees",
        state: input.employee.statutoryIdsRecorded ? "recorded" : "needs_review",
        detail: input.employee.statutoryIdsRecorded
          ? "TIN, BIR branch code, SSS, PhilHealth and Pag-IBIG fields have entries; validity is not checked."
          : "One or more statutory identifier fields have no recorded value.",
      },
      {
        key: "payout", label: "Payout instructions", source: "employees",
        state: input.employee.payoutDetailsRecorded ? "recorded" : "needs_review",
        detail: input.employee.payoutDetailsRecorded
          ? "An account field and payout code are recorded; bank ownership and settlement are not checked."
          : "An account field or payout code is missing from the employee source.",
      },
      {
        key: "rest_day", label: "Default rest-day baseline", source: "employees",
        state: input.employee.restDayRecorded ? "recorded" : "needs_review",
        detail: input.employee.restDayRecorded
          ? "A default rest-day field is recorded; effective schedules and exceptions still require review."
          : "No default rest-day field is recorded; check the effective-dated WFM schedule.",
      },
      {
        key: "attendance", label: "Payroll-period attendance and leave", source: "WFM source review",
        state: "not_assessed",
        detail: "Not assessed. Review exact-period attendance, approved timesheets, schedules and leave separately.",
      },
      {
        key: "payroll_approval", label: "Payroll approval, filing and payout", source: "governed payroll",
        state: "not_assessed",
        detail: "Not assessed. Independent payroll checks, release, bank UAT and government filing stay separate.",
      },
    ],
  };
}
