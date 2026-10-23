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
import { assertUnderpaymentProofTarget } from "./underpayment-proof-target.mjs";

assertUnderpaymentProofTarget(process.env);
const { db, pool } = await import("../../src/db/index.ts");
const s = await import("../../src/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { encryptBankAccount } = await import("../../src/lib/bank-account-crypto.ts");
const base = process.env.MONEY_PROOF_URL;
const receipts = [];
const successes = [];
const posting = process.env.PAYROLL_UNDERPAYMENT_POSTING_ENABLED === "true";
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
      [/^\/api\/payroll-runs\/(\d+)\/(process|submit-review|release|xendit-payout)$/, m => [`payroll-runs/[id]/${m[2]}`, { id: m[1] }]],
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
    lineItems: [{ code: "BASIC", label: "Basic pay", amount: 30000 }] });
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

const rationale = 'Fictional independent wage and tax review for disposable test only';
function review(a, id, action = 'approve') {
  return { organizationId: a.org.id, id, action, reviewReason: rationale,
    taxVerificationReference: 'SYNTHETIC-TAX-REVIEW' };
}
async function createClaim(a, extra = {}) {
  const r = status(await request('/api/payroll-underpayments', a.maker.cookie, 'POST', {
    organizationId: a.org.id, employeeId: a.worker.id, sourcePayrollRunId: a.source.id,
    effectiveDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()),
    amount: '234.56', reason: rationale, evidenceReference: 'FICTIONAL-SOURCE-ONLY', ...extra,
  }), 201, 'own correction requested');
  return r.request;
}
async function journey(v, a) {
  const original = await snapshot(v);
  const forgedRequest = { organizationId: a.org.id, employeeId: v.worker.id, sourcePayrollRunId: v.source.id,
    effectiveDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()),
    amount: '234.56', reason: rationale, evidenceReference: 'FICTIONAL-SOURCE-ONLY' };
  await deny(v, a.maker, '/api/payroll-underpayments', 'POST', forgedRequest, 404, 'foreign worker and source under own employer');
  await deny(v, a.maker, '/api/payroll-underpayments', 'POST', { ...forgedRequest, organizationId: v.org.id }, 403, 'foreign employer correction request');
  await deny(a, a.maker, '/api/payroll-underpayments', 'POST', {
    organizationId: a.org.id, employeeId: a.worker.id, sourcePayrollRunId: a.source.id,
    effectiveDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()),
    amount: '234.56', reason: rationale, evidenceReference: 'FICTIONAL-SOURCE-ONLY',
  }, 409, 'duplicate source request returns conflict without a second claim');
  await deny(v, a.checker, '/api/payroll-underpayments', 'PATCH', { ...review(a, v.claim.id), organizationId: v.org.id }, posting ? 403 : 409, 'foreign employer approval');
  await deny(v, a.checker, '/api/payroll-underpayments', 'PATCH', review(a, v.claim.id), posting ? 404 : 409, 'foreign claim forged own employer');
  await deny(a, a.maker, '/api/payroll-underpayments', 'PATCH', review(a, a.claim.id), 409, 'maker cannot post own correction');
  if (posting) {
    await db.update(s.sessions).set({ mfaVerifiedAt: null }).where(eq(s.sessions.id, a.checker.session.id));
    const mfa = await request('/api/payroll-underpayments', a.checker.cookie, 'PATCH', review(a, a.claim.id));
    status(mfa, 403, 'posting requires recent MFA'); check(mfa.json.code === 'MFA_REQUIRED', 'MFA gate reached');
    await db.update(s.sessions).set({ mfaVerifiedAt: new Date() }).where(eq(s.sessions.id, a.checker.session.id));
    const before = await db.select().from(s.supplementaryEarnings).where(eq(s.supplementaryEarnings.organizationId, a.org.id));
    const replies = await Promise.all([1, 2].map(() => request('/api/payroll-underpayments', a.checker.cookie, 'PATCH', review(a, a.claim.id))));
    assert.deepEqual(replies.map(r => r.status).sort(), [200, 409], 'overlapping approvals commit exactly once'); assertions++;
    const winner = replies.find(r => r.status === 200).json.request;
    const loser = replies.find(r => r.status === 409).json;
    check(loser.code === 'UNDERPAYMENT_ALREADY_DECIDED', 'locked loser is a decided request');
    const earnings = await db.select().from(s.supplementaryEarnings).where(eq(s.supplementaryEarnings.organizationId, a.org.id));
    check(earnings.length === before.length + 1, 'exactly one earning posted');
    const earning = earnings.find(r => r.id === winner.postedEarningId);
    check(earning.employeeId === a.worker.id && earning.amount === '234.56' && earning.taxable === true && earning.status === 'approved', 'exact cents and taxable worker identity');
    await deny(a, a.checker, '/api/payroll-underpayments', 'PATCH', review(a, a.claim.id), 409, 'sequential approval retry unchanged');
    await deny(a, a.checker, '/api/payroll-underpayments', 'PATCH', review(a, a.claim.id, 'reject'), 409, 'posted correction cannot be rejected');
    const [stored] = await db.select().from(s.payrollUnderpaymentRequests).where(eq(s.payrollUnderpaymentRequests.id, a.claim.id));
    check(stored.status === 'posted' && stored.reviewedByUserId === a.checker.user.id && stored.postedEarningId === earning.id, 'SQL independent reviewer and one ledger link');
  } else {
    const blocked = await request('/api/payroll-underpayments', a.checker.cookie, 'PATCH', review(a, a.claim.id));
    status(blocked, 409, 'posting off'); check(blocked.json.code === 'UNDERPAYMENT_POSTING_NOT_CERTIFIED', 'default-off hold');
    check((await db.select().from(s.supplementaryEarnings).where(eq(s.supplementaryEarnings.organizationId, a.org.id))).length === 0, 'off posts nothing');
  }
  const rejectionActor = await seed(a.label + '-REJECT', randomUUID().slice(0, 8));
  const reject = await createClaim(rejectionActor, { amount: '12.34' });
  const rejecting = rejectionActor.checker;
  const rejectionBody = review(rejectionActor, reject.id, 'reject');
  status(await request('/api/payroll-underpayments', rejecting.cookie, 'PATCH', rejectionBody), 200, 'own rejection succeeds');
  await deny(rejectionActor, rejecting, '/api/payroll-underpayments', 'PATCH', rejectionBody, 409, 'rejection retry unchanged');
  // Real route authorization must precede any provider operation. Live provider
  // flags/credentials are refused by the pre-import guard, including in CI.
  const payoutPath = id => `/api/payroll-runs/${id}/xendit-payout`;
  const own = status(await request(payoutPath(a.source.id), a.releaser.cookie), 200, 'own payout status readable');
  check(own.provider === 'xendit' && own.ledger === null, 'own empty provider ledger explicitly returned');
  await deny(v, a.releaser, payoutPath(v.source.id), 'GET', undefined, 403, 'foreign payout status');
  for (const action of ['preflight', 'submit', 'reconcile', 'resolve-unknown']) {
    await deny(v, a.releaser, payoutPath(v.source.id), 'POST', { action, confirm: true, organizationId: a.org.id }, 403, `foreign payout ${action}`);
  }
  await deny(a, a.employeeUser, payoutPath(a.source.id), 'POST', { action: 'submit', confirm: true }, 403, 'employee cannot submit payout');
  const payoutBefore = await snapshot(a);
  for (let i = 0; i < 2; i++) {
    status(await request(payoutPath(a.source.id), a.releaser.cookie, 'POST', { action: 'submit', confirm: true }), 409, 'provider-disabled submit retry');
  }
  assert.deepEqual(await snapshot(a), payoutBefore, 'disabled payout retry cannot create ledger or money'); assertions++;
  assert.deepEqual(await snapshot(v), original, 'whole journey victim unchanged'); assertions++;
  successes.push({ organizationId: a.org.id, correctionId: a.claim.id, posting, independentPost: posting,
    concurrentReview: posting, providerSubmission: false });
}
try {
  const nonce = randomUUID().slice(0, 8);
  const a = await seed('UP-B', nonce), b = await seed('UP-C', nonce);
  for (let i = 0; i < 7; i++) {
    const p = await seed('UP-PAD' + i, nonce); await createClaim(p);
  }
  const v = await seed('UP-VICTIM', nonce);
  for (const actor of [a, b, v]) actor.claim = await createClaim(actor);
  check(v.claim.id > Math.max(a.claim.id, b.claim.id, 6), 'actual high-ID victim correction');
  await journey(v, a); await journey(v, b);
  await mkdir('qa-artifacts', { recursive: true });
  await writeFile('qa-artifacts/underpayment-posting.json', JSON.stringify({ head: process.env.PR_HEAD_SHA ?? null,
    posting, assertions, receipts, successes, status: 'PASS',
    transport: direct ? 'direct-handler-diagnosis-auth-adapter' : 'real-http',
    scope: 'same-request approval retries and payout authorization; no provider settlement acceptance' }, null, 2));
  console.log(`Underpayment posting PASS: ${assertions} assertions, ${receipts.length} denied requests, posting=${posting}.`);
} finally { await pool.end(); }

