/**
 * Treasury tenant isolation proof. Fictional records only.
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
      [/^\/api\/(treasury-controls|payout-profiles|payout-destination-changes)$/, m => [m[1], {}]],
      [/^\/api\/payout-destination-changes\/(\d+)$/, m => ["payout-destination-changes/[id]", { id: m[1] }]],
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
  for (const rawAccount of ['000000000001', '000000000002', '000000000003']) {
    check(!text.includes(rawAccount), 'HTTP response must not expose a full fictional bank account');
  }
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
    AND table_name ~ '^(payroll|payout|approval|audit|supplementary|loan|statutory|payslip|employee|holiday|treasury|legal_entit)'
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

async function setup(a) {
  status(await request('/api/treasury-controls', a.maker.cookie, 'POST', {
    organizationId: a.org.id, action: 'save-policy', enabled: true,
    requireReleaseSubmitterSeparation: true, operatorUserIds: [a.checker.user.id],
  }), 200, 'own treasury policy and independent operator configured');
  const { createPayoutDestinationChangeRequest } = await import('../../src/lib/payout-destination-controls.ts');
  a.change = await createPayoutDestinationChangeRequest({ organizationId: a.org.id, employeeId: a.worker.id,
    requestedByUserId: a.maker.user.id, requestedByName: a.maker.user.name,
    reason: 'Fictional verified bank change for disposable isolation test',
    replacementBankAccount: '000000000002', bankCode: 'BPI', mobile: null });
  check(a.change !== null, 'actual pending destination change persisted');
}
async function journey(v, a) {
  const victimBefore = await snapshot(v);
  const controls = status(await request(`/api/treasury-controls?organizationId=${a.org.id}`, a.maker.cookie), 200, 'own treasury controls');
  check(controls.operatorUserIds.includes(a.checker.user.id) && !controls.operatorUserIds.includes(v.checker.user.id), 'only own assigned operator');
  await deny(v, a.maker, `/api/treasury-controls?organizationId=${v.org.id}`, 'GET', undefined, 403, 'foreign treasury read');
  await deny(v, a.maker, '/api/treasury-controls', 'POST', { organizationId: v.org.id, action: 'save-policy', enabled: false }, 403, 'foreign treasury configuration');
  await deny(a, a.maker, '/api/treasury-controls', 'POST', { organizationId: a.org.id, action: 'save-policy', enabled: true,
    operatorUserIds: [v.checker.user.id] }, 400, 'foreign operator cannot receive own authority');
  const profile = status(await request('/api/payout-profiles', a.maker.cookie, 'PATCH', {
    organizationId: a.org.id, legalEntityId: a.entity.id, defaultMethod: 'manual', active: false,
    remarks: 'FICTIONAL-PROFILE-' + a.label,
  }), 200, 'own inactive payout profile saved');
  check(Boolean(profile), 'own profile response');
  const profiles = status(await request(`/api/payout-profiles?organizationId=${a.org.id}`, a.maker.cookie), 200, 'own payout profiles read');
  check(profiles.profiles.some(r => r.legalEntity.id === a.entity.id), 'nonempty own profile');
  await deny(v, a.maker, `/api/payout-profiles?organizationId=${v.org.id}`, 'GET', undefined, 403, 'foreign profiles');
  await deny(v, a.maker, '/api/payout-profiles', 'PATCH', { organizationId: a.org.id, legalEntityId: v.entity.id }, 404, 'foreign entity with own employer');
  await deny(v, a.maker, '/api/payout-profiles', 'PATCH', { organizationId: v.org.id, legalEntityId: v.entity.id }, 403, 'foreign profile write');
  const changes = status(await request(`/api/payout-destination-changes?organizationId=${a.org.id}&employeeId=${a.worker.id}`, a.maker.cookie), 200, 'own populated destination history');
  check(changes.requests.some(r => r.id === a.change.id) && changes.requests.every(r => r.organizationId === a.org.id), 'only own destination requests');
  await deny(v, a.maker, `/api/payout-destination-changes?organizationId=${v.org.id}`, 'GET', undefined, 403, 'foreign destination history');
  await deny(v, a.maker, `/api/payout-destination-changes?organizationId=${a.org.id}&employeeId=${v.worker.id}`, 'GET', undefined, 404, 'foreign worker history filter');
  const decide = (id, org) => ({ organizationId: org, decision: 'approve', decisionNote: 'Disposable independently verified bank evidence' });
  await deny(v, a.checker, `/api/payout-destination-changes/${v.change.id}`, 'PATCH', decide(v.change.id, a.org.id), 404, 'foreign change forged own employer');
  await deny(v, a.checker, `/api/payout-destination-changes/${v.change.id}`, 'PATCH', decide(v.change.id, v.org.id), 403, 'foreign change decision');
  await deny(a, a.maker, `/api/payout-destination-changes/${a.change.id}`, 'PATCH', decide(a.change.id, a.org.id), 403, 'unassigned maker cannot decide');
  status(await request('/api/treasury-controls', a.maker.cookie, 'POST', {
    organizationId: a.org.id, action: 'save-policy', enabled: true,
    operatorUserIds: [a.maker.user.id, a.checker.user.id],
  }), 200, 'own maker assigned treasury authority for self-review negative control');
  await deny(a, a.maker, `/api/payout-destination-changes/${a.change.id}`, 'PATCH', decide(a.change.id, a.org.id), 403, 'assigned treasury maker still cannot approve own bank change');
  await db.update(s.sessions).set({ mfaVerifiedAt: null }).where(eq(s.sessions.id, a.checker.session.id));
  await deny(a, a.checker, `/api/payout-destination-changes/${a.change.id}`, 'PATCH', decide(a.change.id, a.org.id), 403, 'destination decision requires MFA');
  await db.update(s.sessions).set({ mfaVerifiedAt: new Date() }).where(eq(s.sessions.id, a.checker.session.id));
  status(await request(`/api/payout-destination-changes/${a.change.id}`, a.checker.cookie, 'PATCH', decide(a.change.id, a.org.id)), 200, 'independent own destination approved');
  const { decryptBankAccount } = await import('../../src/lib/bank-account-crypto.ts');
  const [worker] = await db.select().from(s.employees).where(eq(s.employees.id, a.worker.id));
  check(decryptBankAccount(worker.bankAccount) === '000000000002', 'SQL confirms own encrypted destination applied');
  await deny(a, a.checker, `/api/payout-destination-changes/${a.change.id}`, 'PATCH', decide(a.change.id, a.org.id), 409, 'decision replay unchanged');
  const path = id => `/api/payroll-runs/${id}/xendit-payout`;
  status(await request(path(a.source.id), a.checker.cookie), 200, 'own treasury payout status');
  await deny(v, a.checker, path(v.source.id), 'GET', undefined, 403, 'foreign payout status');
  for (const action of ['preflight', 'submit', 'reconcile', 'resolve-unknown']) {
    await deny(v, a.checker, path(v.source.id), 'POST', { action, confirm: true }, 403, 'foreign payout ' + action);
    await deny(a, a.checker, path(a.source.id), 'POST', { action, confirm: true }, 409, 'own provider-disabled payout ' + action);
  }
  await deny(a, a.employeeUser, '/api/payout-profiles', 'PATCH', {
    organizationId: a.org.id, legalEntityId: a.entity.id, defaultMethod: 'manual',
  }, 403, 'employee cannot edit payout profile');
  await deny(a, a.employeeUser, '/api/treasury-controls', 'POST', {
    organizationId: a.org.id, action: 'save-policy', enabled: false,
  }, 403, 'employee cannot disable treasury separation');
  await db.update(s.treasuryOperatorAssignments).set({ active: false }).where(eq(s.treasuryOperatorAssignments.userId, a.checker.user.id));
  await deny(a, a.checker, path(a.source.id), 'GET', undefined, 403, 'revoked treasury assignment retained session');
  await deny(a, a.employeeUser, `/api/treasury-controls?organizationId=${a.org.id}`, 'GET', undefined, 403, 'employee cannot inspect treasury candidates');
  assert.deepEqual(await snapshot(v), victimBefore, 'whole attacker journey leaves victim unchanged'); assertions++;
  successes.push({ organizationId: a.org.id, independentDestinationApproval: true,
    profileWrite: true, policyWrite: true, payoutStatus: true, providerSend: false });
}
async function extendedControls(a) {
  // A fresh employer keeps concurrency/rate-limit fixtures independent of the
  // ordinary journey and leaves the original victim entirely untouched.
  const decisionPath = `/api/payout-destination-changes/${a.change.id}`;
  const decision = { organizationId: a.org.id, decision: 'approve', decisionNote: 'Independent synthetic bank review' };
  const replies = await Promise.all([1, 2].map(() => request(decisionPath, a.checker.cookie, 'PATCH', decision)));
  assert.deepEqual(replies.map(r => r.status).sort(), [200, 409], 'overlapping decisions apply exactly once'); assertions++;
  const audit = await db.select().from(s.auditEvents).where(eq(s.auditEvents.organizationId, a.org.id));
  check(audit.filter(row => row.action === 'Employee payout destination change approved').length === 1, 'one committed approval audit');
  const { createPayoutDestinationChangeRequest } = await import('../../src/lib/payout-destination-controls.ts');
  const stale = await createPayoutDestinationChangeRequest({ organizationId: a.org.id, employeeId: a.worker.id,
    requestedByUserId: a.maker.user.id, requestedByName: a.maker.user.name,
    reason: 'Synthetic pending destination to test source staleness', replacementBankAccount: '000000000001', bankCode: 'BPI', mobile: null });
  await db.update(s.employees).set({ bankAccount: encryptBankAccount('000000000003') }).where(eq(s.employees.id, a.worker.id));
  const workerBefore = (await db.select().from(s.employees).where(eq(s.employees.id, a.worker.id)))[0];
  const staleResponse = await request(`/api/payout-destination-changes/${stale.id}`, a.checker.cookie, 'PATCH', decision);
  status(staleResponse, 409, 'stale source cannot be approved');
  check(staleResponse.json.request.status === 'cancelled', 'stale request explicitly cancelled');
  assert.deepEqual((await db.select().from(s.employees).where(eq(s.employees.id, a.worker.id)))[0], workerBefore, 'stale cancellation preserves current bank destination'); assertions++;
  const units = await db.insert(s.orgUnits).values(['OWN', 'OTHER'].map(code => ({
    organizationId: a.org.id, legalEntityId: a.entity.id, type: 'department', name: code, code,
  }))).returning();
  const scoped = await login(a.org, 'scoped-admin', randomUUID().slice(0, 8), 'admin');
  await db.update(s.userOrganizations).set({ orgUnitId: units[0].id }).where(eq(s.userOrganizations.userId, scoped.user.id));
  await db.update(s.employees).set({ orgUnitId: units[0].id }).where(eq(s.employees.id, a.worker.id));
  const ownHistory = status(await request(`/api/payout-destination-changes?organizationId=${a.org.id}&employeeId=${a.worker.id}`, scoped.cookie), 200, 'scoped admin nonempty own-unit history');
  check(ownHistory.requests.some(row => row.id === a.change.id), 'scoped own-unit positive');
  await db.update(s.employees).set({ orgUnitId: units[1].id }).where(eq(s.employees.id, a.worker.id));
  await deny(a, scoped, `/api/payout-destination-changes?organizationId=${a.org.id}&employeeId=${a.worker.id}`, 'GET', undefined, 403, 'same-employer foreign-unit history denied');
  await deny(a, scoped, `/api/payout-destination-changes?organizationId=${a.org.id}`, 'GET', undefined, 403, 'scoped admin cannot list company-wide bank history');
  await deny(a, scoped, `/api/treasury-controls?organizationId=${a.org.id}`, 'GET', undefined, 403, 'scoped admin cannot read company treasury authority');
  await deny(a, scoped, '/api/payout-profiles', 'PATCH', { organizationId: a.org.id, legalEntityId: a.entity.id }, 403, 'scoped admin cannot configure company payout profile');
  successes.push({ organizationId: a.org.id, concurrentDecisionOnce: true, staleSourceCancelled: true,
    scopedUnitPositiveAndDenial: true, fullAccountRedaction: true });
}
try {
  const nonce = randomUUID().slice(0, 8);
  const a = await seed('TR-B', nonce), b = await seed('TR-C', nonce);
  await setup(a); await setup(b);
  for (let i = 0; i < 7; i++) await setup(await seed('TR-PAD' + i, nonce));
  const v = await seed('TR-VICTIM', nonce); await setup(v);
  check(v.change.id > Math.max(a.change.id, b.change.id, 6), 'actual high-ID victim destination request');
  await journey(v, a); await journey(v, b);
  for (const label of ['TR-EX-B', 'TR-EX-C']) {
    const extra = await seed(label, nonce); await setup(extra); await extendedControls(extra);
  }
  await mkdir('qa-artifacts', { recursive: true });
  await writeFile('qa-artifacts/treasury-isolation.json', JSON.stringify({ head: process.env.PR_HEAD_SHA ?? null,
    assertions, receipts, successes, status: 'PASS', transport: direct ? 'direct-handler-diagnosis-auth-adapter' : 'real-http',
    scope: 'treasury policy/profile/destination authorization; provider operations remain disabled, no settlement certification' }, null, 2));
  console.log(`Treasury isolation PASS: ${assertions} assertions, ${receipts.length} denied requests.`);
} finally { await pool.end(); }
