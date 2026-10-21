#!/usr/bin/env node
// Runs after the GitHub job terminates and restarts the *same* Next production
// server against the *same* disposable cutover database. No provider calls.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";
import {
  DATABASE, ROLES, inspectIdentity, readAuditChain,
  reportWriter, validateDatabaseUrl,
} from "./post-cutover-smoke-contract.mjs";

const { check, finish } = reportWriter("post-cutover-restart-ci-smoke",
  "qa-artifacts/post-cutover-smoke/restart-report.json");
const env = process.env;
let client;
let stoppedEarly = false;
let original;

try {
  await check("isolated post-restart configuration and passed initial report", () => {
    assert.equal(env.CI, "true", "CI_REQUIRED");
    assert.equal(env.GITHUB_ACTIONS, "true", "GITHUB_ACTIONS_REQUIRED");
    assert.equal(env.EXPECTED_DATABASE_NAME, DATABASE, "CI_DISPOSABLE_DATABASE_REQUIRED");
    validateDatabaseUrl(env.DATABASE_URL, ROLES.app, env, true);
    original = JSON.parse(readFileSync(
      "qa-artifacts/post-cutover-smoke/ci-report.json", "utf8"));
    assert.equal(original.kind, "post-cutover-ci-smoke", "ORIGINAL_REPORT_KIND_REQUIRED");
    assert.equal(original.failed, 0, "INITIAL_SMOKE_MUST_PASS_BEFORE_RESTART");
    assert.equal(original.commitSha, env.GITHUB_SHA, "INITIAL_SMOKE_SAME_COMMIT_REQUIRED");
    assert.ok(Number.isSafeInteger(original.fictionalIds?.organizationId) &&
      Number.isSafeInteger(original.fictionalIds?.runId),
    "INITIAL_FICTIONAL_IDS_REQUIRED");
    return { sameDatabase: true, reportsConsistent: true };
  }, { fatal: true });

  client = new pg.Client({ connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 5000, statement_timeout: 15000 });
  await check("restarted app role identity and HTTP readiness", async () => {
    await client.connect();
    await inspectIdentity(client, env, ROLES.app, true);
    const health = await fetch("http://127.0.0.1:3000/api/health", {
      method: "GET", redirect: "manual", signal: AbortSignal.timeout(10000) });
    assert.equal(health.status, 200, "RESTART_HEALTH_HTTP_200");
    assert.equal((await health.json()).ok, true, "RESTART_HEALTH_OK");
    const readiness = await fetch("http://127.0.0.1:3000/api/readiness", {
      method: "GET", redirect: "manual",
      headers: { "x-readiness-token": env.READINESS_TOKEN },
      signal: AbortSignal.timeout(10000) });
    assert.equal(readiness.status, 200, "RESTART_READINESS_HTTP_200");
    const payload = await readiness.json();
    assert.equal(payload.gates?.find(x => x.key === "audit-chain-protection")?.ready,
      true, "RESTART_AUDIT_ROLE_PROTECTION");
    return { restarted: true, restrictedRole: ROLES.app, readinessState: payload.status };
  });
  await check("persisted single payroll, entries and payslips without duplication", async () => {
    const { organizationId, runId } = original.fictionalIds;
    const { rows: [data] } = await client.query(`SELECT
      (SELECT count(*)::int FROM public.payroll_runs WHERE organization_id=$1) AS runs,
      (SELECT count(*)::int FROM public.payroll_entries WHERE payroll_run_id=$2) AS entries,
      (SELECT count(*)::int FROM public.payslips WHERE organization_id=$1) AS payslips,
      (SELECT status FROM public.payroll_runs WHERE id=$2) AS run_status`,
      [organizationId, runId]);
    assert.equal(data.runs, 1, "RESTART_DUPLICATE_PAYROLL_RUN");
    assert.equal(data.entries, 2, "RESTART_DUPLICATE_OR_MISSING_PAYROLL_ENTRIES");
    assert.equal(data.payslips, 2, "RESTART_DUPLICATE_OR_MISSING_PAYSLIPS");
    assert.equal(data.run_status, "Released", "RESTART_RUN_NOT_RELEASED");
    return { runs: data.runs, entries: data.entries, payslips: data.payslips,
      status: data.run_status };
  });
  await check("persisted hash-chain head and missing-tail verification", async () => {
    const chain = await readAuditChain(client);
    assert.equal(chain.verified, true, "RESTART_CHAIN_BREAK_" + chain.breaks.join("_"));
    assert.equal(chain.pendingEvents, 0, "RESTART_PENDING_SEAL_TAIL");
    return { intact: true, sealedEvents: chain.sealedEvents,
      missingTail: false, pendingEvents: 0 };
  });
  await check("restarted HTTP has exactly one employer payroll", async () => {
    const logged = await fetch("http://127.0.0.1:3000/api/auth/login", {
      method: "POST", redirect: "manual",
      headers: { origin: "http://127.0.0.1:3000",
        "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: JSON.stringify({ email: "postcutover-a@example.invalid",
        password: env.SMOKE_FAKE_ACCOUNT_PASSWORD }),
      signal: AbortSignal.timeout(12000),
    });
    assert.equal(logged.status, 200, "RESTART_LOGIN_FAILED");
    const cookie = (logged.headers.get("set-cookie") ?? "").split(";")[0];
    assert.ok(cookie.startsWith("__Host-linaw_session="), "RESTART_SESSION_MISSING");
    const r = await fetch(
      `http://127.0.0.1:3000/api/payroll-runs?organizationId=${original.fictionalIds.organizationId}`,
      { method: "GET", headers: { cookie }, signal: AbortSignal.timeout(12000) });
    assert.equal(r.status, 200, "RESTART_PAYROLL_REGISTER_HTTP_DENIED");
    const body = await r.json();
    assert.equal(body.runs?.length, 1, "RESTART_HTTP_PAYROLL_COUNT_NOT_ONE");
    assert.equal(body.runs[0].id, original.fictionalIds.runId,
      "RESTART_HTTP_PAYROLL_ID_CHANGED");
    return { persistedHttpSession: true, noDuplicateRuns: true };
  });
} catch {
  stoppedEarly = true;
} finally {
  await client?.end().catch(() => {});
  const outcome = finish({ stoppedEarly, liveDatabaseTouched: false,
    providerCalls: 0, moneyMoved: false });
  if (outcome.failed || stoppedEarly) process.exitCode = 1;
}
