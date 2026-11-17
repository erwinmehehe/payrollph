import assert from "node:assert/strict";

export const PHASE15_DATABASE = "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
export const PHASE15_OFF = ["PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED",
  "XENDIT_BILLING_ENABLED", "WORKER_ENABLED", "CENTRAL_SCHEDULER_ENABLED"] as const;
const optionalOff = ["EXACT_THIRTEENTH_CENTAVOS_ENABLED", "FINAL_PAY_SIGNED_REVIEW_ENABLED",
  "FINAL_PAY_MANUAL_RELEASE_ENABLED", "PAYROLL_CALCULATION_HISTORY_ENABLED", "NEXT_CSP_ENABLED"];
const forbidden = ["NEON_DATABASE_URL", "VERCEL", "VERCEL_ENV", "VERCEL_URL",
  "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY", "STRIPE_SECRET_KEY",
  "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL", "SMTP_HOST", "SMTP_PASSWORD",
  "SENDGRID_API_KEY", "MAILGUN_API_KEY", "OPENAI_API_KEY", "WORKER_TOKEN", "CRON_SECRET"];
export type Phase15Mode = "local-disposable-pg16-only" | "github-actions-pg16-only";

/** Pure preflight: call before importing the application's pool or engine. */
export function requirePhase15Environment(env: Readonly<Record<string, string | undefined>>): Phase15Mode {
  const mode = env.GOLDEN_PHASE15_DISPOSABLE;
  assert.ok(mode === "local-disposable-pg16-only" || mode === "github-actions-pg16-only",
    "PHASE15_REFUSED: explicit disposable mode required");
  if (mode === "local-disposable-pg16-only") {
    assert.notEqual(env.CI, "true", "PHASE15_REFUSED: local mode cannot impersonate CI");
    assert.notEqual(env.GITHUB_ACTIONS, "true", "PHASE15_REFUSED: local mode cannot impersonate GitHub Actions");
    assert.equal(env.GOLDEN_PHASE15_LOCAL_CONFIRM, "fresh-empty-fictional-database",
      "PHASE15_REFUSED: confirm this computer's fresh fictional database");
  } else {
    assert.equal(env.CI, "true", "PHASE15_REFUSED: CI required");
    assert.equal(env.GITHUB_ACTIONS, "true", "PHASE15_REFUSED: GitHub Actions required");
  }
  assert.ok(env.DATABASE_URL === PHASE15_DATABASE, "PHASE15_REFUSED: exact local disposable database required");
  for (const name of PHASE15_OFF) assert.equal(env[name], "false", "PHASE15_REFUSED: unsafe " + name);
  for (const name of optionalOff) assert.ok(!env[name] || env[name] === "false", "PHASE15_REFUSED: unsafe " + name);
  for (const name of forbidden) assert.ok(!env[name], "PHASE15_REFUSED: configured provider/deployment " + name);
  return mode;
}

export function requirePhase15Database(state: {
  version: number; employers: number; database: string; serverAddress: string | null; clientAddress: string | null;
}, mode: Phase15Mode) {
  assert.ok(state.version >= 160000 && state.version < 170000, "PHASE15_REFUSED: PostgreSQL 16 required");
  assert.equal(state.employers, 0, "PHASE15_REFUSED: database must contain no employers");
  assert.equal(state.database, "app_db", "PHASE15_REFUSED: wrong database");
  if (mode === "local-disposable-pg16-only") {
    for (const address of [state.serverAddress, state.clientAddress])
      assert.ok(address === "127.0.0.1" || address === "::1", "PHASE15_REFUSED: local server/client must be loopback (no remote tunnel)");
  }
}
