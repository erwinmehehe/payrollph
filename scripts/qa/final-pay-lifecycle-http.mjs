/**
 * Final-pay route isolation proof; shared fictional fixture conventions from MNY-01. Fictional records only.
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
assert.notEqual(process.env.FINAL_PAY_MANUAL_RELEASE_ENABLED, 'true', 'This proof never enables manual settlement');
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
      [/^\/api\/separation$/, () => ["separation", {}]],
      [/^\/api\/approvals\/(\d+)$/, m => ["approvals/[id]", { id: m[1] }]],
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
    AND table_name ~ '^(payroll|payout|approval|audit|supplementary|loan|statutory|payslip|employee|holiday|separation|it_|hcm_|provisioning)'
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

async function createPackage(a, extra = {}) {
  const payload = { organizationId: a.org.id, employeeId: a.worker.id, separationType: "resignation", noticeDate: "2026-01-01", lastDay: "2026-01-31", ...extra };
  const initiated = await request("/api/separation", a.maker.cookie, "POST", payload);
  if (initiated.status === 202) {
    const hr = await login(a.org, a.label + "hr", randomUUID(), "hr");
    for (const actor of [hr, a.checker]) {
      const steps = await pool.query("SELECT approval_task_id FROM hcm_business_process_instance_steps WHERE instance_id=$1 AND status=$2", [initiated.json.businessProcess.id, "pending"]);
      check(steps.rows.length === 1, "one actual pending independent intent approval");
      status(await request(`/api/approvals/${steps.rows[0].approval_task_id}`, actor.cookie, "PATCH", { status: "Approved" }), 200, "independent separation intent approval");
    }
  } else status(initiated, 201, "own package creation");
  return status(await request('/api/separation', a.maker.cookie, 'POST', {
    organizationId: a.org.id, employeeId: a.worker.id, separationType: 'resignation',
    noticeDate: '2026-01-01', lastDay: '2026-01-31', ...extra,
  }), 201, 'own final pay computed from actual source ledger');
}
async function patch(a, actor, action, extra = {}) {
  return request('/api/separation', actor.cookie, 'PATCH', { id: a.sep.id, action, ...extra });
}
async function journey(v, a) {
  const rows = status(await request(`/api/separation?organizationId=${a.org.id}`, a.maker.cookie), 200, 'own nonempty separation list');
  check(rows.separations.some(r => r.id === a.sep.id) && rows.separations.every(r => r.organizationId === a.org.id), 'own package only');
  await deny(v, a.maker, `/api/separation?organizationId=${v.org.id}`, 'GET', undefined, 403, 'foreign separation list');
  const filtered = status(await request(`/api/separation?organizationId=${a.org.id}&employeeId=${v.worker.id}`, a.maker.cookie), 200, 'forged foreign worker filter');
  check(filtered.separations.length === 0, 'foreign worker cannot appear in own list');
  const body = { organizationId: a.org.id, employeeId: v.worker.id, noticeDate: '2026-01-01', lastDay: '2026-01-31' };
  await deny(v, a.maker, '/api/separation', 'POST', body, 422, 'foreign worker recomputation');
  await deny(v, a.maker, '/api/separation', 'POST', { ...body, organizationId: v.org.id }, 403, 'foreign employer recomputation');
  for (const action of ['clearance', 'approve', 'release', 'issue_coe', 'revoke_local_access', 'waive_clearance']) {
    await deny(v, a.maker, '/api/separation', 'PATCH', { id: v.sep.id, action, organizationId: a.org.id, employeeId: a.worker.id }, 403, `foreign package ${action}`);
  }
  await deny(a, a.employeeUser, '/api/separation', 'PATCH', { id: a.sep.id, action: 'approve' }, 403, 'employee cannot approve');
  await deny(a, a.employeeUser, `/api/separation?organizationId=${a.org.id}`, 'GET', undefined, 403, 'employee cannot list finance');
  for (const field of ['itCleared', 'adminCleared', 'financeCleared', 'hrCleared']) {
    const changed = status(await patch(a, a.checker, 'clearance', {
      [field]: true, previousValue: false, clearanceEvidenceReference: 'FICTIONAL-CLEARANCE-ONLY',
      clearanceReason: 'Disposable fixture has no outstanding items.',
    }), 200, `own ${field} clearance`);
    check(changed[field] === true, `${field} persisted`);
  }
  await deny(a, a.maker, '/api/separation', 'PATCH', { id: a.sep.id, action: 'approve' }, 409, 'maker cannot approve own final pay');
  await db.update(s.sessions).set({ mfaVerifiedAt: null }).where(eq(s.sessions.id, a.checker.session.id));
  const mfa = await patch(a, a.checker, 'approve');
  status(mfa, 403, 'final-pay approval requires recent MFA');
  check(mfa.json.code === 'MFA_REQUIRED', 'actual MFA gate reached');
  await db.update(s.sessions).set({ mfaVerifiedAt: new Date() }).where(eq(s.sessions.id, a.checker.session.id));
  const approved = status(await patch(a, a.checker, 'approve', { organizationId: v.org.id }), 200, 'independent approval ignores forged organization');
  check(approved.approvedByUserId === a.checker.user.id && approved.organizationId === a.org.id, 'independent SQL identity returned');
  const [stored] = await db.select().from(s.separationRecords).where(eq(s.separationRecords.id, a.sep.id));
  check(stored.status === 'approved' && stored.preparedByUserId === a.maker.user.id && stored.approvedByUserId === a.checker.user.id, 'SQL maker and checker preserved');
  const release = await patch(a, a.releaser, 'release', { releaseReference: 'FICTIONAL-NO-TRANSFER' });
  status(release, 409, 'uncertified manual release stays disabled');
  check(release.json.code === 'FINAL_PAY_MANUAL_RELEASE_NOT_CERTIFIED', 'release hold preserved');
  check((await db.select().from(s.separationRecords).where(eq(s.separationRecords.id, a.sep.id)))[0].releasedAt === null, 'no settlement falsely recorded');
  await db.update(s.userOrganizations).set({ active: false }).where(eq(s.userOrganizations.userId, a.maker.user.id));
  await deny(a, a.maker, `/api/separation?organizationId=${a.org.id}`, 'GET', undefined, 403, 'revoked member with retained session');
  successes.push({ organizationId: a.org.id, packageId: a.sep.id, create: true, list: true, clearance: true, independentApproval: true, releaseHeld: true });
}
try {
  const nonce = randomUUID().slice(0, 8);
  const a = await seed('FP-B', nonce), b = await seed('FP-C', nonce);
  for (let i = 0; i < 7; i++) {
    const padding = await seed('FP-PAD' + i, nonce);
    // Padding is fixture setup only; every compared own/victim package below
    // must be computed through the route and independent intent approvals.
    await db.insert(s.separationRecords).values({ organizationId: padding.org.id,
      employeeId: padding.worker.id, separationType: 'resignation',
      noticeDate: '2026-01-01', lastDay: '2026-01-31', preparedByUserId: padding.maker.user.id });
  }
  const v = await seed('FP-VICTIM', nonce);
  // The victim package is also created by the real endpoint, not a bare SQL shell.
  for (const actor of [a, b, v]) actor.sep = await createPackage(actor);
  check(v.sep.id > Math.max(a.sep.id, b.sep.id, 6), 'high-ID victim package');
  const before = await snapshot(v);
  await journey(v, a); await journey(v, b);
  assert.deepEqual(await snapshot(v), before, 'victim unchanged across both attackers'); assertions++;
  // Actual current-year taxable ledger produces tax collection greater than gross final pay.
  const short = await seed('FP-SHORT', nonce);
  await db.update(s.payrollRuns).set({ periodStart: '2026-01-01', periodEnd: '2026-01-15', grossPay: '1200000.00' }).where(eq(s.payrollRuns.id, short.source.id));
  await db.update(s.payrollEntries).set({ grossPay: '1200000.00', lineItems: [{ code: 'BASIC', amount: 1200000 }] }).where(eq(s.payrollEntries.payrollRunId, short.source.id));
  short.sep = await createPackage(short);
  check(Number(short.sep.taxAdjustment) < -Number(short.sep.grossFinalPay), 'tax collection exceeds final gross');
  check(Number(short.sep.netFinalPay) === 0 && Number(short.sep.computationSnapshot.unpaidMandatoryDeductions) > 0, 'liability retained while payable floors to zero');
  const shortBefore = await snapshot(short);
  const blocked = await patch(short, short.checker, 'approve');
  status(blocked, 409, 'shortfall cannot be approved');
  check(blocked.json.code === 'FINAL_PAY_MANDATORY_SHORTFALL_REVIEW_REQUIRED', 'executed shortfall gate');
  assert.deepEqual(await snapshot(short), shortBefore, 'shortfall approval changed no state'); assertions++;
  await mkdir('qa-artifacts', { recursive: true });
  await writeFile('qa-artifacts/final-pay-lifecycle.json', JSON.stringify({ head: process.env.PR_HEAD_SHA ?? null,
    assertions, receipts, successes, status: 'PASS', transport: direct ? 'direct-handler-diagnosis-auth-adapter' : 'real-http',
    scope: 'Final-pay computation, isolation, clearance and approval; manual release remains held; no provider acceptance' }, null, 2));
  console.log(`Final-pay lifecycle PASS: ${assertions} assertions, ${receipts.length} denied requests.`);
} finally { await pool.end(); }
