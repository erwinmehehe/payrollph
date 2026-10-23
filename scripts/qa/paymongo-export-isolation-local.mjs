/**
 * MNY-01 payroll lifecycle and correction proof. Fictional records only.
 * Own successes, real victim IDs, forged selectors and unchanged-victim SQL
 * snapshots are executed over real HTTP. No provider is configured or called.
 * This is a partial MNY-01 implementation, never closure of its 33-method queue.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { assertMoneyProofTarget } from "./money-proof-target.mjs";

assertMoneyProofTarget(process.env);
assert.equal(process.env.MONEY_PROOF_TRANSPORT, "direct-test-only", "Local handler investigation only; not HTTP acceptance");
const { db, pool } = await import("../../src/db/index.ts");
const s = await import("../../src/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { encryptBankAccount } = await import("../../src/lib/bank-account-crypto.ts");
const base = process.env.MONEY_PROOF_URL;
const receipts = [];
const successes = [];

// Optional local fixture diagnosis WITHOUT opening a listening socket. CI
// never selects this adapter: its acceptance still requires real HTTP/auth.
const direct = process.env.MONEY_PROOF_TRANSPORT === "direct-test-only";
const require = createRequire(import.meta.url);
let directUser;
if (direct) {
  assert.notEqual(process.env.CI, "true", "CI proof cannot use the local authentication adapter");
  assert.notEqual(process.env.GITHUB_ACTIONS, "true", "GitHub acceptance must use real HTTP authentication");
  assert.equal(process.env.NODE_ENV, "production", "Direct fixture diagnosis must still enforce MFA");
  const authPath = require.resolve("../../src/lib/auth.ts");
  const auth = require(authPath);
  require.cache[authPath].exports = { ...auth, getSessionUser: async () => directUser };
}
let assertions = 0;
function check(condition, label) { assert.ok(condition, label); assertions++; }
async function request(path, cookie, method = "GET", body) {
  const options = { method, redirect: "manual", cache: "no-store",
    headers: { cookie, origin: base, "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) };
  let response;
  if (direct) {
    const raw = cookie.split("=")[1];
    const identity = await pool.query(`SELECT u.*, s.mfa_verified_at, s.auth_method FROM users u
      JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now()`,
    [createHash("sha256").update(raw).digest("hex")]);
    check(identity.rows.length === 1, "direct fixture identity exists");
    const r = identity.rows[0];
    directUser = { ...r, id: r.id, totpEnabled: r.totp_enabled, employeeId: r.employee_id,
      mfaVerifiedAt: r.mfa_verified_at, authMethod: r.auth_method };
    const routes = [
      [/^\/api\/payroll-runs\/(\d+)\/(exports|payout-reconciliation)$/, m => [`payroll-runs/[id]/${m[2]}`, { id: m[1] }]],
      [/^\/api\/approvals\/(\d+)$/, m => ["approvals/[id]", { id: m[1] }]],
      [/^\/api\/(payroll-earnings|payroll-underpayments|holidays)$/, m => [m[1], {}]],
    ];
    const pathname = new URL(path, base).pathname;
    const found = routes.map(([pattern, route]) => { const m = pattern.exec(pathname); return m ? route(m) : null; }).find(Boolean);
    assert.ok(found, "direct adapter allowlists only the reviewed money routes");
    const handler = require(`../../src/app/api/${found[0]}/route.ts`)[method];
    response = await handler(new Request(new URL(path, base), options), { params: Promise.resolve(found[1]) });
  } else response = await fetch(new URL(path, base), options);
  const text = await response.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, text, json, headers: [...response.headers] };
}
function status(r, expected, label) {
  assert.equal(r.status, expected, label + ": " + r.text.slice(0, 1500)); assertions++;
  return r.json;
}
async function login(org, label, nonce, role = "owner") {
  const [user] = await db.insert(s.users).values({ email: `${label}-${nonce}@example.invalid`,
    name: `${label}-${nonce}`, role, passwordHash: "synthetic-no-password-login", totpEnabled: true }).returning();
  await db.insert(s.userOrganizations).values({ userId: user.id, organizationId: org.id, role, active: true });
  const raw = randomBytes(32).toString("hex");
  const [session] = await db.insert(s.sessions).values({ userId: user.id,
    tokenHash: createHash("sha256").update(raw).digest("hex"), expiresAt: new Date(Date.now() + 3600000),
    lastSeenAt: new Date(), mfaVerifiedAt: new Date(), authMethod: "oidc" }).returning();
  return { user, session, cookie: "__Host-linaw_session=" + raw };
}
async function seed(label, nonce) {
  const [org] = await db.insert(s.organizations).values({ name: `MNY01 ${label} ${nonce}`,
    legalName: `Fictional ${label}` }).returning();
  const [entity] = await db.insert(s.legalEntities).values({ organizationId: org.id, code: label,
    legalName: `Fictional ${label}`, displayName: label, primaryEntity: true }).returning();
  const maker = await login(org, label + "maker", nonce);
  const checker = await login(org, label + "checker", nonce);
  const releaser = await login(org, label + "releaser", nonce);
  const employeeUser = await login(org, label + "employee", nonce, "employee");
  const [worker] = await db.insert(s.employees).values({ organizationId: org.id, legalEntityId: entity.id,
    employeeNo: `MNY01-${label}-${nonce}`, firstName: label, lastName: "Synthetic", title: "Fictional worker",
    avatarInitials: "MS", basicRate: "60000.00", startDate: "2025-01-01", region: "NCR",
    bankCode: "BPI", bankAccount: encryptBankAccount("000000000001") }).returning();
  await db.insert(s.employeePayProfiles).values({ organizationId: org.id, employeeId: worker.id,
    payBasis: "monthly", rateAmount: "60000.00", standardWorkDaysPerMonth: "22.00", standardHoursPerDay: "8.00" });
  const [source] = await db.insert(s.payrollRuns).values({ organizationId: org.id, legalEntityId: entity.id,
    periodLabel: `MNY01 ${label} source`, periodStart: "2025-12-01", periodEnd: "2025-12-15",
    payDate: "2025-12-16", status: "Released", employeeCount: 1, grossPay: "30000.00", netPay: "28000.00" }).returning();
  await db.insert(s.payrollEntries).values({ payrollRunId: source.id, employeeId: worker.id,
    grossPay: "30000.00", deductions: "2000.00", netPay: "28000.00",
    trace: { payment: { employeeName: worker.firstName + " " + worker.lastName, employeeNo: worker.employeeNo, bankAccount: worker.bankAccount, bankCode: worker.bankCode, mobile: worker.mobile } },
    lineItems: [{ code: "BASIC", label: "Basic pay", amount: 30000 }, { code: "WHT", label: "Withholding tax", amount: -2000 }] });
  const [run] = await db.insert(s.payrollRuns).values({ organizationId: org.id, legalEntityId: entity.id,
    periodLabel: `MNY01 ${label} calculate`, periodStart: "2026-01-01", periodEnd: "2026-01-15",
    payDate: "2026-01-16", status: "Draft" }).returning();
  return { label, org, entity, maker, checker, releaser, employeeUser, worker, source, run };
}
// Include organization-scoped money/audit tables AND run-linked detail rows.
async function snapshot(v) {
  const tables = (await pool.query(`SELECT table_name FROM information_schema.columns
    WHERE table_schema='public' AND column_name='organization_id'
    AND table_name ~ '^(payroll|payout|approval|audit|supplementary|loan|statutory|payslip|employee|holiday)'
    ORDER BY table_name`)).rows.map(r => r.table_name);
  const state = {};
  for (const name of tables) {
    assert.match(name, /^[a-z_]+$/);
    state[name] = (await pool.query(`SELECT to_jsonb(t) AS row FROM "${name}" t WHERE organization_id=$1 ORDER BY to_jsonb(t)::text`, [v.org.id])).rows;
  }
  state.entries = (await pool.query(`SELECT to_jsonb(e) AS row FROM payroll_entries e JOIN payroll_runs r
    ON r.id=e.payroll_run_id WHERE r.organization_id=$1 ORDER BY e.id`, [v.org.id])).rows;
  return state;
}
async function deny(v, actor, path, method, body, expected, label) {
  const before = await snapshot(v);
  const r = await request(path, actor.cookie, method, body);
  status(r, expected, label);
  check(!r.text.includes(v.worker.employeeNo) && !JSON.stringify(r.headers).includes(v.worker.employeeNo), label + " no victim marker");
  assert.deepEqual(await snapshot(v), before, label + " unchanged victim money/audit state"); assertions++;
  receipts.push({ actor: actor.user.id, method, path, status: expected, label, victimOrganizationId: v.org.id, unchangedVictim: true });
}

const providerCalls = [];
const batches = new Map();
const originalFetch = globalThis.fetch;
const priorSecret = process.env.PAYMONGO_SECRET_KEY;
globalThis.fetch = async (url, options) => {
  const method = options?.method ?? 'GET';
  providerCalls.push({ url: String(url), method });
  check(method === 'GET', 'Investigation forbids all provider writes');
  const batchId = String(url).replace('https://api.paymongo.com/v2/batch_transfers/', '');
  check(batches.has(batchId), 'Only an explicitly registered fictional provider read is allowed');
  return Response.json({ data: { id: batchId, transfers: [batches.get(batchId)] } });
};
async function providerFixture(a) {
  const batchId = `batch_tr_synthetic_${a.source.id}`;
  batches.set(batchId, { id: 'tr_synthetic_' + a.source.id, reference_number: `PAY-${a.source.id}-${a.worker.employeeNo}`,
    provider: 'pesonet', status: 'succeeded', amount: 2800000 });
  await db.insert(s.auditEvents).values({ organizationId: a.org.id, actor: a.releaser.user.name,
    action: 'Payroll payout submitted via PayMongo', resource: 'Fictional source',
    metadata: { runId: a.source.id, batchId } });
}
async function deniedNoProvider(v, actor, path, method, body, expected, label) {
  const count = providerCalls.length;
  await deny(v, actor, path, method, body, expected, label);
  check(providerCalls.length === count, label + ' cannot contact the synthetic provider');
}
async function investigate(v, a) {
  const exportPath = id => `/api/payroll-runs/${id}/exports`;
  const reconcilePath = id => `/api/payroll-runs/${id}/payout-reconciliation`;
  const ownExport = await request(exportPath(a.source.id) + '?kind=journal', a.maker.cookie);
  status(ownExport, 200, 'own nonempty journal export');
  check(ownExport.text.length > 30, 'own CSV contains real fixture rows');
  const reconciled = status(await request(reconcilePath(a.source.id), a.checker.cookie, 'POST', { action: 'reconcile' }), 200, 'own successful provider reconciliation');
  check(reconciled.organizationId === a.org.id && reconciled.runId === a.source.id && reconciled.reconciliation.succeeded === 1, 'reconciliation bound to own employer and exact one worker');
  for (const query of ['?kind=journal', '?kind=bank&dryRun=true', '?kind=bank&dryRun=false']) {
    await deniedNoProvider(v, a.maker, exportPath(v.source.id) + query, 'GET', undefined, 403, 'foreign export ' + query);
  }
  await deniedNoProvider(v, a.maker, exportPath(v.source.id), 'POST', { mode: 'preflight', organizationId: a.org.id }, 403, 'foreign payout preflight');
  await deniedNoProvider(v, a.checker, reconcilePath(v.source.id) + '?view=payout', 'GET', undefined, 403, 'foreign reconciliation read');
  for (const action of ['reconcile', 'retry-failed']) {
    await deniedNoProvider(v, a.checker, reconcilePath(v.source.id), 'POST', { action, confirm: true, organizationId: a.org.id }, 403, 'foreign reconciliation ' + action);
  }
  const units = await db.insert(s.orgUnits).values(['OWN', 'OTHER'].map(code => ({
    organizationId: a.org.id, legalEntityId: a.entity.id, type: 'department', name: code, code,
  }))).returning();
  await db.update(s.userOrganizations).set({ orgUnitId: units[0].id }).where(eq(s.userOrganizations.userId, a.maker.user.id));
  await db.update(s.payrollRuns).set({ scopeOrgUnitId: units[0].id }).where(eq(s.payrollRuns.id, a.source.id));
  status(await request(exportPath(a.source.id) + '?kind=journal', a.maker.cookie), 200, 'scoped operator own-unit journal');
  await db.update(s.payrollRuns).set({ scopeOrgUnitId: units[1].id }).where(eq(s.payrollRuns.id, a.source.id));
  await deniedNoProvider(a, a.maker, exportPath(a.source.id) + '?kind=journal', 'GET', undefined, 403, 'same-employer other-unit export');
  await deniedNoProvider(a, a.maker, reconcilePath(a.source.id), 'POST', { action: 'retry-failed', confirm: true }, 403, 'same-employer other-unit retry');
  await db.update(s.sessions).set({ mfaVerifiedAt: null }).where(eq(s.sessions.id, a.checker.session.id));
  await deniedNoProvider(a, a.checker, reconcilePath(a.source.id), 'POST', { action: 'reconcile' }, 403, 'missing MFA blocks provider lookup');
  await db.update(s.sessions).set({ mfaVerifiedAt: new Date() }).where(eq(s.sessions.id, a.checker.session.id));
  await db.update(s.userOrganizations).set({ active: false }).where(eq(s.userOrganizations.userId, a.checker.user.id));
  await deniedNoProvider(a, a.checker, reconcilePath(a.source.id), 'POST', { action: 'reconcile' }, 403, 'revoked membership retained session');
  await deniedNoProvider(a, a.employeeUser, exportPath(a.source.id) + '?kind=bank&dryRun=false', 'GET', undefined, 403, 'employee cannot obtain final bank file');
  successes.push({ organizationId: a.org.id, ownJournal: true, ownProviderReconcile: true });
}
try {
  process.env.PAYMONGO_SECRET_KEY = 'sk_test_synthetic_no_network';
  const nonce = randomUUID().slice(0, 8);
  const a = await seed('PM-B', nonce), b = await seed('PM-C', nonce);
  for (let i = 0; i < 7; i++) await seed('PM-PAD' + i, nonce);
  const v = await seed('PM-VICTIM', nonce);
  for (const actor of [a, b, v]) await providerFixture(actor);
  check(v.source.id > Math.max(a.source.id, b.source.id, 6), 'high-ID actual victim run');
  const initial = await snapshot(v);
  await investigate(v, a); await investigate(v, b);
  assert.deepEqual(await snapshot(v), initial, 'victim unchanged after complete investigation'); assertions++;
  await mkdir('outputs', { recursive: true });
  await writeFile('outputs/paymongo-export-local.json', JSON.stringify({ assertions, receipts, successes,
    providerCalls, status: 'PASS', transport: 'direct-handler-diagnosis-auth-adapter',
    scope: 'Local investigation only; no HTTP acceptance, provider writes or coverage credits' }, null, 2));
  console.log(`PayMongo/export local diagnosis PASS: ${assertions} assertions; ${receipts.length} denials; ${providerCalls.length} synthetic GETs.`);
} finally {
  globalThis.fetch = originalFetch;
  if (priorSecret === undefined) delete process.env.PAYMONGO_SECRET_KEY;
  else process.env.PAYMONGO_SECRET_KEY = priorSecret;
  await pool.end();
}
