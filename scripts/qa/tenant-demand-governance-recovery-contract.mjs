import assert from "node:assert/strict";

export const DEMAND_RECOVERY_METHODS = Object.freeze([
  "GET workforce/demand-observations/issued",
  "GET workforce/demand-staffing/policies",
]);

/** Executable fail-closed boundary before loading application or database code. */
export function requireDisposableDemandRecovery(env = process.env) {
  const exact = {
    GITHUB_ACTIONS: "true",
    CI: "true",
    NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_TABLE_PROFILE: "allowlisted-reads",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    APP_BASE_URL: "https://payroll.example.test",
    DEMO_MODE: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    HCM_OVERPAYMENT_PREVIEW_ENABLED: "false",
    PAYROLL_OVERPAYMENT_REVIEW_ENABLED: "false",
    WFM_OPERATIONAL_DEMAND_ENABLED: "true",
    WFM_ISSUED_DEMAND_FORECASTS_ENABLED: "true",
    WFM_DEMAND_STAFFING_POLICIES_ENABLED: "true",
  };
  for (const [name, value] of Object.entries(exact)) {
    assert.equal(env[name], value, "DEMAND_RECOVERY_REFUSED: exact disposable " + name + " required");
  }
  for (const name of [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL", "STRIPE_SECRET_KEY",
  ]) {
    assert.ok(!env[name], "DEMAND_RECOVERY_REFUSED: external provider secret " + name);
  }
  assert.match(env.TENANT_TABLE_ALLOWLIST_FIXTURE ?? "",
    /^\/tmp\/payrollph-tenant-allowlist-[A-Za-z0-9]{6}\/fixture\.json$/,
    "DEMAND_RECOVERY_REFUSED: source-owned private bootstrap fixture required");
  for (const name of [
    "WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS",
    "WFM_ISSUED_DEMAND_FORECASTS_ALLOWED_ORGANIZATION_IDS",
    "WFM_DEMAND_STAFFING_POLICIES_ALLOWED_ORGANIZATION_IDS",
  ]) {
    assert.match(env[name] ?? "", /^\d+,\d+,\d+$/,
      "DEMAND_RECOVERY_REFUSED: actual three-employer allowlist required");
  }
}

const hidden = (response) => response.text + "\n" +
  [...(response.headers ?? [])].map(([name, value]) => name + ":" + value).join("\n");

export function assertDemandDenial(response, status, forbidden = []) {
  assert.equal(response?.status, status, "wrong tenant or invalid-scope HTTP denial status");
  assert.ok(response.json && typeof response.json.error === "string",
    "denial must return a bounded error, never a source document");
  assert.ok(typeof response.text === "string" && response.text.length < 2000,
    "denial may not leak an entire persisted source row");
  assert.equal(response.json.issued, undefined);
  assert.equal(response.json.policies, undefined);
  for (const marker of forbidden) {
    assert.ok(typeof marker === "string" && marker.length > 0);
    assert.ok(!hidden(response).includes(marker), "foreign tenant marker leaked");
  }
}

export function assertBoundDemandRead(kind, response, ctx, persisted) {
  assert.ok(DEMAND_RECOVERY_METHODS.some(name => name.includes(
    kind === "issued" ? "demand-observations/issued" : "demand-staffing/policies"
  )));
  assert.equal(response?.status, 200, "real authorized GET must succeed");
  assert.ok(typeof response.text === "string" && response.json && typeof response.json === "object");
  assert.match(response.headers?.get?.("cache-control") ?? "", /private.*no-store/,
    "source-read response must be private and uncached");
  assert.equal(response.json.readOnly, true);
  const rows = kind === "issued" ? response.json.issued : response.json.policies;
  assert.ok(Array.isArray(rows) && rows.length === 1, "one nonempty source-bound GET required");
  const row = rows[0];
  assert.ok(Number.isSafeInteger(persisted?.id) && persisted.id > 0, "actual SQL ID required");
  assert.equal(persisted.organizationId, ctx.orgId);
  assert.equal(persisted.worksiteId, ctx.seeded.siteId);
  assert.equal(row.id, persisted.id, "HTTP ID must equal persisted SQL row ID");
  assert.equal(row.organizationId, persisted.organizationId);
  assert.equal(row.worksiteId, persisted.worksiteId);
  assert.equal(row.id, ctx.seeded.id, "HTTP response cannot borrow another employer's proof");
  if (kind === "issued") {
    assert.equal(persisted.snapshotSha256, ctx.seeded.hash);
    assert.equal(row.snapshotSha256, persisted.snapshotSha256);
    assert.equal(row.sourceKey, persisted.sourceKey);
    assert.equal(row.integrity, "matches_issued_hash");
    assert.equal(row.snapshot?.scope?.organizationId, ctx.orgId);
    assert.equal(row.snapshot?.scope?.worksiteId, ctx.seeded.siteId);
  } else {
    assert.equal(persisted.contentSha256, ctx.seeded.hash);
    assert.equal(persisted.status, "draft", "only fictional unapproved policy fixture");
    assert.equal(row.contentSha256, persisted.contentSha256);
    assert.equal(row.status, "draft");
    assert.equal(row.approvalIntegrity, "matches_hash");
    assert.equal(row.approvalReceiptSha256, null);
  }
  for (const marker of [ctx.victim.marker, ...(ctx.forbiddenMarkers ?? [])]) {
    assert.ok(!hidden(response).includes(marker), "victim/peer evidence appeared in own GET");
  }
  return row;
}

export function assertImmutableDemandSources(before, after, label) {
  assert.deepEqual(after, before,
    label + ": read, denied GET, or forged scope changed tenant source/audit/worker/payroll tables");
}
