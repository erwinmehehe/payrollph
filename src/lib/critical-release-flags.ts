/**
 * Typed, server-only registry for release-critical boolean feature gates.
 * Exact string "true" is the ONLY enabling value. Missing, wrong-cased,
 * empty and invalid flags are disabled by default.
 *
 * This is a technical configuration inventory, not human launch approval.
 */
export const CRITICAL_RELEASE_FLAGS = {
  multiEntity: {
    env: "MULTI_ENTITY_ENABLED",
    owner: "Security / Payroll Operations",
    risk: "P0 employer payroll, statutory and personnel isolation",
    approval: "DB clone migration, two-tenant/two-entity tests, golden payroll evidence and independent maker-checker UAT",
  },
  multiEntityRegistrations: {
    env: "MULTI_ENTITY_REGISTRATIONS_ENABLED",
    owner: "DBA / Philippine Payroll / Security",
    risk: "P0 legal employer identity, statutory registrations and bank account change governance",
    approval: "Immutable source migration, encrypted proposal reviews, independent maker/checker, tenant/entity HTTP isolation and DBA clone evidence",
  },
  multiEntityTransfers: {
    env: "MULTI_ENTITY_TRANSFERS_ENABLED",
    owner: "Philippine Payroll / Legal / HR",
    risk: "P0 cross-legal-employer liabilities, leave, 13th-month, statutory records and worker continuity",
    approval: "Written employment-continuity policy, employer-specific legal and financial signoff, isolated transaction UAT and independent transfer maker/checker",
  },
  orderedReleaseMigrations: {
    env: "ORDERED_RELEASE_MIGRATIONS_ENABLED", owner: "Database Operations",
    risk: "P0 deployment-only schema changes",
    approval: "DBA baseline adoption, protected release and restore rehearsal",
  },
  employeeImportPreview: {
    env: "EMPLOYEE_IMPORT_PREVIEW_ENABLED", owner: "People Operations",
    risk: "P1 atomic employee CSV intake", approval: "500-row preview and rollback acceptance",
  },
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
  wfmClockWatchPaging: {
    env: "WFM_CLOCK_WATCH_PAGING_ENABLED",
    owner: "Workforce Operations",
    risk: "P1 bounded complete-cohort clock-in watch over 200 assignments",
    approval: "WFM-12 synthetic scale/lease evidence and independent operations sign-off",
  },
  wfmLoyversePos: {
    env: "WFM_LOYVERSE_POS_ENABLED",
    owner: "Workforce Operations",
    risk: "P1 consented POS source access and historical aggregate import",
    approval: "Merchant consent, exact worksite scope and independently reconciled source evidence",
  },
  publicApiV1Extended: {
    env: "PUBLIC_API_V1_EXTENDED_ENABLED",
    owner: "Integrations",
    risk: "P1 scoped employee/org-unit/pay statement API reads and event feed",
    approval: "Tenant-isolation integration tests, API token scope review and privacy acceptance",
  },
  tenantReportBuilder: {
    env: "TENANT_REPORT_BUILDER_ENABLED",
    owner: "People Analytics",
    risk: "P1 payroll-cost CSV exports and workforce reporting permissions",
    approval: "Role-based salary redaction, audit evidence and scoped export sign-off",
  },
  goalsReviewCycle: {
    env: "GOALS_REVIEW_CYCLE_ENABLED",
    owner: "People Operations",
    risk: "P2 optional goals and review cycle landing page",
    approval: "Existing performance authorization and read-only journey acceptance",
  },
  engagementSurvey: {
    env: "ENGAGEMENT_SURVEY_ENABLED",
    owner: "People Operations",
    risk: "P1 anonymous employee feedback and small-cohort inference",
    approval: "Minimum cohort privacy tests, consent and retention review",
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
