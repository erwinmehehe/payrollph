/**
 * Typed, server-only registry for release-critical boolean feature gates.
 * Exact string "true" is the ONLY enabling value. Missing, wrong-cased,
 * empty and invalid flags are disabled by default.
 *
 * This is a technical configuration inventory, not human launch approval.
 */
export const CRITICAL_RELEASE_FLAGS = {
  centralScheduler: {
    env: "CENTRAL_SCHEDULER_ENABLED",
    owner: "Operations",
    risk: "P0 scheduled payroll and retention jobs",
    approval: "Staging liveness, lease and external monitor evidence",
  },
  payrollWorker: {
    env: "WORKER_ENABLED",
    owner: "Payroll Operations",
    risk: "P0 payroll queue processing",
    approval: "Synthetic worker exercise and governed run approval",
  },
  paymongoDisbursements: {
    env: "PAYMONGO_DISBURSEMENTS_ENABLED",
    owner: "Treasury",
    risk: "P0 actual transfers and payouts",
    approval: "Independent money-movement authority, bank UAT and payout evidence",
  },
  documentUploads: {
    env: "DOCUMENT_UPLOADS_ENABLED",
    owner: "Security",
    risk: "P1 uploaded personal documents",
    approval: "Malware scanner and retention acceptance",
  },
  openAiDrafts: {
    env: "OPENAI_AUTOMATION_DRAFT_ENABLED",
    owner: "Privacy",
    risk: "P1 external personnel data transfer",
    approval: "Per-tenant opt-in, executed DPA and retention verification",
  },
  automationLanguageStudio: {
    env: "AUTOMATION_LANGUAGE_STUDIO_ENABLED",
    owner: "Security",
    risk: "P1 AI-assisted automation suggestions",
    approval: "Synthetic staging isolation and postmerge activation gates",
  },
  firstPayrollInline: {
    env: "FIRST_PAYROLL_INLINE_UI_ENABLED",
    owner: "Product / Payroll",
    risk: "P1 Interactive first-payroll drawers, preview and task handoff",
    approval: "Tenant/role checks, component behavior, flag-off snapshot and mobile Playwright evidence",
  },
  importReview: {
    env: "IMPORT_REVIEW_UI_ENABLED",
    owner: "Product / HCM",
    risk: "P1 Preview/error export for employee import",
    approval: "Tenant/role checks, component behavior, flag-off snapshot and mobile Playwright evidence",
  },
  coreOnlyNav: {
    env: "CORE_ONLY_NAV_UI_ENABLED",
    owner: "Product",
    risk: "P1 Core-only navigation and More modules",
    approval: "Tenant/role checks, component behavior, flag-off snapshot and mobile Playwright evidence",
  },
  faceOfflinePunch: {
    env: "FACE_OFFLINE_PUNCH_UI_ENABLED",
    owner: "Security / Workforce",
    risk: "P1 Consent, camera and unverified offline punch review",
    approval: "Tenant/role checks, component behavior, flag-off snapshot and mobile Playwright evidence",
  },
  rosterPublish: {
    env: "ROSTER_PUBLISH_UI_ENABLED",
    owner: "Workforce Operations",
    risk: "P1 Roster findings and publish confirmation",
    approval: "Tenant/role checks, component behavior, flag-off snapshot and mobile Playwright evidence",
  },
  approvalBuilder: {
    env: "APPROVAL_BUILDER_UI_ENABLED",
    owner: "Security / HCM",
    risk: "P1 Enhanced chain builder and delegation controls",
    approval: "Tenant/role checks, component behavior, flag-off snapshot and mobile Playwright evidence",
  },
  reportBuilder: {
    env: "REPORT_BUILDER_UI_ENABLED",
    owner: "Security / Reports",
    risk: "P1 Saved report field and filter choices",
    approval: "Tenant/role checks, component behavior, flag-off snapshot and mobile Playwright evidence",
  },
  benefitsLoans: {
    env: "BENEFITS_LOANS_UI_ENABLED",
    owner: "Payroll Operations",
    risk: "P1 Benefits enrollment, loan schedules and payslip explanations",
    approval: "Tenant/role checks, component behavior, flag-off snapshot and mobile Playwright evidence",
  },
  recruitmentJourney: {
    env: "RECRUITMENT_JOURNEY_UI_ENABLED",
    owner: "HCM",
    risk: "P1 Pipeline, public careers and hiring handoff",
    approval: "Tenant/role checks, component behavior, flag-off snapshot and mobile Playwright evidence",
  },
  employeeCases: {
    env: "EMPLOYEE_CASES_UI_ENABLED",
    owner: "People / Privacy",
    risk: "P1 Employee requests and HR case inbox",
    approval: "Tenant/role checks, component behavior, flag-off snapshot and mobile Playwright evidence",
  },
  pilotFocusedNavigation: {
    env: "PILOT_FOCUS_NAV_ENABLED",
    owner: "Product",
    risk: "P2 employer pilot navigation",
    approval: "Named pilot employer opt-in and witnessed UX acceptance",
  },
} as const;

export type CriticalReleaseFlag = keyof typeof CRITICAL_RELEASE_FLAGS;
export function criticalReleaseFlagEnabled(
  flag: CriticalReleaseFlag,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  // A runtime caller cannot silently enable a typo even when the parameter
  // is bypassed through untyped JS.
  if (!Object.hasOwn(CRITICAL_RELEASE_FLAGS, flag)) {
    throw new Error("Unknown release-critical feature flag.");
  }
  return env[CRITICAL_RELEASE_FLAGS[flag].env] === "true";
}

export function criticalReleaseFlagInventory() {
  return Object.entries(CRITICAL_RELEASE_FLAGS).map(([key, entry]) => ({
    key, ...entry, defaultEnabled: false,
  }));
}
