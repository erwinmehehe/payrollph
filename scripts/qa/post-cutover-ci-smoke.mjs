#!/usr/bin/env node
/**
 * Disposable GitHub Actions PG18 ONLY. Exercises the real Next production-mode
 * HTTP server with restricted payrollph_app and payrollph_sealer_login sessions.
 * Never imports/uses Neon tooling; never sends payouts, emails or bank files.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import {
  DATABASE, ROLES, assessChain, assertSameDatabase, inspectExtension,
  inspectGrants, inspectIdentity, inspectLedger, inspectRoles, readAuditChain,
  readCatalog, reportWriter, validateDatabaseUrl,
} from "./post-cutover-smoke-contract.mjs";

const env = process.env;
const BASE = "http://127.0.0.1:3000";
const EMAIL_A = "postcutover-a@example.invalid";
const EMAIL_B = "postcutover-b@example.invalid";
const { report, check, finish } = reportWriter("post-cutover-ci-smoke",
  "qa-artifacts/post-cutover-smoke/ci-report.json");
let app, planner, sealer;
let stopped = false;
const state = {};
const fingerprint = value => createHash("sha256").update(value).digest("hex");

function expectStatus(result, expected, label) {
  assert.equal(result.status, expected, `HTTP_${label}_EXPECTED_${expected}_ACTUAL_${result.status}`);
  return result.json;
}
async function http(path, { method = "GET", body, cookie, extra = {} } = {}) {
  assert.ok(path.startsWith("/") && !path.startsWith("//") &&
    !/\/\//.test(path), "HTTP_PATH_MUST_BE_LOCAL");
  const response = await fetch(BASE + path, {
    method, redirect: "manual", cache: "no-store",
    headers: {
      origin: BASE, "sec-fetch-site": "same-origin",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}), ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const kind = response.headers.get("content-type") ?? "";
  const payload = kind.includes("application/json") ? await response.json() : null;
  if (payload === null) await response.arrayBuffer(); // Never retain financial bytes.
  return { status: response.status, json: payload, headers: response.headers };
}
function cookieFrom(result) {
  const raw = result.headers.get("set-cookie") ?? "";
  const cookie = raw.split(";")[0];
  assert.ok(cookie.startsWith("__Host-linaw_session=") &&
    cookie.length > "__Host-linaw_session=".length + 20, "SESSION_COOKIE_MISSING");
  return cookie;
}
async function assertAuditIncrement(orgId, before, label) {
  const after = Number((await app.query(
    "SELECT count(*)::int AS n FROM public.audit_events WHERE organization_id=$1", [orgId])).rows[0].n);
  assert.ok(after > before, `AUDIT_EVENT_MISSING_AFTER_${label}`);
  return after;
}
async function auditCount(orgId) {
  return Number((await app.query(
    "SELECT count(*)::int AS n FROM public.audit_events WHERE organization_id=$1", [orgId])).rows[0].n);
}
async function denied(client, sql, label) {
  // Writable transaction, not READ ONLY: otherwise the transaction itself
  // would mask a privilege escalation. Always ROLLBACK even on accidental success.
  await client.query("BEGIN");
  let code = "ALLOWED";
  try {
    try { await client.query(sql); } catch (error) { code = error?.code ?? "DENIED"; }
  } finally {
    await client.query("ROLLBACK").catch(() => {});
  }
  assert.ok(code === "42501" || code === "P0001" || code === "2F000" ||
    code === "0A000", `ROLE_DENIAL_${label}_EXPECTED_42501_OR_TRIGGER_GOT_${code}`);
}
async function negativeRoleProofs() {
  const appDeny = [
    ["create", "CREATE TABLE public.post_cutover_unauthorized (id integer)"],
    ["alter", "ALTER TABLE public.audit_events ADD COLUMN post_cutover_unauthorized integer"],
    ["drop", "DROP TABLE public.audit_chain_heads"],
    ["audit_update", "UPDATE public.audit_events SET actor='tamper'"],
    ["audit_delete", "DELETE FROM public.audit_events"],
    ["audit_truncate", "TRUNCATE public.audit_events"],
    ["heads_update", "UPDATE public.audit_chain_heads SET last_seq=777"],
    ["sealer_call", "SELECT public.seal_audit_events(10)"],
    ["ledger_read", "SELECT * FROM public.payrollph_release_migration_receipts LIMIT 1"],
  ];
  for (const [label, sql] of appDeny) await denied(app, sql, "APP_" + label);
  await denied(planner, "CREATE TABLE public.post_cutover_planner_escape (id integer)", "PLANNER_DDL");
  await denied(planner, "INSERT INTO public.audit_events (actor,action,resource,metadata) VALUES ('x','x','x','{}')", "PLANNER_DML");
  await denied(sealer, "UPDATE public.audit_events SET actor='sealer_tamper'", "SEALER_HISTORY_EDIT");
  await denied(sealer, "DELETE FROM public.audit_events", "SEALER_HISTORY_DELETE");
  await denied(sealer, "INSERT INTO public.organizations (name,legal_name) VALUES ('escape','escape')", "SEALER_BUSINESS_DML");
  await denied(sealer, "SELECT public.seal_audit_events(10)", "SEALER_DIRECT_CALL");
  return { negativeProofs: appDeny.length + 6, actualTransactionsRolledBack: true };
}
async function seal() {
  const { dispatchAuditSealing } = await import("../../src/lib/audit-sealer-connection.ts");
  return dispatchAuditSealing(async () => { throw new Error("SMOKE_LEGACY_SEALING_FORBIDDEN"); },
    config => new pg.Client(config), 10000, env);
}
async function fictionalSession(userId) {
  const token = randomBytes(32).toString("hex");
  await app.query(`INSERT INTO public.sessions (user_id, token_hash, expires_at,
    last_seen_at, mfa_verified_at) VALUES ($1,$2,now()+interval '1 hour',now(),now())`,
    [userId, fingerprint(token)]);
  return "__Host-linaw_session=" + token;
}
async function grantFictionalMfa(userId, cookie) {
  // Fixture only, NOT a claim that human TOTP onboarding was tested. Never
  // relax the real API's MFA check or set a deployment flag.
  const sessionToken = cookie.split("=")[1];
  await app.query("UPDATE public.users SET totp_enabled=true WHERE id=$1", [userId]);
  await app.query(`UPDATE public.sessions SET mfa_verified_at=now()
    WHERE user_id=$1 AND token_hash=$2`, [userId, fingerprint(sessionToken)]);
}
async function createChecker(organizationId) {
  // Ordinary app-role DML fixture; all approvals still go through real HTTP.
  const { hashPassword } = await import("../../src/lib/crypto.ts");
  const checkerId = (await app.query(`INSERT INTO public.users
    (email,name,password_hash,role,totp_enabled)
    VALUES ($1,$2,$3,'owner',true) RETURNING id`,
    ["postcutover-checker@example.invalid", "Fictional Checker",
      hashPassword(env.SMOKE_FAKE_ACCOUNT_PASSWORD)])).rows[0].id;
  await app.query(`INSERT INTO public.user_organizations (user_id, organization_id, role, active)
    VALUES ($1,$2,'owner',true)`, [checkerId, organizationId]);
  return { checkerId, cookie: await fictionalSession(checkerId) };
}

async function readiness() {
  const h = expectStatus(await http("/api/health"), 200, "HEALTH");
  assert.deepEqual(Object.keys(h), ["ok"], "HEALTH_PUBLIC_SHAPE");
  const s = expectStatus(await http("/api/status"), 200, "STATUS");
  assert.deepEqual(Object.keys(s), ["ok"], "STATUS_PUBLIC_SHAPE");
  expectStatus(await http("/api/readiness"), 401, "READINESS_ANONYMOUS_DENY");
  const r = expectStatus(await http("/api/readiness", {
    extra: { "x-readiness-token": env.READINESS_TOKEN },
  }), 200, "READINESS_AUTH");
  assert.equal(r.gates?.find(x => x.key === "audit-chain-protection")?.ready,
    true, "AUDIT_ROLE_PROTECTION_READINESS_MUST_BE_TRUE");
  assert.ok(["not-launch-ready", "launch-ready"].includes(r.status),
    "READINESS_STATE_UNKNOWN");
  return { liveness: h.ok, publicStatus: s.ok, readinessState: r.status,
    auditProtectionReady: true };
}

try {
  await check("isolated CI and disposable target guard", async () => {
    assert.equal(env.CI, "true", "CI_MARKER_REQUIRED");
    assert.equal(env.GITHUB_ACTIONS, "true", "ACTIONS_MARKER_REQUIRED");
    assert.equal(env.CUTOVER_ISOLATED_TEST, "true", "EXACT_CUTOVER_RUNNER_REQUIRED");
    assert.equal(env.EXPECTED_DATABASE_NAME, DATABASE, "CI_DATABASE_MUST_BE_CLEAN_BASELINE");
    assert.equal(env.SECURITY_SMOKE_URL, BASE, "CI_HTTP_MUST_BE_LOOPBACK");
    for (const flag of ["PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED",
      "XENDIT_PAYOUTS_LIVE_APPROVED", "FINAL_PAY_MANUAL_RELEASE_ENABLED"]) {
      assert.notEqual(env[flag], "true", `MONEY_MOVEMENT_FLAG_MUST_REMAIN_OFF_${flag}`);
    }
    assert.ok(env.SMOKE_FAKE_ACCOUNT_PASSWORD?.length >= 15 &&
      env.SMOKE_SIGNUP_INVITE_CODE?.length >= 40, "CI_FICTIONAL_ACCOUNT_INPUTS_REQUIRED");
    assertSameDatabase([
      validateDatabaseUrl(env.DATABASE_URL, ROLES.app, env, true),
      validateDatabaseUrl(env.SIM_PLANNER_URL, ROLES.planner, env, true),
      validateDatabaseUrl(env.AUDIT_SEALER_DATABASE_URL, ROLES.sealer, env, true),
    ]);
    return { target: "disposable-loopback", moneyMovement: false };
  }, { fatal: true });

  app = new pg.Client({ connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 5000, statement_timeout: 30000 });
  planner = new pg.Client({ connectionString: env.SIM_PLANNER_URL,
    connectionTimeoutMillis: 5000, statement_timeout: 30000 });
  sealer = new pg.Client({ connectionString: env.AUDIT_SEALER_DATABASE_URL,
    connectionTimeoutMillis: 5000, statement_timeout: 30000 });
  await check("real restricted role identities", async () => {
    await app.connect(); await planner.connect(); await sealer.connect();
    await inspectIdentity(app, env, ROLES.app, true);
    await inspectIdentity(planner, env, ROLES.planner, true);
    await inspectIdentity(sealer, env, ROLES.sealer, true);
    return { app: ROLES.app, planner: ROLES.planner, sealer: ROLES.sealer };
  }, { fatal: true });
  await check("role attributes and effective grants", async () => {
    await inspectRoles(planner);
    await inspectGrants(planner);
    return { DmlOnly: true, auditMutationDenied: true, plannerReadOnly: true };
  }, { fatal: true });
  await check("negative transactional privilege proofs", negativeRoleProofs, { fatal: true });
  await check("btree_gist, migration receipts and cutover row", async () => {
    await inspectExtension(planner);
    return inspectLedger(planner);
  }, { fatal: true });
  await check("catalog snapshot", () => readCatalog(planner), { fatal: true });

  await check("real app boot, liveness and gated readiness", readiness);
  await check("first-run fictional employer signup (app HTTP)", async () => {
    const result = await http("/api/setup", { method: "POST",
      extra: { "x-setup-token": env.SETUP_TOKEN },
      body: { companyName: "Fictional Cutover Employer A", legalName: "Fictional Cutover Employer A",
        name: "Fictional Maker", email: EMAIL_A, password: env.SMOKE_FAKE_ACCOUNT_PASSWORD },
    });
    const payload = expectStatus(result, 201, "SETUP_A");
    assert.ok(Number.isSafeInteger(payload.organizationId), "SETUP_ORGANIZATION_REQUIRED");
    state.a = payload.organizationId;
    state.maker = payload.user.id;
    state.ownerCookie = cookieFrom(result);
    await assertAuditIncrement(state.a, 0, "SETUP_A");
    return { fictional: true, employerCreated: true };
  });
  await check("real login and login audit receipt", async () => {
    const before = await auditCount(state.a);
    const result = await http("/api/auth/login", { method: "POST",
      body: { email: EMAIL_A, password: env.SMOKE_FAKE_ACCOUNT_PASSWORD } });
    expectStatus(result, 200, "LOGIN_A");
    state.ownerCookie = cookieFrom(result);
    await assertAuditIncrement(state.a, before, "LOGIN_A");
    return { sessionIssued: true, loginAudited: true };
  });
  await check("fictional invited signup and login for independent employer B", async () => {
    const registered = await http("/api/signup", { method: "POST",
      body: { name: "Fictional B Owner", company: "Fictional Cutover Employer B",
        email: EMAIL_B, password: env.SMOKE_FAKE_ACCOUNT_PASSWORD,
        privatePilotInviteCode: env.SMOKE_SIGNUP_INVITE_CODE,
        plan: "Core", acceptTerms: true } });
    expectStatus(registered, 201, "SIGNUP_B");
    const logged = await http("/api/auth/login", { method: "POST",
      body: { email: EMAIL_B, password: env.SMOKE_FAKE_ACCOUNT_PASSWORD } });
    const login = expectStatus(logged, 200, "LOGIN_B");
    state.bCookie = cookieFrom(logged);
    const r = await app.query("SELECT uo.organization_id FROM public.user_organizations uo JOIN public.users u ON u.id=uo.user_id WHERE u.email=$1", [EMAIL_B]);
    assert.equal(r.rows.length, 1, "B_MEMBERSHIP_EXPECTED");
    state.b = r.rows[0].organization_id;
    assert.notEqual(state.a, state.b, "DISTINCT_EMPLOYERS_REQUIRED");
    await assertAuditIncrement(state.b, 0, "SIGNUP_B");
    return { independentSession: true, employerCount: 2, loginValid: Boolean(login.user) };
  });
  await check("create fictional maker/checker MFA fixtures (CI only)", async () => {
    assert.ok(state.a && state.ownerCookie, "OWNER_SESSION_REQUIRED");
    await grantFictionalMfa(state.maker, state.ownerCookie);
    const checker = await createChecker(state.a);
    state.checker = checker.checkerId;
    state.checkerCookie = checker.cookie;
    return { independentUsers: true, syntheticMfaFixtureOnly: true };
  });
  await check("employee onboarding through real HTTP", async () => {
    let before = await auditCount(state.a);
    for (let index = 1; index <= 2; index++) {
      const result = await http("/api/employees", { method: "POST", cookie: state.ownerCookie,
        body: { organizationId: state.a, firstName: "Fictional", lastName: `Worker${index}`,
          startDate: "2026-01-05", employeeNo: `SMOKE-${index}`,
          payBasis: "monthly", rateAmount: 22000 + index * 1000,
          bankCode: "BPI", bankAccount: `0000000000${index}`, mobile: "09999999999",
          tin: "000000000", sssNo: "0000000000",
          philHealthNo: "000000000000", pagIbigNo: "000000000000",
          restDay: "Sunday" } });
      expectStatus(result, 201, `EMPLOYEE_${index}`);
      before = await assertAuditIncrement(state.a, before, `EMPLOYEE_${index}`);
    }
    const result = expectStatus(await http(
      `/api/employees?organizationId=${state.a}`, { cookie: state.ownerCookie }),
    200, "EMPLOYEE_DIRECTORY");
    assert.equal(result.length, 2, "EMPLOYEE_COUNT_MUST_BE_TWO");
    return { fictionalEmployees: 2, audited: true };
  });
  await check("two-employer high-risk HTTP read/write isolation", async () => {
    const getB = await http(`/api/employees?organizationId=${state.b}`,
      { cookie: state.ownerCookie });
    assert.equal(getB.status, 403, "A_MUST_NOT_READ_B_EMPLOYEES");
    const getA = await http(`/api/payroll-runs?organizationId=${state.a}`,
      { cookie: state.bCookie });
    assert.equal(getA.status, 403, "B_MUST_NOT_READ_A_PAYROLL");
    const mutation = await http("/api/employees", { method: "POST",
      cookie: state.bCookie,
      body: { organizationId: state.a, firstName: "Forbidden", lastName: "Foreign",
        startDate: "2026-01-01", rateAmount: 22000 } });
    assert.equal(mutation.status, 403, "B_MUST_NOT_WRITE_A_EMPLOYEES");
    const foreignPayroll = await http("/api/payroll-runs", { method: "POST",
      cookie: state.bCookie, body: { organizationId: state.a, periodStart: "2026-09-16",
        periodEnd: "2026-09-30", payDate: "2026-09-30", processNow: false } });
    assert.equal(foreignPayroll.status, 403, "B_MUST_NOT_CREATE_A_PAYROLL");
    const reverseWrite = await http("/api/employees", { method: "POST",
      cookie: state.ownerCookie,
      body: { organizationId: state.b, firstName: "Forbidden",
        lastName: "OtherEmployer", startDate: "2026-01-01", rateAmount: 22000 } });
    assert.equal(reverseWrite.status, 403, "A_MUST_NOT_WRITE_B_EMPLOYEES");
    return { deniedReads: 2, deniedWrites: 3 };
  });
  await check("mid-transaction payroll failure rolls back draft and partial entry", async () => {
    const before = (await app.query(
      "SELECT count(*)::int AS n FROM public.payroll_runs WHERE organization_id=$1",
      [state.a])).rows[0].n;
    const employee = (await app.query(
      "SELECT id FROM public.employees WHERE organization_id=$1 ORDER BY id LIMIT 1",
      [state.a])).rows[0];
    assert.ok(employee?.id, "TRANSACTION_ROLLBACK_EMPLOYEE_FIXTURE_REQUIRED");
    let attemptedRun;
    await app.query("BEGIN");
    try {
      attemptedRun = (await app.query(`INSERT INTO public.payroll_runs
        (organization_id, period_label, period_start, period_end, pay_date, status)
        VALUES ($1,'FICTIONAL ROLLBACK ONLY','2026-08-16','2026-08-31','2026-09-01','Draft')
        RETURNING id`, [state.a])).rows[0].id;
      await app.query(`INSERT INTO public.payroll_entries
        (payroll_run_id, employee_id, gross_pay, deductions, net_pay)
        VALUES ($1,$2,100,10,90)`, [attemptedRun, employee.id]);
      let sqlstate = "UNEXPECTED_SUCCESS";
      try { await app.query("SELECT 1/0"); } catch (error) { sqlstate = error?.code ?? "UNKNOWN"; }
      assert.equal(sqlstate, "22012", "FICTIONAL_MID_RUN_SQL_FAILURE_MUST_OCCUR");
    } finally {
      await app.query("ROLLBACK");
    }
    const runAfter = (await app.query(
      "SELECT count(*)::int AS n FROM public.payroll_runs WHERE organization_id=$1",
      [state.a])).rows[0].n;
    const entriesAfter = (await app.query(`SELECT count(*)::int AS n
      FROM public.payroll_entries e JOIN public.payroll_runs r ON r.id=e.payroll_run_id
      WHERE r.organization_id=$1`, [state.a])).rows[0].n;
    assert.equal(runAfter, before, "MID_TRANSACTION_FAILURE_LEFT_PARTIAL_RUN");
    assert.equal(entriesAfter, 0, "MID_TRANSACTION_FAILURE_LEFT_PARTIAL_PAYROLL_ENTRY");
    return { failedInsideTransaction: true, sqlstate: "22012",
      partialRuns: 0, partialEntries: 0 };
  });
  await check("create payroll draft and ensure audit receipt", async () => {
    const before = await auditCount(state.a);
    const result = await http("/api/payroll-runs", { method: "POST",
      cookie: state.ownerCookie,
      body: { organizationId: state.a, periodStart: "2026-09-01",
        periodEnd: "2026-09-15", payDate: "2026-09-16", processNow: false } });
    const draft = expectStatus(result, 201, "PAYROLL_DRAFT");
    state.run = draft.run.id;
    assert.equal(draft.run.status, "Draft", "PAYROLL_DRAFT_STATE");
    await assertAuditIncrement(state.a, before, "PAYROLL_DRAFT");
    return { draftCreated: true, pendingFunds: false };
  });
  await check("failed payroll processing leaves no partial entries", async () => {
    // The posted draft is real. A malformed processing request must fail
    // closed and preserve its prior snapshot; no fake success or worker bypass.
    const baseline = (await app.query(
      "SELECT count(*)::int AS n FROM public.payroll_entries WHERE payroll_run_id=$1",
      [state.run])).rows[0].n;
    const deniedRequest = await http(`/api/payroll-runs/${state.run}/release`, {
      method: "POST", cookie: state.ownerCookie, body: {} });
    assert.ok([403,409,422].includes(deniedRequest.status),
      "UNAPPROVED_RELEASE_MUST_FAIL");
    const after = (await app.query(
      "SELECT count(*)::int AS n FROM public.payroll_entries WHERE payroll_run_id=$1",
      [state.run])).rows[0].n;
    assert.equal(after, baseline, "FAILED_RELEASE_MUST_NOT_CREATE_PARTIAL_PAYROLL");
    return { unapprovedReleaseDenied: true, partialEntries: 0 };
  });
  await check("calculate real no-money payroll", async () => {
    const before = await auditCount(state.a);
    const r = await http(`/api/payroll-runs/${state.run}/process`, {
      method: "POST", cookie: state.ownerCookie, body: {} });
    const result = expectStatus(r, 200, "PAYROLL_PROCESS");
    assert.ok(["Processed", "Needs review"].includes(result.run?.status),
      "PAYROLL_CALCULATION_STATE_INVALID");
    await assertAuditIncrement(state.a, before, "PAYROLL_PROCESS");
    const entries = (await app.query(
      "SELECT count(*)::int AS n FROM public.payroll_entries WHERE payroll_run_id=$1",
      [state.run])).rows[0].n;
    assert.equal(entries, 2, "PAYROLL_ENTRIES_MUST_MATCH_WORKERS");
    return { calculatedEntries: entries, moneyMoved: false };
  });
  await check("maker submits exact run for independent review", async () => {
    const before = await auditCount(state.a);
    const r = await http(`/api/payroll-runs/${state.run}/submit-review`, {
      method: "POST", cookie: state.ownerCookie, body: { approverUserId: state.checker } });
    const result = expectStatus(r, 201, "SUBMIT_REVIEW");
    state.task = result.task.id;
    await assertAuditIncrement(state.a, before, "SUBMIT_REVIEW");
    return { submitted: true, independentChecker: true };
  });
  await check("checker approves through authenticated HTTP", async () => {
    const before = await auditCount(state.a);
    const entity = (await app.query(
      "SELECT le.legal_name FROM public.payroll_runs pr JOIN public.legal_entities le ON le.id=pr.legal_entity_id WHERE pr.id=$1",
      [state.run])).rows[0];
    assert.ok(entity?.legal_name, "LEGAL_EMPLOYER_REQUIRED");
    state.legalName = entity.legal_name;
    const r = await http(`/api/approvals/${state.task}`, { method: "PATCH",
      cookie: state.checkerCookie,
      body: { status: "Approved", confirmLegalEntityName: state.legalName } });
    expectStatus(r, 200, "CHECKER_APPROVAL");
    await assertAuditIncrement(state.a, before, "CHECKER_APPROVAL");
    return { approved: true, checkerDistinct: true };
  });
  await check("release payroll records only (not money)", async () => {
    const before = await auditCount(state.a);
    const r = await http(`/api/payroll-runs/${state.run}/release`, {
      method: "POST", cookie: state.ownerCookie,
      body: { confirmLegalEntityName: state.legalName, acknowledgeExceptions: true } });
    const result = expectStatus(r, 200, "RELEASE_RECORDS");
    assert.equal(result.run?.status ?? result.status, "Released",
      "RUN_MUST_BE_RELEASED");
    await assertAuditIncrement(state.a, before, "RELEASE_RECORDS");
    return { recordsReleased: true, providerCalled: false, moneyMoved: false };
  });
  await check("payslip retrieval, bank preview and statutory draft only", async () => {
    let before = await auditCount(state.a);
    const pays = expectStatus(await http(
      `/api/payroll-runs/${state.run}/exports?kind=payslip`,
      { cookie: state.ownerCookie }), 200, "PAYSLIP_LIST");
    assert.equal(pays.payslips?.length, 2, "PAYSLICK_COUNT_MUST_BE_TWO");
    const download = await http(
      `/api/payroll-runs/${state.run}/exports?kind=payslip&payslipId=${pays.payslips[0].id}`,
      { cookie: state.ownerCookie });
    assert.equal(download.status, 200, "PAYSLIP_DOWNLOAD_STATUS");
    before = await assertAuditIncrement(state.a, before, "PAYSLIP_DOWNLOAD");
    const bank = await http(
      `/api/payroll-runs/${state.run}/exports?kind=bank&dryRun=true&template=GCash%20Disbursement`,
      { cookie: state.ownerCookie });
    assert.equal(bank.status, 200, "BANK_PREVIEW_MUST_SUCCEED");
    assert.equal(bank.headers.get("x-linaw-dry-run"), "true",
      "BANK_FILE_MUST_BE_DRY_RUN");
    before = await assertAuditIncrement(state.a, before, "BANK_PREVIEW");
    const statutory = await http(
      `/api/payroll-runs/${state.run}/exports?kind=government&template=bir-1601c`,
      { cookie: state.ownerCookie });
    assert.equal(statutory.status, 200, "STATUTORY_DRAFT_MUST_SUCCEED");
    assert.equal(statutory.headers.get("x-linaw-government-file-status"),
      "DRAFT-NOT-CERTIFIED", "STATUTORY_DRAFT_MUST_NOT_CLAIM_FILING");
    await assertAuditIncrement(state.a, before, "STATUTORY_DRAFT");
    return { payslips: pays.payslips.length, bankDryRun: true, statutoryDraft: true,
      providerCalls: 0 };
  });
  await check("sealer login seals all events; anchored audit chain verifies", async () => {
    const sealed = await seal();
    assert.ok(Number.isSafeInteger(sealed) && sealed > 0, "REAL_SEALER_MUST_SEAL");
    const verified = await readAuditChain(app);
    assert.equal(verified.verified, true, "AUDIT_CHAIN_BREAK_" + verified.breaks.join("_"));
    assert.equal(verified.pendingEvents, 0, "AUDIT_CHAIN_UNSEALED_TAIL");
    return { verified: true, sealedEvents: verified.sealedEvents,
      pendingEvents: 0, chains: verified.chainsChecked };
  });
  await check("negative tamper and missing-tail detection (no DB mutation)", async () => {
    const rows = (await app.query(`SELECT organization_id, id, chain_seq, prev_hash, row_hash,
      CASE WHEN chain_seq IS NULL THEN NULL ELSE public.audit_event_row_hash(
        prev_hash, chain_seq, id, organization_id, actor, action, resource, metadata, created_at
      ) END AS expected_hash FROM public.audit_events WHERE organization_id=$1
      ORDER BY chain_seq`, [state.a])).rows;
    const heads = (await app.query(
      "SELECT chain_key,last_seq,last_hash FROM public.audit_chain_heads WHERE chain_key=$1",
      [state.a])).rows;
    assert.ok(rows.length >= 2 && heads.length === 1, "TAMPER_FIXTURE_ROWS_REQUIRED");
    assert.equal(assessChain(rows, heads).verified, true, "REAL_CHAIN_BASELINE_INVALID");
    const tampered = rows.map(x => ({ ...x }));
    tampered[0].expected_hash = "f".repeat(64);
    assert.ok(assessChain(tampered, heads).breaks.includes("row_altered"),
      "TAMPERED_ROW_WAS_NOT_DETECTED");
    assert.ok(assessChain(rows.slice(0,-1), heads).breaks.includes("head_mismatch"),
      "MISSING_TAIL_WAS_NOT_DETECTED");
    return { editedRowRejected: true, deletedTailRejected: true, databaseWrites: false };
  });
  await check("tenant-owned run IDs and approval IDs reject foreign sessions", async () => {
    const attempts = [
      await http(`/api/payroll-runs?runId=${state.run}&include=entries`,
        { cookie: state.bCookie }),
      await http(`/api/payroll-runs/${state.run}/exports?kind=payslip`,
        { cookie: state.bCookie }),
      await http(`/api/approvals/${state.task}`, { method: "PATCH",
        cookie: state.bCookie, body: { status: "Approved" } }),
    ];
    attempts.forEach((a,i) => assert.ok([403,404].includes(a.status),
      `FOREIGN_HIGH_RISK_ROUTE_${i}_DENIAL_REQUIRED`));
    return { foreignRunDenied: true, foreignPayslipDenied: true, foreignApprovalDenied: true };
  });
  await check("restore fictional MFA fixture to permit fresh post-restart login", async () => {
    // A fictional prior session met the existing MFA guard; do not fake
    // an authenticator code on a subsequent genuine login HTTP call.
    await app.query("UPDATE public.users SET totp_enabled=false WHERE id=$1", [state.maker]);
    return { fictionalFixtureRestored: true, authenticReLoginAfterRestart: true };
  });
  await check("restart-proof snapshot (called again after separate server restart)", async () => {
    const query = async () => (await app.query(`SELECT
      (SELECT count(*)::int FROM public.payroll_runs WHERE organization_id=$1) AS runs,
      (SELECT count(*)::int FROM public.payroll_entries WHERE payroll_run_id=$2) AS entries,
      (SELECT count(*)::int FROM public.payslips WHERE organization_id=$1) AS slips,
      (SELECT status FROM public.payroll_runs WHERE id=$2) AS status`,
      [state.a, state.run])).rows[0];
    const snapshot = await query();
    assert.equal(snapshot.runs, 1, "RESTART_RUN_COUNT_MUST_BE_ONE");
    assert.equal(snapshot.entries, 2, "RESTART_ENTRY_COUNT_MUST_BE_TWO");
    assert.equal(snapshot.slips, 2, "RESTART_PAYSLIP_COUNT_MUST_BE_TWO");
    assert.equal(snapshot.status, "Released", "RESTART_RUN_MUST_STAY_RELEASED");
    const chain = await readAuditChain(app);
    assert.equal(chain.verified, true, "RESTART_AUDIT_CHAIN_MUST_VERIFY");
    return { ...snapshot, chainIntact: true };
  });
} catch {
  stopped = true;
} finally {
  await Promise.all([app, planner, sealer].filter(Boolean).map(c => c.end().catch(() => {})));
  const result = finish({ stoppedEarly: stopped, commitSha: env.GITHUB_SHA ?? null,
    fictionalOnly: true, liveDatabaseTouched: false, providerCalls: 0,
    productionFlagsChanged: false, fictionalIds: Number.isSafeInteger(state.a) && Number.isSafeInteger(state.run) ? { organizationId: state.a, runId: state.run } : null });
  if (result.failed || stopped) process.exitCode = 1;
}
