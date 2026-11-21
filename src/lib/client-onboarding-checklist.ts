/**
 * Read-only company setup guide. Field presence is not independent verification
 * and must never be treated as payroll, security, bank or statutory approval.
 */
export type ClientOnboardingEvidence = {
  organizationName: string;
  legalName: string;
  employeeRecords: number;
  activeTeamMembers: number;
  employerRegistrationFields: number;
  hasMultipleLegalEmployers: boolean;
  legalEmployerScopeEnabled?: boolean;
  legalEmployerCount?: number;
  legalEmployerRegistrationsComplete?: number;
};

export type ClientOnboardingStep = {
  id: "profile" | "employees" | "team" | "registrations";
  title: string;
  detail: string;
  action: string;
  destination: string;
  instruction: string;
  recorded: boolean;
  optional: boolean;
};

export function buildClientOnboardingChecklist(
  organizationId: number,
  evidence: ClientOnboardingEvidence,
): { steps: ClientOnboardingStep[]; recordedRequired: number; requiredTotal: number } {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    throw new Error("A valid selected employer is required.");
  }
  const home = `/app?organizationId=${organizationId}`;
  // Organization-level IDs are not proof for a separately registered legal
  // employer. In multi-entity mode, count ONLY the active employers whose own
  // four identifiers are recorded; never claim verification of the values.
  const legalEmployerCount = evidence.legalEmployerCount ?? 0;
  const legalEmployerComplete = evidence.legalEmployerRegistrationsComplete ?? 0;
  const registrationRecorded = evidence.legalEmployerScopeEnabled
    ? Number.isSafeInteger(legalEmployerCount) && legalEmployerCount > 0 &&
      Number.isSafeInteger(legalEmployerComplete) &&
      legalEmployerComplete === legalEmployerCount
    : !evidence.hasMultipleLegalEmployers && evidence.employerRegistrationFields === 4;
  const steps: ClientOnboardingStep[] = [
    {
      id: "profile",
      title: "Review company details",
      detail: "Workspace and legal business names must be present. Saved fields still need a human review.",
      action: "Open workspace",
      destination: home,
      instruction: "In Settings, open Organization.",
      recorded: Boolean(evidence.organizationName.trim() && evidence.legalName.trim()),
      optional: false,
    },
    {
      id: "employees",
      title: "Add or import your people",
      detail: `${evidence.employeeRecords} employee record${evidence.employeeRecords === 1 ? "" : "s"} currently stored. Imported records are not automatically payroll-ready.`,
      action: "Open People",
      destination: home + "&workspacePage=People",
      instruction: "In People, add an employee or import a roster.",
      recorded: evidence.employeeRecords > 0,
      optional: false,
    },
    {
      id: "team",
      title: "Invite your HR or finance team",
      detail: `${evidence.activeTeamMembers} active non-employee workspace member${evidence.activeTeamMembers === 1 ? "" : "s"} recorded. Separate roles are recommended for approvals.`,
      action: "Open workspace",
      destination: home,
      instruction: "In Settings, open Team.",
      recorded: evidence.activeTeamMembers > 1,
      optional: true,
    },
    {
      id: "registrations",
      title: "Review employer registrations",
      detail: evidence.legalEmployerScopeEnabled
        ? `${legalEmployerComplete} of ${legalEmployerCount} active legal employer${legalEmployerCount === 1 ? "" : "s"} have all four BIR, SSS, PhilHealth and Pag-IBIG identifiers recorded. Values still need independent review.`
        : `${evidence.employerRegistrationFields} of 4 organization-level BIR, SSS, PhilHealth and Pag-IBIG fields have values. This does not verify accuracy.`,
      action: "Open workspace",
      destination: home,
      instruction: evidence.legalEmployerScopeEnabled || evidence.hasMultipleLegalEmployers
        ? "Open Entities in the workspace and review legal-employer registrations."
        : "In Settings, open Organization and verify the employer identifiers.",
      recorded: registrationRecorded,
      optional: false,
    },
  ];
  return {
    steps,
    recordedRequired: steps.filter((step) => !step.optional && step.recorded).length,
    requiredTotal: steps.filter((step) => !step.optional).length,
  };
}
