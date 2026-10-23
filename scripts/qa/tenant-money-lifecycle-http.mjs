/**
 * MNY-01 payroll lifecycle and correction proof. Fictional records only.
 * Own successes, real victim IDs, forged selectors and unchanged-victim SQL
 * snapshots are executed over real HTTP. No provider is configured or called.
 * This is a partial MNY-01 implementation, never closure of its 33-method queue.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { assertMoneyProofTarget } from "./money-proof-target.mjs";

assertMoneyProofTarget(process.env);
const { db, pool } = await import("../../src/db/index.ts");
const s = await import("../../src/db/schema.ts");
const { eq } = await import("drizzle-orm");
const { encryptBankAccount } = await import("../../src/lib/bank-account-crypto.ts");
const base = process.env.MONEY_PROOF_URL;
const receipts = [];
const successes = [];
const exactLinks = process.env.EXACT_PAYROLL_APPROVAL_LINKS_ENABLED === "true";
let assertions = 0;
function check(condition, label) { assert.ok(condition, label); assertions++; }
async function request(path, cookie, method = "GET", body) {
  const response = await fetch(new URL(path, base), { method, redirect: "manual", cache: "no-store",
    headers: { cookie, origin: base, "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
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
async function corrections(v, a, effectiveDate) {
  const earning = { organizationId: a.org.id, employeeId: a.worker.id, earningType: "commission",
    label: "Fictional commission", amount: 123.45, effectiveDate };
  const own = a.earning;
  check(own.organizationId === a.org.id && own.employeeId === a.worker.id && own.amount === "123.45", "own earning persisted identity/centavos");
  const rows = status(await request(`/api/payroll-earnings?organizationId=${a.org.id}&employeeId=${v.worker.id}`, a.maker.cookie), 200, "own earnings forged employee selector ignored");
  check(rows.earnings.some(x => x.id === own.id) && rows.earnings.every(x => x.organizationId === a.org.id && x.employeeId !== v.worker.id), "nonempty own earnings only");
  await deny(v, a.maker, `/api/payroll-earnings?organizationId=${v.org.id}`, "GET", undefined, 403, "foreign earnings read");
  await deny(v, a.maker, "/api/payroll-earnings", "POST", { ...earning, organizationId: v.org.id, employeeId: v.worker.id }, 403, "foreign earning organization");
  await deny(v, a.maker, "/api/payroll-earnings", "POST", { ...earning, employeeId: v.worker.id }, 404, "forged earning worker");
  await deny(v, a.maker, "/api/payroll-earnings", "PATCH", { id: v.earning.id, organizationId: a.org.id }, 403, "foreign earning id with forged own organization");
  const voided = status(await request("/api/payroll-earnings", a.maker.cookie, "PATCH", { id: own.id, organizationId: v.org.id }), 200, "own earning void ignores forged organization");
  check(voided.id === own.id && voided.organizationId === a.org.id && voided.status === "void", "own earning void persisted");
  check((await db.select().from(s.supplementaryEarnings).where(eq(s.supplementaryEarnings.id, own.id)))[0].status === "void", "SQL confirms own void");
  const claim = { organizationId: a.org.id, employeeId: a.worker.id, sourcePayrollRunId: a.source.id,
    effectiveDate, amount: "234.56", reason: "Fictional independently reviewed basic-pay shortfall", evidenceReference: "MNY01-SYNTHETIC-REFERENCE" };
  const pending = a.claim;
  check(pending.organizationId === a.org.id && pending.employeeId === a.worker.id && pending.amount === "234.56", "own correction identity and centavos");
  const list = status(await request(`/api/payroll-underpayments?organizationId=${a.org.id}&sourcePayrollRunId=${v.source.id}`, a.maker.cookie), 200, "own underpayment read ignores forged source");
  check(list.requests.some(x => x.id === pending.id) && list.requests.every(x => x.organizationId === a.org.id), "nonempty own corrections only");
  await deny(v, a.maker, `/api/payroll-underpayments?organizationId=${v.org.id}`, "GET", undefined, 403, "foreign underpayment read");
  await deny(v, a.maker, "/api/payroll-underpayments", "POST", { ...claim, organizationId: v.org.id, employeeId: v.worker.id, sourcePayrollRunId: v.source.id }, 403, "foreign correction organization");
  await deny(v, a.maker, "/api/payroll-underpayments", "POST", { ...claim, employeeId: v.worker.id }, 404, "forged correction worker");
  await deny(v, a.maker, "/api/payroll-underpayments", "POST", { ...claim, sourcePayrollRunId: v.source.id }, 404, "forged correction source run");
  const decision = { id: pending.id, organizationId: a.org.id, action: "reject", reviewReason: "Fictional independent review rejects unsupported correction" };
  const ownBeforeDisabledPosting = await snapshot(a);
  const disabledPosting = status(await request("/api/payroll-underpayments", a.checker.cookie, "PATCH", {
    ...decision, action: "approve", taxVerificationReference: "SYNTHETIC-NOT-ACCEPTANCE" }), 409, "underpayment posting remains default-off");
  check(disabledPosting.code === "UNDERPAYMENT_POSTING_NOT_CERTIFIED", "posting disabled by existing gate");
  assert.deepEqual(await snapshot(a), ownBeforeDisabledPosting, "disabled posting does not change money state"); assertions++;
  const selfDecision = status(await request("/api/payroll-underpayments", a.maker.cookie, "PATCH", decision), 409, "maker cannot review own correction");
  check(selfDecision.code === "UNDERPAYMENT_SELF_REVIEW", "self-review blocked by maker-checker");
  check((await db.select().from(s.payrollUnderpaymentRequests).where(eq(s.payrollUnderpaymentRequests.id, pending.id)))[0].status === "pending_review", "self-review leaves pending correction unchanged");
  await deny(v, a.checker, "/api/payroll-underpayments", "PATCH", { ...decision, id: v.claim.id }, 404, "foreign correction id forged own organization");
  await deny(v, a.checker, "/api/payroll-underpayments", "PATCH", { ...decision, id: v.claim.id, organizationId: v.org.id }, 403, "foreign correction organization review");
  const reviewed = status(await request("/api/payroll-underpayments", a.checker.cookie, "PATCH", decision), 200, "own independent correction rejection");
  check(reviewed.request?.id === pending.id && reviewed.request?.status === "rejected", "independent correction decision persisted");
  check((await db.select().from(s.payrollUnderpaymentRequests).where(eq(s.payrollUnderpaymentRequests.id, pending.id)))[0].status === "rejected", "SQL confirms correction rejection");
  for (const path of ["/api/payroll-earnings", "/api/payroll-underpayments"]) {
    status(await request(`${path}?organizationId=${a.org.id}`, a.employeeUser.cookie), 403, "employee cannot read payroll adjustments");
  }
  for (const route of ["payroll-earnings", "payroll-underpayments"]) {
    for (const method of ["GET", "POST", "PATCH"]) successes.push({ route, method,
      organizationId: a.org.id, objectId: route === "payroll-earnings" ? own.id : pending.id,
      ownSuccess: true, forgedSelectorExercised: true });
  }
}
async function seedAdjustments(t, effectiveDate) {
  t.holiday = status(await request("/api/holidays", t.maker.cookie, "POST", { organizationId: t.org.id,
    holidayDate: "2027-04-05", name: `Fictional ${t.label} holiday`, kind: "special" }), 201, "own holiday create");
  t.earning = status(await request("/api/payroll-earnings", t.maker.cookie, "POST", { organizationId: t.org.id, employeeId: t.worker.id,
    earningType: "commission", label: `Fictional ${t.label} commission`, amount: 123.45, effectiveDate }), 201, "own earning create");
  t.claim = status(await request("/api/payroll-underpayments", t.maker.cookie, "POST", { organizationId: t.org.id, employeeId: t.worker.id,
    sourcePayrollRunId: t.source.id, effectiveDate, amount: "234.56", reason: "Fictional independently reviewed basic-pay shortfall",
    evidenceReference: "MNY01-SYNTHETIC-REFERENCE" }), 201, "own underpayment request").request;
  check((await db.select().from(s.supplementaryEarnings).where(eq(s.supplementaryEarnings.id, t.earning.id)))[0].employeeId === t.worker.id,
    "SQL confirms earning belongs to own worker");
  check((await db.select().from(s.payrollUnderpaymentRequests).where(eq(s.payrollUnderpaymentRequests.id, t.claim.id)))[0].sourcePayrollRunId === t.source.id,
    "SQL confirms correction refers to own source");
}
async function holidays(v, a) {
  const own = status(await request(`/api/holidays?organizationId=${a.org.id}&id=${v.holiday.id}`, a.maker.cookie), 200, "own holiday read ignores forged object selector");
  check(own.holidays.some(x => x.id === a.holiday.id) && own.holidays.every(x => x.organizationId === a.org.id), "nonempty own holiday scope");
  await deny(v, a.maker, `/api/holidays?organizationId=${v.org.id}`, "GET", undefined, 403, "foreign holiday read");
  await deny(v, a.maker, "/api/holidays", "POST", { organizationId: v.org.id, holidayDate: "2027-04-06", name: "Forged holiday", kind: "special" }, 403, "foreign holiday create");
  await deny(v, a.maker, "/api/holidays", "PATCH", { id: v.holiday.id, organizationId: a.org.id, name: "Forged victim update" }, 403, "foreign holiday update forged own organization");
  await deny(v, a.maker, `/api/holidays?id=${v.holiday.id}&organizationId=${a.org.id}`, "DELETE", undefined, 403, "foreign holiday delete forged own organization");
  const changed = status(await request("/api/holidays", a.maker.cookie, "PATCH", { id: a.holiday.id, organizationId: v.org.id, name: "Updated own fictional holiday" }), 200, "own holiday update ignores forged organization");
  check(changed.id === a.holiday.id && changed.organizationId === a.org.id && changed.name === "Updated own fictional holiday", "updated own holiday");
  check((await db.select().from(s.holidays).where(eq(s.holidays.id, a.holiday.id)))[0].name === changed.name, "SQL confirms holiday update");
  status(await request(`/api/holidays?id=${a.holiday.id}&organizationId=${v.org.id}`, a.maker.cookie, "DELETE"), 200, "own holiday delete ignores forged organization");
  check((await db.select().from(s.holidays).where(eq(s.holidays.id, a.holiday.id))).length === 0, "SQL confirms only own holiday deleted");
  for (const method of ["GET", "POST", "PATCH", "DELETE"]) successes.push({ route: "holidays", method,
    organizationId: a.org.id, objectId: a.holiday.id, ownSuccess: true, forgedSelectorExercised: true });
}
async function earningInvalidation(a) {
  const [target] = await db.insert(s.payrollRuns).values({ organizationId: a.org.id, legalEntityId: a.entity.id,
    periodLabel: "Fictional earning invalidation", periodStart: "2027-01-01", periodEnd: "2027-01-15",
    payDate: "2027-01-16", status: "Processed", employeeCount: 1, processedChunks: 1, totalChunks: 1 }).returning();
  const [unrelated] = await db.insert(s.payrollRuns).values({ id: Number(String(target.id) + "88888"),
    organizationId: a.org.id, legalEntityId: a.entity.id, periodLabel: "Unrelated earning prefix",
    periodStart: "2027-02-01", periodEnd: "2027-02-15", payDate: "2027-02-16", status: "Processed" }).returning();
  const tasks = await db.insert(s.approvalTasks).values([target, unrelated].map(r => ({ organizationId: a.org.id,
    payrollRunId: r.id, title: "Fictional earning review", detail: `Payroll run #${r.id}`,
    approver: a.checker.user.name, dueLabel: "Synthetic" }))).returning();
  const beforeUnrelated = (await db.select().from(s.payrollRuns).where(eq(s.payrollRuns.id, unrelated.id)))[0];
  for (const method of ["POST", "PATCH"]) {
    await db.insert(s.payrollEntries).values({ payrollRunId: target.id, employeeId: a.worker.id,
      grossPay: "100.00", deductions: "0.00", netPay: "100.00" });
    let result;
    if (method === "POST") {
      result = status(await request("/api/payroll-earnings", a.maker.cookie, "POST", { organizationId: a.org.id,
        employeeId: a.worker.id, earningType: "commission", label: "Invalidation regression", amount: 12.34,
        effectiveDate: "2027-01-05" }), 201, "earning creation invalidates exactly its cutoff");
      a.invalidationEarningId = result.id;
    } else {
      result = status(await request("/api/payroll-earnings", a.maker.cookie, "PATCH", { id: a.invalidationEarningId }), 200,
        "earning void invalidates exactly its cutoff");
    }
    assert.deepEqual(result.invalidatedPayrollRunIds, [target.id]); assertions++;
    check((await db.select().from(s.payrollEntries).where(eq(s.payrollEntries.payrollRunId, target.id))).length === 0, "stale own entries removed");
    for (const [index, expected] of [[0, "Superseded"], [1, exactLinks ? "Pending" : "Superseded"]]) {
      assert.equal((await db.select().from(s.approvalTasks).where(eq(s.approvalTasks.id, tasks[index].id)))[0].status,
        expected, `${method} exactLinks=${exactLinks} task=${index}`); assertions++;
    }
    assert.deepEqual((await db.select().from(s.payrollRuns).where(eq(s.payrollRuns.id, unrelated.id)))[0], beforeUnrelated,
      "unrelated cutoff register unchanged"); assertions++;
    if (method === "POST") {
      await db.update(s.payrollRuns).set({ status: "Processed", employeeCount: 1, processedChunks: 1, totalChunks: 1 }).where(eq(s.payrollRuns.id, target.id));
      for (const t of tasks) await db.update(s.approvalTasks).set({ status: "Pending", decidedBy: null, decidedAt: null }).where(eq(s.approvalTasks.id, t.id));
    }
  }
}
async function lifecycle(v, a) {
  const forged = { organizationId: v.org.id, legalEntityId: v.entity.id, employeeId: v.worker.id };
  // A real same-employer run whose ID starts with the target's decimal ID.
  // Historical display-text matching incorrectly superseded its approval.
  const prefixId = Number(String(a.run.id) + "99999");
  const [prefixRun] = await db.insert(s.payrollRuns).values({ id: prefixId, organizationId: a.org.id,
    legalEntityId: a.entity.id, periodLabel: "Unrelated prefix-collision run", periodStart: "2026-03-01",
    periodEnd: "2026-03-15", payDate: "2026-03-16", status: "Draft" }).returning();
  const inserted = await db.insert(s.approvalTasks).values([
    { organizationId: a.org.id, payrollRunId: prefixRun.id, title: "Unrelated pending approval", detail: `Payroll run #${prefixRun.id}`, approver: a.checker.user.name, dueLabel: "Synthetic" },
    { organizationId: a.org.id, payrollRunId: a.run.id, title: "Renamed linked approval", detail: "Renamed payroll review", approver: a.checker.user.name, dueLabel: "Synthetic" },
    { organizationId: a.org.id, payrollRunId: null, title: "Legacy linked approval", detail: `Payroll run #${a.run.id} · legacy`, approver: a.checker.user.name, dueLabel: "Synthetic" },
  ]).returning();
  await pool.query("UPDATE user_organizations SET active=false WHERE user_id=$1 AND organization_id=$2", [a.maker.user.id, a.org.id]);
  await deny(a, a.maker, `/api/payroll-runs/${a.run.id}/process`, "POST", {}, 403, "revoked membership cannot process with an existing session");
  await pool.query("UPDATE user_organizations SET active=true WHERE user_id=$1 AND organization_id=$2", [a.maker.user.id, a.org.id]);
  for (const suffix of ["process", "submit-review", "release"]) {
    await deny(v, a.maker, `/api/payroll-runs/${v.run.id}/${suffix}`, "POST", { ...forged, organizationId: a.org.id, approverUserId: a.checker.user.id }, 403, "foreign run " + suffix);
  }
  await deny(v, a.checker, `/api/approvals/${v.task.id}`, "PATCH", { status: "Approved", organizationId: a.org.id }, 404, "foreign payroll approval with forged own organization");
  status(await request(`/api/payroll-runs/${a.run.id}/process`, a.employeeUser.cookie, "POST", {}), 403, "employee cannot calculate");
  const calculated = status(await request(`/api/payroll-runs/${a.run.id}/process`, a.maker.cookie, "POST", forged), 200, "own process ignores forged body selectors");
  check(calculated.run.id === a.run.id && calculated.run.organizationId === a.org.id, "calculated own run");
  const entries = await db.select().from(s.payrollEntries).where(eq(s.payrollEntries.payrollRunId, a.run.id));
  check(entries.length === 1 && entries[0].employeeId === a.worker.id && Number(entries[0].netPay) > 0, "actual own-worker payroll calculation");
  for (const [index, expected] of [[0, exactLinks ? "Pending" : "Superseded"], [1, exactLinks ? "Superseded" : "Pending"], [2, "Superseded"]]) {
    const [actual] = await db.select().from(s.approvalTasks).where(eq(s.approvalTasks.id, inserted[index].id));
    assert.equal(actual.status, expected, `process exactLinks=${exactLinks} task=${index}`); assertions++;
  }
  // Flag-off parity leaves a renamed legacy task pending. Retire this test-only
  // task before the ordinary fresh-checker journey; it is not a real approval.
  if (!exactLinks) await db.update(s.approvalTasks).set({ status: "Superseded" }).where(eq(s.approvalTasks.id, inserted[1].id));
  const selfReview = await request(`/api/payroll-runs/${a.run.id}/submit-review`, a.maker.cookie, "POST", { approverUserId: a.maker.user.id });
  status(selfReview, 409, "maker cannot be own payroll checker");
  status(await request(`/api/payroll-runs/${a.run.id}/submit-review`, a.maker.cookie, "POST", { approverUserId: v.checker.user.id }), 422, "foreign checker cannot be assigned");
  const submitted = status(await request(`/api/payroll-runs/${a.run.id}/submit-review`, a.maker.cookie, "POST", { ...forged, approverUserId: a.checker.user.id }), 201, "own payroll review submission");
  check(submitted.task.payrollRunId === a.run.id && submitted.task.organizationId === a.org.id && submitted.approver.id === a.checker.user.id, "own review task and independent checker");
  await deny(a, a.maker, `/api/approvals/${submitted.task.id}`, "PATCH", { status: "Approved" }, 403, "maker cannot approve own task");
  const approved = status(await request(`/api/approvals/${submitted.task.id}`, a.checker.cookie, "PATCH", { status: "Approved" }), 200, "independent own payroll checker");
  check(Boolean(approved), "real approval response");
  const [approvedTask] = await db.select().from(s.approvalTasks).where(eq(s.approvalTasks.id, submitted.task.id));
  check(approvedTask.status === "Approved" && approvedTask.decidedBy === a.checker.user.name, "SQL confirms independent checker decision");
  await deny(a, a.checker, `/api/payroll-runs/${a.run.id}/release`, "POST", { acknowledgeExceptions: true }, 403, "checker cannot release checked payroll");
  await db.update(s.sessions).set({ mfaVerifiedAt: null }).where(eq(s.sessions.id, a.releaser.session.id));
  const beforeMfaDenial = await snapshot(a);
  const mfaDenied = await request(`/api/payroll-runs/${a.run.id}/release`, a.releaser.cookie, "POST", { acknowledgeExceptions: true });
  status(mfaDenied, 403, "release requires recent MFA");
  check(mfaDenied.json.code === "MFA_REQUIRED", "MFA enforced for fictional releaser");
  assert.deepEqual(await snapshot(a), beforeMfaDenial, "missing MFA cannot alter financial state"); assertions++;
  await db.update(s.sessions).set({ mfaVerifiedAt: new Date() }).where(eq(s.sessions.id, a.releaser.session.id));
  const released = status(await request(`/api/payroll-runs/${a.run.id}/release`, a.releaser.cookie, "POST", { ...forged, acknowledgeExceptions: true }), 200, "own separate releaser settles fictional payroll");
  check(released.run.id === a.run.id && released.run.organizationId === a.org.id && released.run.status === "Released", "own release committed");
  check((await db.select().from(s.payrollRuns).where(eq(s.payrollRuns.id, a.run.id)))[0].status === "Released", "SQL confirms own release");
  const slips = await db.select().from(s.payslips).where(eq(s.payslips.organizationId, a.org.id));
  check(slips.length === 1 && slips[0].employeeId === a.worker.id, "settlement creates only own worker payslip");
  for (const suffix of ["process", "submit-review", "release"]) successes.push({ route: `payroll-runs/[id]/${suffix}`,
    method: "POST", organizationId: a.org.id, objectId: a.run.id, ownSuccess: true, forgedSelectorExercised: true });
  successes.push({ route: "approvals/[id]", method: "PATCH", organizationId: a.org.id, objectId: submitted.task.id,
    ownSuccess: true, independentChecker: a.checker.user.id });
}
try {
  const nonce = randomUUID().slice(0, 8);
  const effectiveDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  // Attacker rows first; victim primary keys must exceed both attacker IDs and 6.
  const a = await seed("B", nonce), b = await seed("C", nonce);
  await seedAdjustments(a, effectiveDate); await seedAdjustments(b, effectiveDate);
  for (let i = 0; i < 7; i++) await seedAdjustments(await seed("PAD" + i, nonce), effectiveDate);
  const v = await seed("VICTIM", nonce);
  check(v.worker.id > Math.max(a.worker.id, b.worker.id, 6) && v.run.id > Math.max(a.run.id, b.run.id, 6), "real victim IDs exceed attacker IDs and 6");
  await seedAdjustments(v, effectiveDate);
  check(v.earning.id > Math.max(a.earning.id, b.earning.id, 6) && v.claim.id > Math.max(a.claim.id, b.claim.id, 6), "victim earning/correction IDs exceed both attacker IDs and 6");
  check(v.holiday.id > Math.max(a.holiday.id, b.holiday.id, 6), "real victim holiday exceeds both own comparator IDs");
  // Actual pending victim task, not an invented ID. Foreign requests must be
  // rejected before task fingerprint, status or financial contents are read.
  await db.insert(s.approvalTasks).values(Array.from({ length: 7 }, (_, i) => ({ organizationId: a.org.id,
    title: `Fictional padding ${i}`, detail: "Synthetic ID padding", approver: a.checker.user.name, dueLabel: "Synthetic" })));
  [v.task] = await db.insert(s.approvalTasks).values({ organizationId: v.org.id, payrollRunId: v.run.id,
    title: "Victim exclusive payroll approval", detail: `Payroll run #${v.run.id}`,
    approver: v.checker.user.name, dueLabel: "Synthetic" }).returning();
  check(v.task.id > 6, "real high-ID victim approval exists");
  const initialVictim = await snapshot(v);
  for (const attacker of [a, b]) { await holidays(v, attacker); await corrections(v, attacker, effectiveDate); await earningInvalidation(attacker); await lifecycle(v, attacker); }
  assert.deepEqual(await snapshot(v), initialVictim, "victim unchanged across both complete attacker journeys"); assertions++;
  await mkdir("qa-artifacts", { recursive: true });
  await writeFile("qa-artifacts/tenant-money-lifecycle.json", JSON.stringify({ head: process.env.PR_HEAD_SHA ?? null,
    assertions, exactLinks, attackerOrganizations: [a.org.id, b.org.id], victimOrganizationId: v.org.id,
    successes, receipts, status: "PASS", scope: "partial MNY-01; no provider or production acceptance" }, null, 2));
  console.log(`Money lifecycle PASS: ${assertions} assertions, ${receipts.length} denied requests with unchanged victim snapshots.`);
} finally { await pool.end(); }
