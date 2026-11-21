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
        ? evidence.hasMultipleLegalEmployers
          ? "Multiple legal employers are active. Organization-level identifiers do not establish coverage for each employer. Review each legal employer separately."
          : "Legal-employer configuration is enabled. Organization-level identifiers cannot confirm that the active legal employer has its own registrations. Review its identifiers separately."
        : `${evidence.employerRegistrationFields} of 4 organization-level BIR, SSS, PhilHealth and Pag-IBIG fields have values. This does not verify accuracy.`,
      action: "Open workspace",
      destination: home,
      instruction: evidence.legalEmployerScopeEnabled || evidence.hasMultipleLegalEmployers
        ? "Open Entities in the workspace and review legal-employer registrations."
        : "In Settings, open Organization and verify the employer identifiers.",
      recorded: !evidence.legalEmployerScopeEnabled && !evidence.hasMultipleLegalEmployers && evidence.employerRegistrationFields === 4,
      optional: false,
    },
  ];
  return {
    steps,
    recordedRequired: steps.filter((step) => !step.optional && step.recorded).length,
    requiredTotal: steps.filter((step) => !step.optional).length,
  };
}
