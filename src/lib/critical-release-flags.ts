/**
 * Typed, server-only registry for release-critical boolean feature gates.
 * Exact string "true" is the ONLY enabling value. Missing, wrong-cased,
 * empty and invalid flags are disabled by default.
 *
 * This is a technical configuration inventory, not human launch approval.
 */
export const CRITICAL_RELEASE_FLAGS = {
  firstPayrollConnected: {
    env: "FIRST_PAYROLL_CONNECTED_ENABLED",
    owner: "Payroll / Onboarding",
    risk: "Recognize invitation-created pilot workspaces and resume authorized saved payroll runs",
    approval: "Executed invited-pilot expiry and tenant/run navigation tests, flag-off parity, desktop/390px connected payroll evidence; no payment activation",
  },
  requestSchemaReadonly: {
    env: "REQUEST_SCHEMA_READONLY_ENABLED",
    owner: "Database Operations / Release",
    risk: "Replace request-time compatibility DDL/backfills with catalog-only checks",
    approval: "Flag-off mode parity, executed PG16/18 migration-to-preflight and guard-drift tests, approved schema and restricted-role cutover; no automatic production activation",
  },
  auditRoleIsolationProof: {
    env: "AUDIT_ROLE_ISOLATION_PROOF_ENABLED",
    owner: "Security / Database Operations",
    risk: "Stricter metadata-only audit privilege and forward-trigger readiness proof",
    approval: "Executed restricted-login PG16/18 tamper tests, unchanged flag-off query, genuine role mapping and approved forward repair; no automatic production activation",
  },
  everydayHrHire: {
    env: "EVERYDAY_HR_HIRE_ENABLED",
    owner: "HR Operations / Product",
    risk: "Everyday HR direct-hire shortcut and Philippine civil-date form defaults",
    approval: "Executed flag-off render parity, authorized hire/onboarding persistence, tenant isolation and desktop/390px browser evidence; no production activation",
  },
  exactThirteenthCentavos: {
    env: "EXACT_THIRTEENTH_CENTAVOS_ENABLED",
    owner: "Philippine Payroll / Finance",
    risk: "Half-cent 13th-month entitlement rounding across compliance, final pay and year end",
    approval: "Executed tie/boundary tests, flag-off parity, stale-approval rejection and golden reconciliation; no settled-record rewrite",
  },
  finalPaySignedReview: {
    env: "FINAL_PAY_SIGNED_REVIEW_ENABLED",
    owner: "Philippine Payroll / Finance",
    risk: "Read-only signed final-pay reconciliation display and CSV; never a negative payout instruction",
    approval: "Frozen-record centavos, deficit/unknown states, role and desktop/390 acceptance; existing release holds retained",
  },
  yearEndPriorEvidence: {
    env: "YEAR_END_PRIOR_EVIDENCE_ENABLED",
    owner: "Philippine Payroll / Tax",
    risk: "Reviewed prior-employer and PERA evidence changes year-end collection/refund",
    approval: "Dedicated encryption key, reviewed schema, maker/checker, tenant and exact-source acceptance; no production activation or filing authority",
  },
  applicantPrivacy: {
    env: "APPLICANT_PRIVACY_CONTROLS_ENABLED",
    owner: "HR Operations / Data Protection Officer",
    risk: "P1 applicant consent evidence, subject-rights exports and rejected-candidate deletion",
    approval: "DPO notice/legal basis, migration, private resume deletion and two-tenant retention acceptance",
  },
  compactMobileHeader: {
    env: "COMPACT_MOBILE_HEADER_ENABLED",
    owner: "Product / Accessibility",
    risk: "Small-screen organization switcher and account control layout",
    approval: "Desktop/375/390px authenticated browser and default-off rendering parity",
  },
  payrollWorkerHeartbeatRequired: {
    env: "PAYROLL_WORKER_HEARTBEAT_REQUIRED",
    owner: "Payroll / Operations",
    risk: "Scheduler refuses work without a fresh dedicated-worker heartbeat",
    approval: "Synthetic liveness and independently approved worker hosting; no payout authority",
  },
  bir2316WithholdingEvidence: {
    env: "BIR_2316_WITHHOLDING_EVIDENCE_ENABLED",
    owner: "Philippine Payroll / Finance",
    risk: "Read-only released-ledger 2316 withholding and final-pay shortfall attribution",
    approval: "Tenant/employer scope, immutable source, signed refund/collection, two-flag-off and synthetic PostgreSQL/browser evidence; no bank or filing authority",
  },
  bir2316Certificate: {
    env: "BIR_2316_CERTIFICATE_DRAFT_ENABLED",
    owner: "Philippine Payroll / Tax",
    risk: "Sensitive unsigned 2316 PDF previews and historical-employer identity",
    approval: "Exact-centavo complete mapping, historical tenant isolation, PDF field/layout and role/MFA acceptance; no signatures or filing authority",
  },
  bir2316Reconciliation: {
    env: "BIR_2316_RECONCILIATION_ENABLED",
    owner: "Philippine Payroll / Tax",
    risk: "Read-only 2316 numbered-item reconciliation and unverified settlement warnings",
    approval: "Centavo mapping tests, prior-employer and final-pay review, desktop/390px and unchanged flag-off output; no certificate issuance",
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
  wfmEmployeeAvailability: {
    env: "WFM_EMPLOYEE_AVAILABILITY_ENABLED",
    owner: "WFM Operations / HR Privacy",
    risk: "P1 employee-entered weekly availability and shift preferences; protected personnel scheduling evidence",
    approval: "Two-employer ESS/manager authorization, availability source-schema verification, mobile browser and real shift-coverage pilot acceptance; no payroll authority",
  },
  wfmEmployeeAvailabilityUi: {
    env: "NEXT_PUBLIC_WFM_EMPLOYEE_AVAILABILITY_ENABLED",
    owner: "WFM Operations / HR Privacy",
    risk: "P1 browser visibility of employee availability; UI flag is not server authorization",
    approval: "Both UI and server flags default OFF until source-schema, tenant isolation, employee/manager mobile browser and WFM pilot acceptance",
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
  benefitsLoans: {
    env: "BENEFITS_LOANS_UI_ENABLED",
    owner: "Payroll Operations",
    risk: "P1 Benefits enrollment, loan schedules and payslip explanations",
    approval: "Tenant/role checks, component behavior, flag-off snapshot and mobile Playwright evidence",
  },
  reportBuilder: {
    env: "REPORT_BUILDER_UI_ENABLED",
    owner: "Security / Reports",
    risk: "P1 Saved report field and filter choices",
    approval: "Tenant/role checks, component behavior, flag-off snapshot and mobile Playwright evidence",
  },
  faceOfflinePunch: {
    env: "FACE_OFFLINE_PUNCH_UI_ENABLED",
    owner: "Security / Workforce",
    risk: "P1 Consent, camera and unverified offline punch review",
    approval: "Tenant/role checks, component behavior, flag-off snapshot and mobile Playwright evidence",
  },
  recruitmentJourney: {
    env: "RECRUITMENT_JOURNEY_UI_ENABLED",
    owner: "HCM",
    risk: "P1 Pipeline, public careers and hiring handoff",
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
  payrollExplanationAi: {
    env: "PAYROLL_EXPLANATION_AI_ENABLED",
    owner: "Privacy",
    risk: "P1 optional plain-language payroll finding explanations; deterministic local templates only until separately reviewed model integration",
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
  overpaymentPreview: {
    env: "HCM_OVERPAYMENT_PREVIEW_ENABLED",
    owner: "Payroll / HR Operations",
    risk: "P1 read-only released-payroll discrepancy preview with sensitive wage evidence",
    approval: "Role/MFA gates, default-off API/UI parity, synthetic tenant-isolation acceptance; no payroll deduction authority",
  },
  overpaymentInvestigation: {
    env: "PAYROLL_OVERPAYMENT_REVIEW_ENABLED",
    owner: "Payroll / Independent Checker",
    risk: "P1 historical wage-discrepancy investigation requiring sensitive source evidence",
    approval: "Independent finance review, tenant isolation, data minimization and default-off regression; no money-moving permission",
  },
  hcmSalaryCorrectionCases: {
    env: "HCM_SALARY_CORRECTION_CASES_ENABLED",
    owner: "Philippine Payroll / HR Operations",
    risk: "P1 backdated salary correction cases linking Released runs to reviewed underpayment requests; no money computed or moved",
    approval: "Migration 0135 applied via reviewed workflow, PostgreSQL and two-employer HTTP tests, PH payroll/tax review of back-pay treatment and a no-money pilot",
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
  spendPayroll: {
    env: "SPEND_PAYROLL_REIMBURSEMENTS_ENABLED",
    owner: "Payroll and Finance",
    risk: "P0 taxable reimbursements, receipt evidence, duplicate payouts",
    approval: "Isolated employer payroll comparison and independent expense-review acceptance",
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
  sanitizedErrorTelemetry: {
    env: "SAFE_OTEL_ERRORS_ENABLED", owner: "Security / Operations",
    risk: "Optional remote sanitized error events", approval: "Collector/DPO review and synthetic error payload acceptance",
  },
  offboardingClearance: {
    env: "OFFBOARDING_CLEARANCE_ENABLED",
    owner: "People Operations and Payroll",
    risk: "P0 documented clearance waivers, final-pay authority and worker access revocation",
    approval: "Three-actor final-pay pilot, tenant isolation, waiver evidence and revoked-session rollback UAT",
  },
  payrollEmployerSetupNavigation: {
    env: "PAYROLL_EMPLOYER_SETUP_NAVIGATION_ENABLED",
    owner: "Payroll / Onboarding",
    risk: "Employer setup navigation and verified selector error recovery; no automatic provisioning",
    approval: "Executed empty/error/retry, restricted-role and flag-off browser parity at desktop/390px; existing payroll guards preserved",
  },
  approvedExitPayroll: {
    env: "APPROVED_EXIT_PAYROLL_ENABLED",
    owner: "Payroll / Finance",
    risk: "P0 approved exit cutoff proration and final-pay wage overlap",
    approval: "Executed separation-to-payroll-to-final-pay tests, post-exit rate exclusion and exact flag-off parity; no production activation",
  },
  ownerPracticePayroll: {
    env: "OWNER_PRACTICE_PAYROLL_ENABLED",
    owner: "Payroll / Onboarding",
    risk: "Owner-only fictional calculation and sample payslip UI; no payroll writes or payment authority",
    approval: "Executed canonical fixture, owner/tenant gates, default-off parity and desktop/390px browser tests; production activation separate",
  },
  payrollPreRunReadiness: {
    env: "PAYROLL_PRE_RUN_READINESS_ENABLED",
    owner: "Payroll / Statutory Controls",
    risk: "Pre-calculation source gate can block all payroll while statutory verification or required inputs are incomplete",
    approval: "Flag-off calculation parity, flag-on create/process denial before writes, tenant isolation and official-source review before activation",
  },
  payrollDraftPayoutDeferral: {
    env: "PAYROLL_DRAFT_PAYOUT_DEFERRAL_ENABLED",
    owner: "Payroll / Onboarding",
    risk: "Draft calculation before payout setup; missing destinations must remain assurance/review/release blockers",
    approval: "Executed flag-off parity, authorized draft calculation, foreign-employer denial and missing-destination release-block tests; production activation separate",
  },
  hostedDemoNavigation: {
    env: "HOSTED_DEMO_NAVIGATION_ENABLED",
    owner: "Product / Onboarding",
    risk: "Public demo entrypoint redirects to the isolated fictional workspace",
    approval: "Verified hosted role permissions and desktop/390px navigation; default-off parity",
  },
  localLoginAudit: {
    env: "LOCAL_LOGIN_AUDIT_ENABLED",
    owner: "Security / Authentication",
    risk: "Successful password login audit writes and failure containment before cookie delivery",
    approval: "Executed default-off no-write parity, own-employer audit isolation and restricted-role restart smoke; production activation separate",
  },
  governmentLoanRemittanceUi: {
    env: "NEXT_PUBLIC_GOVERNMENT_LOAN_REMITTANCE_UI_ENABLED",
    owner: "Security / Payroll Compliance / Product",
    risk: "Opt-in verified government-loan read, retry and mutation receipt UI; backend employer authorization remains unconditional",
    approval: "Executed flag-off legacy parity, scoped read/receipt tests and desktop/390px UI acceptance; production activation separate",
  },
  doleAttributionStateUi: {
    env: "NEXT_PUBLIC_DOLE_ATTRIBUTION_STATE_UI_ENABLED",
    owner: "Security / Philippine Payroll Compliance / Product",
    risk: "Opt-in verified DOLE report reads, fresh mutation confirmation and source-attribution UI; multi-entity GET/POST/CSV and builder deny regardless of this flag",
    approval: "Exact flag-off visual parity, multi-entity 503 and untouched victim data, real desktop/390px component browser, independent statutory/payroll acceptance",
  },
  complianceReadStateUi: {
    env: "NEXT_PUBLIC_COMPLIANCE_READ_STATE_UI_ENABLED",
    owner: "Security / Philippine Payroll Compliance / Product",
    risk: "Opt-in explanatory UI for fail-closed statutory calendar and payment-proof unavailable states; authorization and source validation remain unconditional",
    approval: "Default-off parity on desktop and 390px, fail-closed wrong-employer/partial reads, source-pinned PG16 test, independent security and payroll acceptance",
  },
  exactPayrollApprovalLinks: {
    env: "EXACT_PAYROLL_APPROVAL_LINKS_ENABLED",
    owner: "Payroll / Security",
    risk: "Bind recalculation and input-change approval invalidation to exact employer/run identity rather than display-text prefixes",
    approval: "Executed exact-FK/legacy-token tests, default-off parity, PG16 real-HTTP unrelated-run and unchanged-victim proof; no production activation",
  },
  underpaymentDuplicateConflict: {
    env: "UNDERPAYMENT_DUPLICATE_CONFLICT_ENABLED",
    owner: "Payroll / Security",
    risk: "Duplicate correction request returns a conflict instead of an unhandled unique violation",
    approval: "Executed duplicate request, unchanged ledger and exact default-off parity; no production activation",
  },
  xenditReconciliationIdentity: {
    env: "XENDIT_RECONCILIATION_IDENTITY_ENABLED",
    owner: "Treasury / Security",
    risk: "Reject a read-only provider lookup whose returned payout ID differs from the requested transfer identity",
    approval: "Executed exact-ID, mismatch and flag-off parity tests with synthetic provider responses; production activation separate",
  },
  nonceCsp: {
    env: "NEXT_CSP_ENABLED",
    owner: "Security / Web Platform / SEO",
    risk: "Strict nonce script CSP forces dynamic HTML, changes cache/TTFB/SEO behavior and may block hydration or third-party scripts",
    approval: "Exact-build-and-runtime staging flag-off parity, actual page/nonce headers and hydration on desktop/phone, security/error routes, SEO/TTFB/caching and independent release signoff; production default OFF",
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
