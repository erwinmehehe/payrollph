import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { requireDisposableHcmSla, assertDenied, assertSweepResponse,
  assertTenantEscalation, assertUnchanged } from "../scripts/qa/tenant-hcm-sla-escalation-contract.mjs";

const good = {
  CI: "true", GITHUB_ACTIONS: "true", TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  TENANT_HCM_SLA_QA_MODE: "fictional-disposable-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DEMO_MODE: "false", WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", HCM_SLA_CRON_SECRET: "a".repeat(64),
};

test("fails closed on remote, non-ephemeral, production, money or provider settings", () => {
  assert.doesNotThrow(() => requireDisposableHcmSla(good));
  const bad = {
    CI: "false", GITHUB_ACTIONS: "false", TENANT_SECOND_PASS_MODE: "",
    TENANT_HCM_SLA_QA_MODE: "",
    DATABASE_URL: "postgresql://postgres:postgres@prod.example.invalid:5432/app_db",
    SECURITY_SMOKE_URL: "http://example.invalid:3000",
    DEMO_MODE: "true", NODE_ENV: "production",
    WORKER_ENABLED: "true", CENTRAL_SCHEDULER_ENABLED: "true",
    PAYMONGO_DISBURSEMENTS_ENABLED: "true", XENDIT_PAYOUTS_ENABLED: "true",
    XENDIT_BILLING_ENABLED: "true", HCM_SLA_CRON_SECRET: "insecure",
    RESEND_API_KEY: "secret", SMTP_URL: "smtp://example.invalid",
    NEON_DATABASE_URL: "postgresql://example.invalid",
    XENDIT_API_KEY: "secret", PAYMONGO_SECRET_KEY: "secret",
    DATABASE_URL_UNPOOLED: "postgresql://example.invalid",
  };
  for (const [name, value] of Object.entries(bad)) {
    assert.throws(() => requireDisposableHcmSla({ ...good, [name]: value }),
      /HCM_SLA_QA_REFUSED/, name + " must be refused");
  }
  for (const badTarget of ["http://localhost:3000", "http://127.0.0.1:3001",
    "http://127.0.0.1:3000/other", "http://127.0.0.1:3000/?x=1"]) {
    assert.throws(() => requireDisposableHcmSla({ ...good, SECURITY_SMOKE_URL: badTarget }));
  }
});

test("HTTP result contracts reject success-shaped denials and employer leaks", () => {
  const response = (status, json = { error: "Unauthorized." }) =>
    ({ status, json, text: JSON.stringify(json), headers: new Headers() });
  assert.doesNotThrow(() => assertDenied(response(401), 401, ["VICTIM-MARKER"]));
  assert.throws(() => assertDenied(response(200), 401));
  assert.throws(() => assertDenied(response(401, { error: "VICTIM-MARKER" }), 401, ["VICTIM-MARKER"]));
  assert.doesNotThrow(() =>
    assertSweepResponse(response(200, { escalated: 2, remainingMayExist: false }), 2));
  assert.throws(() =>
    assertSweepResponse(response(200, { escalated: 0, remainingMayExist: false }), 2));
  assert.throws(() =>
    assertSweepResponse(response(200, { escalated: 2, remainingMayExist: true }), 2));
});

test("persisted proof rejects missing events, foreign recipient, payroll mutation and forged count", () => {
  const before = {
    cases: [{ id: 4, organization_id: 2, escalated_at: null, escalation_level: 0,
      updated_at: "2026-01-01T00:00:00.000Z", status: "open" }],
    events: [], outbox: [], employees: [], payProfiles: [], payrollRuns: [], audits: [],
  };
  const after = {
    ...before,
    cases: [{ ...before.cases[0], escalated_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z", escalation_level: 1 }],
    events: [{ id: 10, organization_id: 2, case_id: 4, event_type: "sla_escalated",
      next_value: { level: 1, team: "HR Operations", ownerUserId: 7 } }],
    outbox: [{ id: 11, organization_id: 2, recipient: "owner@example.invalid", channel: "email",
      purpose: "hcm_sla_escalation", status: "queued",
      dedupe_key: "hcm-sla:2:4:123:owner@example.invalid", body: "Synthetic notice" }],
  };
  const expected = { caseId: 4, organizationId: 2, ownerId: 7,
    recipient: "owner@example.invalid", foreignMarkers: ["VICTIM-SECRET"] };
  assert.doesNotThrow(() => assertTenantEscalation(before, after, expected));
  const change = fn => { const copy = structuredClone(after); fn(copy); return copy; };
  assert.throws(() => assertTenantEscalation(before, change(x => x.events = []), expected));
  assert.throws(() => assertTenantEscalation(before,
    change(x => x.outbox[0].recipient = "victim@example.invalid"), expected));
  assert.throws(() => assertTenantEscalation(before,
    change(x => x.payrollRuns.push({ id: 1 })), expected));
  assert.throws(() => assertTenantEscalation(before,
    change(x => x.events[0].organization_id = 3), expected));
  assert.throws(() => assertTenantEscalation(before,
    change(x => x.outbox[0].body = "VICTIM-SECRET"), expected));
  assert.throws(() => assertUnchanged(before, after));
});

test("scope stays exclusive to HCM SLA cron, with an exact existing route source pin", () => {
  const path = "src/app/api/hcm/work-items/escalate/route.ts";
  const file = readFileSync(path);
  const blobSha = createHash("sha1").update("blob " + file.length + "\0").update(file).digest("hex");
  assert.equal(blobSha, "b432d1331dac5c3da0c6a8bbc2b4c7ebe95ceb9a",
    "source changed; re-review route before accepting new proof");
  const source = file.toString("utf8");
  for (const match of [
    "HCM_SLA_CRON_SECRET", "timingSafeEqual", "FOR UPDATE SKIP LOCKED",
    "sla_escalated", "hcm_sla_escalation", "uo.organization_id=$1",
    "uo.active=true", "uo.org_unit_id IS NULL", "ON CONFLICT (dedupe_key)",
    'await client.query("COMMIT")', 'await client.query("ROLLBACK")',
  ]) assert.ok(source.includes(match), "missing audited scheduler barrier " + match);

  const runner = readFileSync("scripts/qa/tenant-hcm-sla-escalation-http.mjs", "utf8");
  for (const match of [
    "requireDisposableHcmSla(process.env)", "current_database()", "server_version_num",
    "seedEmployer(", 'caseFixture(a, 101, "due")', 'caseFixture(b, 201, "due")',
    'caseFixture(victim, 301, "future")',
    "assertTenantEscalation(", "assertUnchanged(", "coverageCredits: 0",
    "realNotificationsSent: false",
  ]) assert.ok(runner.includes(match), "missing real-HTTP proof step " + match);
});
