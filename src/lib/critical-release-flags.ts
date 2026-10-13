/**
 * Typed, server-only registry for release-critical boolean feature gates.
 * Exact string "true" is the ONLY enabling value. Missing, wrong-cased,
 * empty and invalid flags are disabled by default.
 *
 * This is a technical configuration inventory, not human launch approval.
 */
export const CRITICAL_RELEASE_FLAGS = {
  workPeriodWageScreen: {
    env: "WORK_PERIOD_WAGE_SCREEN_ENABLED",
    owner: "Philippine Payroll",
    risk: "P1 advisory wage-order effective-date warnings",
    approval: "Cutoff boundary behavior and unchanged payroll golden amounts",
  },
  wfmGreedyRoster: {
    env: "WFM_GREEDY_ROSTER_ENABLED",
    owner: "WFM Product / PH People Operations",
    risk: "P1 generated roster suggestions from personnel eligibility and fairness history",
    approval: "Determinism, tenant isolation, rule/leave/skills UAT, and independent workforce review",
  },
  wfmRosterScaleRules: {
    env: "WFM_ROSTER_SCALE_RULES_ENABLED",
    owner: "WFM Operations / Philippine Payroll",
    risk: "P1 large-roster notification completeness and labor-rule schedule publish",
    approval: "Synthetic 1000-assignment pagination, verified roster publish UAT, payroll review and operational sign-off",
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
  publicIntakeProof: {
    env: "PUBLIC_INTAKE_PROOF_ENABLED", owner: "Security",
    risk: "Public enquiry and signup anti-automation", approval: "Proof replay, limits and accessible intake acceptance",
  },
  operationalStatusDetails: {
    env: "OPERATIONAL_STATUS_DETAILS_ENABLED", owner: "Security",
    risk: "Authenticated operational status details", approval: "Endpoint visibility acceptance",
  },
  configurableLeadRetention: {
    env: "CONFIGURABLE_LEAD_RETENTION_ENABLED", owner: "Privacy",
    risk: "Public enquiry retention period", approval: "Approved notice and purge acceptance",
  },
  piiLegacyRead: {
    env: "PII_LEGACY_READ_ENABLED", owner: "Security",
    risk: "Temporary read-only legacy PII key compatibility",
    approval: "Key custody, measured rewrap and retirement acceptance",
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
  orderedReleaseMigrations: {
    env: "ORDERED_RELEASE_MIGRATIONS_ENABLED", owner: "Database Operations",
    risk: "P0 deployment-only schema changes",
    approval: "DBA baseline adoption, protected release and restore rehearsal",
  },
  workforcePunchEvidence: {
    env: "WFM_PUNCH_EVIDENCE_ENABLED",
    owner: "People Operations / Privacy",
    risk: "P1 employee attendance, photographic evidence and offline replay",
    approval: "DPO policy, encryption key, staged review, expiry scheduler and employee pilot sign-off",
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
  apiV1ExtendedReads: {
    env: "API_V1_EXTENDED_READS_ENABLED",
    owner: "Integrations",
    risk: "P1 additional provider inbox and payroll accounting journal exports",
    approval: "Entity-scoped API authorization, accounting reconciliation and privacy acceptance",
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
