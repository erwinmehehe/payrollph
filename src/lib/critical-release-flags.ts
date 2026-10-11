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
