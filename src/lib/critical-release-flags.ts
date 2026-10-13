/**
 * Typed, server-only registry for release-critical boolean feature gates.
 * Exact string "true" is the ONLY enabling value. Missing, wrong-cased,
 * empty and invalid flags are disabled by default.
 *
 * This is a technical configuration inventory, not human launch approval.
 */
export const CRITICAL_RELEASE_FLAGS = {
  payrollWorkerHeartbeatRequired: {
    env: "PAYROLL_WORKER_HEARTBEAT_REQUIRED",
    owner: "Payroll / Operations",
    risk: "Scheduler refuses work without a fresh dedicated-worker heartbeat",
    approval: "Synthetic liveness and independently approved worker hosting; no payout authority",
  },
  bir1604cReviewedCandidate: {
    env: "BIR_1604C_DAT_CANDIDATE_ENABLED",
    owner: "Philippine Payroll / Tax",
    risk: "Reviewed draft annual employer DAT and private validation evidence",
    approval: "Exact-source, role/MFA, maker-checker and official-module acceptance; no filing authority",
  },
  independentSourceReview: {
    env: "INDEPENDENT_SOURCE_REVIEW_REQUIRED",
    owner: "Repository Maintainer",
    risk: "Optional independent source-review CI policy; no payroll release authority",
    approval: "Owner policy selection; exact-head checks remain required",
  },
  exactPayrollLoanSettlement: {
    env: "EXACT_PAYROLL_LOAN_SETTLEMENT_ENABLED",
    owner: "Payroll / Finance",
    risk: "P0 release-time employee loan ledger posting",
    approval: "Exact centavo, transaction rollback and payroll golden acceptance",
  },
  loanSchedulePreview: {
    env: "LOAN_SCHEDULE_PREVIEW_ENABLED",
    owner: "Philippine Payroll / HR Operations",
    risk: "P1 read-only employee/company and agency loan schedule previews",
    approval: "Centavo schedule/golden tests, lawful deduction policy and independent finance review",
  },
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
  xenditPayrollPayouts: {
    env: "XENDIT_PAYOUTS_ENABLED",
    owner: "Treasury",
    risk: "P0 external Xendit salary money movement",
    approval: "Independent provider/treasury acceptance and exact employer/legal-entity authorization",
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
  firstPayrollInline: {
    env: "FIRST_PAYROLL_INLINE_ENABLED",
    owner: "Payroll Operations",
    risk: "P0 inline onboarding uses canonical 0117 first-payroll tenant progress schema",
    approval: "Reviewed 0117 receipt, zero-write preview and independent two-role mobile acceptance",
  },
  coreModuleNavigation: {
    env: "CORE_MODULE_NAVIGATION_ENABLED", owner: "Product",
    risk: "P2 tenant module disclosure", approval: "New and existing tenant navigation snapshots",
  },
  approvalChainEscalations: {
    env: "APPROVAL_CHAIN_ESCALATIONS_ENABLED",
    owner: "People Governance",
    risk: "P1 overdue approval escalation and stricter payroll maker-checker identity gate",
    approval: "Delegation expiry, distinct-human and scheduler idempotency UAT",
  },
  employeeDocumentVault: {
    env: "EMPLOYEE_DOCUMENT_VAULT_ENABLED",
    owner: "Security and Privacy",
    risk: "P1 private employee documents in signed object storage",
    approval: "Object storage, migration reconciliation, malware scanning and view auditing accepted",
  },
  employeeHrCases: {
    env: "EMPLOYEE_HR_CASES_ENABLED",
    owner: "People Operations",
    risk: "P1 confidential employee HR requests and COE approvals",
    approval: "Scoped HR and ESS acceptance, SLA operations and independently signed COE review",
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
