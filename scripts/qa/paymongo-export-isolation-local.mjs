/**
 * LOCAL direct-handler investigation with real disposable PostgreSQL.
 * Auth uses a fixture adapter; all provider calls are intercepted in memory.
 * No real HTTP acceptance, external requests, coverage credits or audit closure.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { assertPaymongoHttpProofTarget } from "./paymongo-http-proof-target.mjs";
import { assertMoneyProofTarget } from "./money-proof-target.mjs";

if (process.env.MONEY_PROOF_TRANSPORT === 'http') assertPaymongoHttpProofTarget(process.env);
else {
  assertMoneyProofTarget(process.env);
  assert.equal(process.env.MONEY_PROOF_TRANSPORT, 'direct-test-only');
}
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
      [/^\/api\/payroll-runs\/([^/]+)\/(exports|payout-reconciliation)$/, m => [`payroll-runs/[id]/${m[2]}`, { id: m[1] }]],
      [/^\/api\/approvals\/(\d+)$/, m => ["approvals/[id]", { id: m[1] }]],
      [/^\/api\/(payroll-earnings|payroll-underpayments|holidays)$/, m => [m[1], {}]],
    ];
    const pathname = new URL(path, base).pathname;
    const found = routes.map(([pattern, route]) => { const m = pattern.exec(pathname); return m ? route(m) : null; }).find(Boolean);
    assert.ok(found, "direct adapter allowlists only the reviewed money routes");
    const handler = require(`../../src/app/api/${found[0]}/route.ts`)[method];
    response = await handler(new Request(new URL(path, base), options), { params: Promise.resolve(found[1]) });
  } else response = await originalFetch(new URL(path, base), options);
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
const responseOverrides = new Map();
const originalFetch = globalThis.fetch;
const priorSecret = process.env.PAYMONGO_SECRET_KEY;
const priorEnabled = process.env.PAYMONGO_DISBURSEMENTS_ENABLED;
const priorWallet = process.env.PAYMONGO_WALLET_ID;
let retryFixture = null;
const syntheticProviderFetch = async (url, options) => {
  const method = options?.method ?? 'GET';
  providerCalls.push({ url: String(url), method });
  if (retryFixture) {
    if (String(url).startsWith('https://api.paymongo.com/v2/transfers/receiving_institutions?') && method === 'GET') {
      return Response.json({ data: [{ attributes: { name: 'BPI', bic: 'BOPIPHMM' } }] });
    }
    if (String(url) === 'https://api.paymongo.com/v2/wallets/wallet_synthetic' && method === 'GET') {
      return Response.json({ data: { id: 'wallet_synthetic', attributes: { status: 'active',
        balance: { available: 100000000, pending: 0 }, account: { account_number: '0000000001', account_name: 'Fictional Wallet' } } } });
    }
    if (String(url) === 'https://api.paymongo.com/v2/batch_transfers' && method === 'POST') {
      const payload = JSON.parse(options.body);
      assert.equal(payload.transfers.length, 1, 'Only the one confirmed-failed worker may be retried'); assertions++;
      assert.equal(payload.transfers[0].reference_number, `PAY-${retryFixture.actor.source.id}-${retryFixture.actor.worker.employeeNo}`); assertions++;
      assert.equal(payload.transfers[0].amount, 2800000); assertions++;
      assert.equal(payload.transfers[0].destination_account.number, '000000000001'); assertions++;
      retryFixture.posts.push(payload);
      if (retryFixture.timeout) {
        await new Promise(resolve => setTimeout(resolve, 100));
        throw new Error('Synthetic response lost after provider may have accepted retry');
      }
      if (retryFixture.overlap) await new Promise(resolve => setTimeout(resolve, 100));
      const originalBatch = batches.get('batch_tr_synthetic_' + retryFixture.actor.source.id);
      const failedTransfer = Array.isArray(originalBatch) ? originalBatch.find(row => row.status === 'failed') : originalBatch;
      batches.set('batch_tr_retry_' + retryFixture.actor.source.id, { ...failedTransfer, id: 'tr_retry_' + retryFixture.actor.source.id, status: 'pending' });
      return Response.json({ data: { id: 'batch_tr_retry_' + retryFixture.actor.source.id,
        transfers: [{ ...failedTransfer, status: 'pending' }] } });
    }
  }
  check(method === 'GET', 'Only the explicitly registered retry fixture may perform a synthetic POST');
  const batchId = String(url).replace('https://api.paymongo.com/v2/batch_transfers/', '');
  check(batches.has(batchId), 'Only an explicitly registered fictional provider read is allowed');
  const transferRows = batches.get(batchId);
  const body = { data: { id: batchId, transfers: Array.isArray(transferRows) ? transferRows : [transferRows] } };
  return Response.json(responseOverrides.has(batchId) ? responseOverrides.get(batchId)(body) : body);
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
  const forgedOwn = await request(exportPath(a.source.id) + `?kind=journal&organizationId=${v.org.id}&legalEntityId=${v.entity.id}&employeeId=${v.worker.id}`, a.maker.cookie);
  status(forgedOwn, 200, 'own export ignores forged foreign selectors');
  check(forgedOwn.text === ownExport.text && !forgedOwn.text.includes(v.worker.employeeNo), 'forged selectors cannot change export scope or bytes');
  for (const invalid of ['not-a-number', '1.5']) {
    await deniedNoProvider(v, a.maker, exportPath(invalid) + '?kind=journal', 'GET', undefined, 400, 'invalid export run ID');
    await deniedNoProvider(v, a.checker, reconcilePath(invalid), 'POST', { action: 'retry-failed', confirm: true }, 400, 'invalid reconciliation run ID');
  }
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
async function retryControls(a) {
  const batchId = 'batch_tr_synthetic_' + a.source.id;
  batches.get(batchId).status = 'failed';
  process.env.PAYMONGO_DISBURSEMENTS_ENABLED = 'true';
  process.env.PAYMONGO_WALLET_ID = 'wallet_synthetic';
  retryFixture = { actor: a, posts: [] };
  const path = `/api/payroll-runs/${a.source.id}/payout-reconciliation`;
  const body = { action: 'retry-failed', confirm: true };
  const missing = await request(path, a.checker.cookie, 'POST', body);
  status(missing, 409, 'retry requires preflight');
  check(retryFixture.posts.length === 0, 'missing preflight sends nothing');
  const [preflight] = await db.insert(s.auditEvents).values({ organizationId: a.org.id,
    actor: a.maker.user.name, action: 'PayMongo payroll preflight passed', resource: 'Fictional preflight',
    createdAt: new Date(Date.now() - 60_000), metadata: { runId: a.source.id } }).returning();
  const { createPayoutDestinationChangeRequest, decidePayoutDestinationChange } = await import('../../src/lib/payout-destination-controls.ts');
  await db.insert(s.treasuryControlPolicies).values({ organizationId: a.org.id, enabled: true });
  const change = await createPayoutDestinationChangeRequest({ organizationId: a.org.id, employeeId: a.worker.id,
    requestedByUserId: a.maker.user.id, requestedByName: a.maker.user.name,
    reason: 'Synthetic changed destination after preflight', replacementBankAccount: '000000000002', bankCode: 'BPI', mobile: null });
  await decidePayoutDestinationChange({ organizationId: a.org.id, requestId: change.id,
    decidedByUserId: a.checker.user.id, decidedByName: a.checker.user.name, decision: 'approve', decisionNote: 'Independent fixture review' });
  // Keep treasury authorization independent of this stale-source scenario:
  // restore the baseline policy after recording the actual approved change.
  await db.update(s.treasuryControlPolicies).set({ enabled: false }).where(eq(s.treasuryControlPolicies.organizationId, a.org.id));
  const stale = await request(path, a.checker.cookie, 'POST', body);
  status(stale, 502, 'changed destination blocks reconciliation before retry');
  check(stale.json.error.startsWith('PAYOUT_DESTINATION_CHANGED_AFTER_CALCULATION') && retryFixture.posts.length === 0, 'frozen destination guard blocks all sends');
  // Restore the original fixture destination before a separate fresh-preflight
  // retry case. Never rewrite the released instruction to satisfy the test.
  await db.update(s.employees).set({ bankAccount: encryptBankAccount('000000000001') }).where(eq(s.employees.id, a.worker.id));
  await db.insert(s.auditEvents).values({ organizationId: a.org.id, actor: a.maker.user.name,
    action: 'PayMongo payroll preflight passed', resource: 'New fictional preflight', metadata: { runId: a.source.id } });
  const retry = await request(path, a.checker.cookie, 'POST', body);
  status(retry, 200, 'fresh-preflight confirmed-failed transfer retry succeeds');
  check(retryFixture.posts.length === 1, 'one synthetic provider POST');
  const count = retryFixture.posts.length;
  status(await request(path, a.checker.cookie, 'POST', body), 409, 'repeating retry cannot resend');
  check(retryFixture.posts.length === count, 'retry replay sends nothing');
  successes.push({ organizationId: a.org.id, missingPreflightBlocked: true, stalePreflightBlocked: true,
    freshRetry: true, replayBlocked: true, syntheticPosts: count, priorPreflightId: preflight.id });
  retryFixture = null;
  process.env.PAYMONGO_DISBURSEMENTS_ENABLED = 'false';
}
async function overlappingRetry(a, timeout) {
  batches.get('batch_tr_synthetic_' + a.source.id).status = 'failed';
  process.env.PAYMONGO_DISBURSEMENTS_ENABLED = 'true';
  process.env.PAYMONGO_WALLET_ID = 'wallet_synthetic';
  retryFixture = { actor: a, posts: [], timeout, overlap: true };
  await db.insert(s.auditEvents).values({ organizationId: a.org.id, actor: a.maker.user.name,
    action: 'PayMongo payroll preflight passed', resource: 'Synthetic overlapping retry', metadata: { runId: a.source.id } });
  const path = `/api/payroll-runs/${a.source.id}/payout-reconciliation`;
  const body = { action: 'retry-failed', confirm: true };
  const responses = await Promise.all([1, 2].map(() => request(path, a.checker.cookie, 'POST', body)));
  assert.deepEqual(responses.map(r => r.status).sort(), timeout ? [409, 502] : [200, 409],
    'overlapping retry requests cannot both submit'); assertions++;
  check(retryFixture.posts.length === 1, 'overlapping requests produce one synthetic provider instruction');
  const receipts = await db.select().from(s.auditEvents).where(eq(s.auditEvents.organizationId, a.org.id));
  check(receipts.filter(e => e.action === 'Payroll payout retry submission initiated via PayMongo').length === 1, 'exactly one durable retry intent');
  if (timeout) {
    check(receipts.filter(e => e.action === 'Payroll payout retry outcome unknown').length === 1, 'lost response records unknown outcome');
    const unknown = receipts.find(e => e.action === 'Payroll payout retry outcome unknown');
    check(unknown.metadata.providerOutcomeUnknown === true && unknown.metadata.moneyMovedByLinaw === null,
      'unknown outcome is not represented as unpaid');
    const replay = await request(path, a.checker.cookie, 'POST', body);
    status(replay, 409, 'unknown retry requires investigation before resend');
    check(replay.json.error.includes('OUTCOME_UNVERIFIED'), 'explicit unresolved outcome receipt');
  } else {
    status(await request(path, a.checker.cookie, 'POST', body), 409, 'acknowledged retry cannot be replayed');
  }
  const providerCount = providerCalls.length;
  const bank = await request(`/api/payroll-runs/${a.source.id}/exports?kind=bank&dryRun=false`, a.maker.cookie);
  status(bank, 409, 'retry evidence blocks replacement final bank file');
  check(bank.json.code === 'PAYMONGO_PAYOUT_ALREADY_ATTEMPTED', 'cross-rail duplicate guard reached');
  check(providerCalls.length === providerCount && retryFixture.posts.length === 1, 'no fallback bank/provider send');
  successes.push({ organizationId: a.org.id, overlappingRetryOnce: true, timeout,
    resendBlocked: true, finalBankReplacementBlocked: true, syntheticPosts: 1 });
  retryFixture = null;
  process.env.PAYMONGO_DISBURSEMENTS_ENABLED = 'false';
}
async function mixedBatch(a) {
  const batchId = 'batch_tr_synthetic_' + a.source.id;
  const rows = [{ ...batches.get(batchId), status: 'failed' }];
  for (const state of ['succeeded', 'pending']) {
    const [worker] = await db.insert(s.employees).values({ organizationId: a.org.id, legalEntityId: a.entity.id,
      employeeNo: 'MIX-' + state, firstName: 'Fictional', lastName: state, title: 'Test worker',
      avatarInitials: 'FW', basicRate: '60000.00', startDate: '2025-01-01',
      bankCode: 'BPI', bankAccount: encryptBankAccount('000000000001') }).returning();
    await db.insert(s.employeePayProfiles).values({ organizationId: a.org.id, employeeId: worker.id,
      payBasis: 'monthly', rateAmount: '60000.00', standardWorkDaysPerMonth: '22.00', standardHoursPerDay: '8.00' });
    await db.insert(s.payrollEntries).values({ payrollRunId: a.source.id, employeeId: worker.id,
      grossPay: '30000.00', deductions: '2000.00', netPay: '28000.00',
      lineItems: [{ code: 'BASIC', amount: 30000 }, { code: 'WHT', amount: -2000 }],
      trace: { payment: { employeeName: worker.firstName + ' ' + worker.lastName,
        employeeNo: worker.employeeNo, bankAccount: worker.bankAccount, bankCode: worker.bankCode, mobile: worker.mobile } } });
    rows.push({ id: 'tr_' + state + '_' + a.source.id, reference_number: `PAY-${a.source.id}-${worker.employeeNo}`,
      amount: 2800000, provider: 'pesonet', status: state });
  }
  await db.update(s.payrollRuns).set({ employeeCount: 3, grossPay: '90000.00', netPay: '84000.00' }).where(eq(s.payrollRuns.id, a.source.id));
  batches.set(batchId, rows);
  retryFixture = { actor: a, posts: [] };
  process.env.PAYMONGO_DISBURSEMENTS_ENABLED = 'true';
  process.env.PAYMONGO_WALLET_ID = 'wallet_synthetic';
  await db.insert(s.auditEvents).values({ organizationId: a.org.id, actor: a.maker.user.name,
    action: 'PayMongo payroll preflight passed', resource: 'Synthetic mixed batch', metadata: { runId: a.source.id } });
  const response = await request(`/api/payroll-runs/${a.source.id}/payout-reconciliation`, a.checker.cookie,
    'POST', { action: 'retry-failed', confirm: true });
  const receipt = status(response, 200, 'mixed batch retries only confirmed failed worker');
  check(receipt.failedOnly === true && receipt.reconciliation.succeeded === 1 && receipt.reconciliation.pending === 1,
    'actual succeeded and pending rows were reconciled');
  check(retryFixture.posts.length === 1 && retryFixture.posts[0].transfers.length === 1, 'one transfer in one instruction');
  check(retryFixture.posts[0].transfers[0].reference_number === rows[0].reference_number,
    'pending and succeeded references never enter retry payload');
  successes.push({ organizationId: a.org.id, mixedStatuses: true, succeededExcluded: true, pendingExcluded: true });
  retryFixture = null;
  process.env.PAYMONGO_DISBURSEMENTS_ENABLED = 'false';
}
async function providerCorruption(a, victim) {
  const batchId = 'batch_tr_synthetic_' + a.source.id;
  const path = `/api/payroll-runs/${a.source.id}/payout-reconciliation`;
  const victimBefore = await snapshot(victim);
  const ownRegister = await db.select().from(s.payrollEntries).where(eq(s.payrollEntries.payrollRunId, a.source.id));
  const cases = [
    ['wrong-batch', p => ({ data: { ...p.data, id: 'batch_tr_other_employer' } })],
    ['victim-reference', p => ({ data: { ...p.data, transfers: [{ ...p.data.transfers[0],
      reference_number: `PAY-${victim.source.id}-${victim.worker.employeeNo}` }] } })],
    ['one-cent-mismatch', p => ({ data: { ...p.data, transfers: [{ ...p.data.transfers[0], amount: 2800001 }] } })],
    ['duplicate-transfer', p => ({ data: { ...p.data, transfers: [p.data.transfers[0], p.data.transfers[0]] } })],
    ['missing-transfer', p => ({ data: { ...p.data, transfers: [] } })],
    ['invalid-amount', p => ({ data: { ...p.data, transfers: [{ ...p.data.transfers[0], amount: 'bad' }] } })],
  ];
  const postCount = () => providerCalls.filter(c => c.method === 'POST').length;
  const priorPosts = postCount();
  for (const [label, transform] of cases) {
    responseOverrides.set(batchId, transform);
    // Separate fictional operators keep independent malformed-response cases
    // below the real per-user rate limit; no limiter state is erased.
    const reviewer = await login(a.org, label, randomUUID().slice(0, 8));
    for (const action of ['reconcile', 'retry-failed']) {
      const rejected = await request(path, reviewer.cookie, 'POST', { action, confirm: true });
      status(rejected, 502, label + ' blocks ' + action);
      check(postCount() === priorPosts, label + ' cannot initiate money movement');
      const audit = await db.select().from(s.auditEvents).where(eq(s.auditEvents.organizationId, a.org.id));
      check(audit.filter(e => e.action === 'Payroll payout completed via PayMongo').length === 0,
        label + ' cannot create a completed payout receipt');
      assert.deepEqual(await snapshot(victim), victimBefore, label + ' leaves victim unchanged'); assertions++;
      assert.deepEqual(await db.select().from(s.payrollEntries).where(eq(s.payrollEntries.payrollRunId, a.source.id)),
        ownRegister, label + ' leaves released register unchanged'); assertions++;
    }
  }
  responseOverrides.set(batchId, p => ({ data: { ...p.data, transfers: [{ ...p.data.transfers[0], status: 'unrecognized_provider_state' }] } }));
  const unknown = status(await request(path, a.checker.cookie, 'POST', { action: 'reconcile' }), 200, 'unknown provider state is explicitly unresolved');
  check(unknown.reconciliation.unknown === 1 && unknown.reconciliation.completed === false &&
    unknown.reconciliation.retryableReferences.length === 0, 'unknown is neither settled nor retryable');
  status(await request(path, a.checker.cookie, 'POST', { action: 'retry-failed', confirm: true }), 409, 'unknown transfer cannot be retried');
  check(postCount() === priorPosts, 'unknown status also makes no send');
  responseOverrides.delete(batchId);
  const valid = status(await request(path, a.checker.cookie, 'POST', { action: 'reconcile' }), 200, 'correct response recovers owned reconciliation');
  check(valid.organizationId === a.org.id && valid.runId === a.source.id && valid.reconciliation.completed === true,
    'recovery settles only the exact owned instruction');
  assert.deepEqual(await snapshot(victim), victimBefore, 'provider correction leaves victim unchanged'); assertions++;
  successes.push({ organizationId: a.org.id, malformedResponseCases: cases.map(c => c[0]),
    unknownNotRetryable: true, correctedReadRecovery: true, noProviderPosts: true });
}
async function crossRailClaim(a, victim) {
  await db.insert(s.payoutBatches).values({ organizationId: a.org.id, payrollRunId: a.source.id,
    provider: 'xendit', idempotencyKey: 'local-claim-' + a.source.id, requestHash: 'a'.repeat(64),
    transferCount: 1, totalAmountCents: 2800000, status: 'prepared' });
  const path = id => `/api/payroll-runs/${id}/exports`;
  for (const mode of ['preflight', 'disburse', 'complete-manual']) {
    const count = providerCalls.length;
    const before = await snapshot(a);
    const blocked = await request(path(a.source.id), a.checker.cookie, 'POST', { mode, confirm: true });
    status(blocked, 409, 'existing Xendit claim blocks PayMongo/manual ' + mode);
    check(blocked.json.code === 'XENDIT_PAYOUT_LEDGER_ALREADY_EXISTS', 'exact cross-rail claim guard');
    check(providerCalls.length === count, 'cross-rail rejection cannot reach provider');
    assert.deepEqual(await snapshot(a), before, 'blocked cross-rail operation changes no state'); assertions++;
    await deniedNoProvider(a, victim.checker, path(a.source.id), 'POST', { mode, confirm: true }, 403,
      'foreign actor cannot inspect claimed provider through ' + mode);
  }
  const before = await snapshot(a);
  const count = providerCalls.length;
  const bank = await request(path(a.source.id) + '?kind=bank&dryRun=false', a.checker.cookie);
  status(bank, 409, 'claimed run cannot issue final bank bytes');
  check(bank.json.code === 'PAYROLL_PAYOUT_LEDGER_ALREADY_CLAIMED', 'bank claim guard');
  check(providerCalls.length === count, 'bank claim refusal cannot query provider');
  assert.deepEqual(await snapshot(a), before, 'bank refusal leaves claim unchanged'); assertions++;
  status(await request(path(a.source.id) + '?kind=journal', a.maker.cookie), 200, 'existing claim does not block owned accounting journal');
  successes.push({ organizationId: a.org.id, crossRailClaimBlocksProviderAndManual: true, finalBankRefused: true,
    claimNotDisclosedToForeignActor: true, ownedJournalRemainsAvailable: true });
}
let providerServer;
if (direct) globalThis.fetch = syntheticProviderFetch;
else {
  providerServer = createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, 'Basic ' + Buffer.from('sk_test_synthetic_no_network:').toString('base64'));
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        assert.ok(body.length <= 1_000_000, 'Synthetic provider request body limit');
      }
      const reply = await syntheticProviderFetch('https://api.paymongo.com' + req.url,
        { method: req.method, body: body || undefined, headers: req.headers });
      res.writeHead(reply.status, Object.fromEntries(reply.headers));
      res.end(await reply.text());
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ errors: [{ detail: error.message }] }));
    }
  });
  await new Promise((resolve, reject) => {
    providerServer.once('error', reject);
    providerServer.listen(3012, '127.0.0.1', resolve);
  });
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
  for (const label of ['PM-RETRY-B', 'PM-RETRY-C']) {
    const actor = await seed(label, nonce); await providerFixture(actor); await retryControls(actor);
  }
  for (const timeout of [false, true]) {
    for (const index of ['B', 'C']) {
      const actor = await seed('PM-RACE-' + index, randomUUID().slice(0, 8));
      await providerFixture(actor); await overlappingRetry(actor, timeout);
    }
  }
  for (const label of ['PM-MIX-B', 'PM-MIX-C']) {
    const actor = await seed(label, nonce); await providerFixture(actor); await mixedBatch(actor);
  }
  for (const label of ['PM-BAD-B', 'PM-BAD-C']) {
    const actor = await seed(label, nonce); await providerFixture(actor); await providerCorruption(actor, v);
  }
  for (const label of ['PM-RAIL-B', 'PM-RAIL-C']) {
    const actor = await seed(label, nonce); await crossRailClaim(actor, v);
  }
  assert.deepEqual(await snapshot(v), initial, 'victim unchanged after complete investigation'); assertions++;
  await mkdir('outputs', { recursive: true });
  await writeFile('outputs/paymongo-export-local.json', JSON.stringify({ assertions, receipts, successes,
    providerCalls, status: 'PASS', transport: direct ? 'direct-handler-diagnosis-auth-adapter' : 'real-http',
    scope: 'Local investigation only; all provider GET/POST intercepted; no HTTP acceptance, external calls or coverage credits' }, null, 2));
  console.log(`PayMongo/export local diagnosis PASS: ${assertions} assertions; ${receipts.length} denials; ${providerCalls.filter(c => c.method === 'GET').length} synthetic GETs; ${providerCalls.filter(c => c.method === 'POST').length} synthetic POSTs.`);
} finally {
  globalThis.fetch = originalFetch;
  if (priorSecret === undefined) delete process.env.PAYMONGO_SECRET_KEY;
  else process.env.PAYMONGO_SECRET_KEY = priorSecret;
  if (priorEnabled === undefined) delete process.env.PAYMONGO_DISBURSEMENTS_ENABLED;
  else process.env.PAYMONGO_DISBURSEMENTS_ENABLED = priorEnabled;
  if (priorWallet === undefined) delete process.env.PAYMONGO_WALLET_ID;
  else process.env.PAYMONGO_WALLET_ID = priorWallet;
  if (providerServer) await new Promise(resolve => providerServer.close(resolve));
  await pool.end();
}
