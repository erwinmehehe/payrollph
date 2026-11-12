/**
 * Genuine localhost Next HTTP + disposable PG16 test of the pilot's OIDC OFF
 * profile. Not an enabled-SSO security proof and never a method coverage credit.
 */
import assert from "node:assert/strict";

function requireDisposableEnvironment(env = process.env) {
  const expected = {
    CI: "true", GITHUB_ACTIONS: "true",
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    OIDC_SSO_RUNTIME_ENABLED: "false",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false", PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  };
  for (const [key, value] of Object.entries(expected))
    assert.equal(env[key], value, "OIDC_HOLD_REFUSED: unsafe " + key);
  for (const key of [
    "NEON_DATABASE_URL", "OPENAI_API_KEY", "PAYMONGO_SECRET_KEY",
    "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY", "RESEND_API_KEY",
    "POSTMARK_SERVER_TOKEN", "SMTP_PASSWORD", "WORKER_TOKEN",
    "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY",
  ]) assert.ok(!env[key], "OIDC_HOLD_REFUSED: forbidden provider/production credential " + key);
}

async function main() {
  requireDisposableEnvironment(); // before importing any app or database module
  const [{ db, pool }, schema, orm] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("drizzle-orm"),
  ]);
  const version = await pool.query("show server_version_num");
  assert.equal(Math.floor(Number(version.rows[0].server_version_num) / 10000), 16,
    "OIDC_HOLD_REFUSED: PostgreSQL 16 required");
  const tracked = [
    "organizations", "users", "userOrganizations", "identityProviders",
    "identityDomains", "oidcLoginStates", "externalIdentities", "sessions",
    "auditEvents", "employees", "payrollRuns",
  ];
  async function snapshot() {
    const rows = {};
    for (const table of tracked) {
      rows[table] = await db.select().from(schema[table]).orderBy(orm.asc(schema[table].id));
    }
    return rows;
  }
  try {
    const base = process.env.SECURITY_SMOKE_URL;
    const scenarios = [
      ["start", base + "/api/auth/sso/start?providerId=12345678&loginHint=pilot@example.invalid"],
      ["start-forged", base + "/api/auth/sso/start?providerId=1e0&loginHint=forged@example.invalid"],
      ["callback", base + "/api/auth/sso/callback?code=fictional&state=fictional"],
      ["callback-error", base + "/api/auth/sso/callback?error=access_denied"],
      ["resolve", base + "/api/auth/sso/resolve"],
      ["resolve-forged", base + "/api/auth/sso/resolve"],
    ];
    const before = await snapshot();
    let commonBody = null;
    for (const [kind, url] of scenarios) {
      const isPost = kind.startsWith("resolve");
      const response = await fetch(url, isPost ? {
        method: "POST", redirect: "manual", cache: "no-store",
        headers: { origin: "https://payroll.example.test",
          "sec-fetch-site": "same-origin", "content-type": "application/json" },
        body: JSON.stringify(kind === "resolve"
          ? { email: "pilot@example.invalid" }
          : { email: "forged@example.invalid", organizationId: 98765, providerId: 12345678 }),
      } : { redirect: "manual", cache: "no-store" });
      assert.equal(response.status, 503, kind);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/, kind);
      assert.equal(response.headers.get("set-cookie"), null, kind);
      const payload = await response.json();
      assert.deepEqual(payload, {
        error: "SSO sign-in is not available.",
        code: "OIDC_SSO_RUNTIME_DISABLED",
      }, kind);
      const body = JSON.stringify(payload);
      if (commonBody === null) commonBody = body;
      assert.equal(body, commonBody, "all providers and selectors receive uniform refusal");
      assert.deepEqual(await snapshot(), before,
        "SSO gate must not mutate any tenant, payroll, audit, session or identity table: " + kind);
    }
    console.log("OIDC_SSO_PILOT_OFF_PG16 " + JSON.stringify({
      routes: 3, refusedCases: scenarios.length, dataUnchanged: true,
      sessionCreated: false, providerCalls: 0, moneyMoved: false,
      apiCoverageCredits: 0, independentSecurityReview: "PENDING",
      productionCertified: false,
    }));
  } finally {
    await pool.end();
  }
}
main().catch(error => {
  console.error("OIDC_HOLD_REFUSED", String(error?.message ?? error));
  process.exitCode = 1;
});
