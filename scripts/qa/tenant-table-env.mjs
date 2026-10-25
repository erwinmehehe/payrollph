/**
 * Server and runner environment for the shared tenant-table proof, per profile. The workflow and
 * the local launcher both read this, so a row's flags are on wherever it is credited.
 * Disposable-only values: fictional tokens, localhost URLs, payouts disabled.
 */
export const TENANT_TABLE_PROFILES = Object.freeze({
  default: {
    XENDIT_BILLING_ENABLED: "true",
    ENGAGEMENT_SURVEY_ENABLED: "true",
    HCM_MANAGER_DECISION_INBOX_ENABLED: "true",
    HCM_ORG_EXPLORER_ENABLED: "true",
    HCM_OVERPAYMENT_PREVIEW_ENABLED: "true",
    PAYROLL_OVERPAYMENT_REVIEW_ENABLED: "true",
    CORE_MODULE_NAVIGATION_ENABLED: "true",
  },
  // Reads that are 404 unless their own plain release flag is on; kept off the default server so the
  // default rows are proven in the same shape as production.
  "flagged-reads": {
    HCM_MY_TEAM_ENABLED: "true",
    HCM_WORKER_360_ENABLED: "true",
    APPLICANT_PRIVACY_CONTROLS_ENABLED: "true",
    // Synthetic configured-policy GET/POST only; published rosters are not exercised.
    WFM_ROSTER_SCALE_RULES_ENABLED: "true",
  },
  // Multi-entity changes other workflows (entity holds), so its rows run in their own server.
  "multi-entity": {
    MULTI_ENTITY_ENABLED: "true",
    MULTI_ENTITY_TRANSFERS_ENABLED: "true",
  },
});

export const TENANT_TABLE_BASE_ENV = Object.freeze({
  CI: "true",
  TZ: "Asia/Manila",
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: "http://127.0.0.1:3000",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  DEMO_MODE: "false",
  REQUIRE_PRIVILEGED_MFA: "true",
  REQUEST_SCHEMA_READONLY_ENABLED: "true",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false",
  PAYMONGO_SECRET_KEY: "",
  XENDIT_SECRET_KEY: "",
  XENDIT_BUSINESS_ID: "ci-fictional-merchant",
  XENDIT_CALLBACK_TOKEN: "ci-fake-xendit-subscription-callback",
  WORKER_TOKEN: "ci-worker-token-00000000000000000000000000000000",
  READINESS_TOKEN: "ci-readiness-token-0000000000000000000000000000",
  SETUP_TOKEN: "ci-setup-token-0000000000000000000000000000000",
  TOTP_ENCRYPTION_KEY: "1111111111111111111111111111111111111111111111111111111111111111",
  MALWARE_SCAN_URL: "https://scanner.invalid/scan",
  MALWARE_SCAN_TOKEN: "ci-malware-token-0000000000000000000000000000",
  NEXT_TELEMETRY_DISABLED: "1",
});

// CI: `node scripts/qa/tenant-table-env.mjs <profile> >> "$GITHUB_ENV"` exports exactly these values.
if (process.argv[1] && process.argv[1].replaceAll("\\", "/").endsWith("scripts/qa/tenant-table-env.mjs")) {
  const profile = process.argv[2] ?? "default";
  if (!TENANT_TABLE_PROFILES[profile]) { console.error("unknown tenant-table profile: " + profile); process.exit(2); }
  const env = { ...TENANT_TABLE_BASE_ENV, ...TENANT_TABLE_PROFILES[profile], TENANT_TABLE_PROFILE: profile };
  for (const [name, value] of Object.entries(env)) process.stdout.write(name + "=" + value + "\n");
}
