/** Fictional CI PG16/production-Next proof. No coverage promotion. */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { requireDisposablePiiApprovalEnv } from "./tenant-pii01-approval-contract.mjs";
import { managedClientWorkerFixture } from "./managed-client-worker-fixture.ts";

// Reuse the restrictive CI-only localhost/no-provider guard before DB imports.
requireDisposablePiiApprovalEnv();
const [{ db, pool }, s, { eq, asc }, { MANAGED_PAYROLL_GATES }] = await Promise.all([
  import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
  import("drizzle-orm"), import("../../src/lib/managed-payroll.ts"),
]);
const origin = "http://127.0.0.1:3000";
async function post(f, id, extra = {}) {
  requireDisposablePiiApprovalEnv();
  const r = await fetch(origin + "/api/managed-payroll/runs/" + id + "/approve", {
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(30000),
    headers: { Cookie: f.cookie, Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    body: JSON.stringify({ note: "Fictional CI only", ...extra }),
  });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = null; }
  return { status: r.status, body, text, cache: r.headers.get("cache-control") };
}
async function snapshot(f) {
  const rows = table => db.select().from(table).where(eq(table.organizationId, f.org.id)).orderBy(asc(table.id));
  return {
    runs: await rows(s.payrollRuns), audit: await rows(s.auditEvents),
    entries: await db.select().from(s.payrollEntries).where(eq(s.payrollEntries.payrollRunId, f.run.id)).orderBy(asc(s.payrollEntries.id)),
    approvals: await db.select().from(s.managedPayrollRunApprovals).where(eq(s.managedPayrollRunApprovals.engagementId, f.eng.id)).orderBy(asc(s.managedPayrollRunApprovals.id)),
  };
}
function owned(response, f) {
  assert.equal(response.body?.approval?.payrollRunId, f.run.id, "accepts another employer's data");
  assert.equal(response.body.approval.engagementId, f.eng.id);
  assert.equal(response.body.approval.approvedByUserId, f.user.id);
  assert.match(response.cache ?? "", /private/);
  assert.match(response.cache ?? "", /no-store/);
}
async function seed(label) {
  const nonce = randomUUID();
  const [org] = await db.insert(s.organizations).values({ name: "Fictional managed " + label + nonce, legalName: "Fictional managed " + label }).returning();
  const [user, checker] = await db.insert(s.users).values(["client", "checker"].map(role => ({
    email: role + nonce + "@example.invalid", name: "Fictional " + role,
    passwordHash: "non-login-fixture", localPasswordEnabled: false, role: "owner",
  }))).returning();
  const [membership] = await db.insert(s.userOrganizations).values({ userId: user.id, organizationId: org.id, active: true, role: "owner" }).returning();
  const [unit] = await db.insert(s.orgUnits).values({ organizationId: org.id, type: "department", name: "Fictional department", code: nonce.slice(0, 20) }).returning();
  const [employee] = await db.insert(s.employees).values(managedClientWorkerFixture(org.id, nonce.slice(0, 20), label)).returning();
  const [run] = await db.insert(s.payrollRuns).values({ organizationId: org.id, periodLabel: "Fictional " + nonce, periodStart: "2026-01-01", periodEnd: "2026-01-15", payDate: "2026-01-20", status: "Ready for release", grossPay: "1000", netPay: "900", employeeCount: 1 }).returning();
  const [entry] = await db.insert(s.payrollEntries).values({ payrollRunId: run.id, employeeId: employee.id, grossPay: "1000", deductions: "100", netPay: "900" }).returning();
  const [eng] = await db.insert(s.managedPayrollEngagements).values({ organizationId: org.id, clientApproverUserId: user.id, status: "pilot", createdBy: "Fictional CI" }).returning();
  await db.insert(s.managedPayrollGates).values(MANAGED_PAYROLL_GATES.map(g => ({ engagementId: eng.id, gateKey: g.key, label: g.label, status: "verified", evidenceRef: "fictional-ci-only" })));
  await db.insert(s.auditEvents).values({ organizationId: org.id, actor: checker.name, action: "Approval approved", resource: run.periodLabel, metadata: { payrollRunId: run.id, deciderUserId: checker.id } });
  const token = randomBytes(32).toString("hex");
  await db.insert(s.sessions).values({ userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600000), lastSeenAt: new Date(), mfaVerifiedAt: new Date(), authMethod: "oidc" });
  return { org, user, checker, membership, unit, employee, run, entry, eng, cookie: "__Host-linaw_session=" + token };
}
async function verify() {
  const a = await seed("A"), b = await seed("B");
  for (let i = 0; i < 7; i++) await db.insert(s.payrollRuns).values({ organizationId: a.org.id, periodLabel: "Fictional filler", periodStart: "2026-01-01", periodEnd: "2026-01-15", payDate: "2026-01-20" });
  const victim = await seed("Victim");
  assert.ok(victim.run.id > 6 && victim.run.id > b.run.id);
  const victimBefore = await snapshot(victim);
  const receipts = [];
  for (const f of [a, b]) {
    const other = f === a ? b : a;
    const otherBefore = await snapshot(other);
    const ownBefore = await snapshot(f);
    const missing = await post(f, 2147483647);
    for (const extra of [{}, { organizationId: f.org.id, engagementId: f.eng.id }]) {
      const foreign = await post(f, victim.run.id, extra);
      assert.equal(foreign.status, 404); assert.equal(foreign.text, missing.text);
      assert.equal(foreign.cache, missing.cache); assert.match(foreign.cache ?? "", /private.*no-store/);
      assert.deepEqual(await snapshot(f), ownBefore);
      assert.deepEqual(await snapshot(victim), victimBefore);
    }
    const own = await post(f, f.run.id, { organizationId: victim.org.id, engagementId: victim.eng.id });
    assert.equal(own.status, 201, own.text); owned(own, f); receipts.push(own);
    const after = await snapshot(f);
    assert.equal(after.approvals.length, 1); assert.equal(after.audit.length, ownBefore.audit.length + 1);
    assert.equal(after.audit.at(-1).action, "Managed payroll client approved");
    assert.equal(after.audit.at(-1).metadata.approvalId, after.approvals[0].id);
    assert.deepEqual(after.runs, ownBefore.runs); assert.deepEqual(after.entries, ownBefore.entries);
    const replay = await post(f, f.run.id); assert.equal(replay.status, 200); owned(replay, f);
    assert.equal(replay.body.alreadyApproved, true); assert.deepEqual(await snapshot(f), after);
    await db.update(s.payrollEntries).set({ trace: { fictionalRevision: 2 } }).where(eq(s.payrollEntries.id, f.entry.id));
    const revised = await snapshot(f);
    const reapproval = await post(f, f.run.id); assert.equal(reapproval.status, 200, reapproval.text); owned(reapproval, f);
    assert.equal(reapproval.body.replacedStaleApproval, true);
    const reapproved = await snapshot(f);
    assert.equal(reapproved.approvals[0].id, after.approvals[0].id);
    assert.notEqual(reapproved.approvals[0].payrollFingerprint, after.approvals[0].payrollFingerprint);
    assert.equal(reapproved.audit.length, revised.audit.length + 1);
    assert.equal(reapproved.audit.at(-1).action, "Managed payroll client re-approved after payroll change");
    assert.deepEqual(await snapshot(other), otherBefore); assert.deepEqual(await snapshot(victim), victimBefore);
    for (const [mutation, restore, expected] of [
      [{ active: false }, { active: true }, 404],
      [{ role: "payroll" }, { role: "owner" }, 404],
      [{ orgUnitId: f.unit.id }, { orgUnitId: null }, 404],
    ]) {
      await db.update(s.userOrganizations).set(mutation).where(eq(s.userOrganizations.id, f.membership.id));
      const before = await snapshot(f); assert.equal((await post(f, f.run.id)).status, expected);
      assert.deepEqual(await snapshot(f), before);
      await db.update(s.userOrganizations).set(restore).where(eq(s.userOrganizations.id, f.membership.id));
    }
    await db.update(s.managedPayrollEngagements).set({ clientApproverUserId: f.checker.id }).where(eq(s.managedPayrollEngagements.id, f.eng.id));
    const rotated = await snapshot(f); assert.equal((await post(f, f.run.id)).status, 403);
    assert.deepEqual(await snapshot(f), rotated);
    await db.update(s.managedPayrollEngagements).set({ clientApproverUserId: f.user.id }).where(eq(s.managedPayrollEngagements.id, f.eng.id));
  }
  // Hold a membership change uncommitted: the HTTP request sees the old grant
  // at preflight, then must wait at the transaction lock and refuse on recheck.
  const blocker = await pool.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query("UPDATE user_organizations SET active=false WHERE id=$1", [a.membership.id]);
    const before = await snapshot(a);
    const pending = post(a, a.run.id);
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      const result = await pool.query("SELECT 1 FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type='Lock' AND query ILIKE '%user_organizations%' AND query ILIKE '%FOR SHARE%'");
      if (result.rowCount) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    // Always release the blocker before awaiting the bounded HTTP request.
    await blocker.query("COMMIT");
    const refused = await pending;
    assert.equal(waiting, true, "membership revocation race was not actually exercised");
    assert.equal(refused.status, 404, refused.text);
    assert.deepEqual(await snapshot(a), before);
  } finally { await blocker.query("ROLLBACK"); blocker.release(); }
  await db.update(s.userOrganizations).set({ active: true }).where(eq(s.userOrganizations.id, a.membership.id));
  // Force an audit write failure only for this fixture, in this guarded
  // disposable database; approval changes must roll back with the audit.
  await db.update(s.payrollEntries).set({ trace: { fictionalRevision: 3 } }).where(eq(s.payrollEntries.id, a.entry.id));
  const beforeFault = await snapshot(a);
  try {
    await pool.query("CREATE FUNCTION qa_managed_approval_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'Managed payroll client re-approved after payroll change' THEN RAISE EXCEPTION 'fictional approval audit fault'; END IF; RETURN NEW; END $$");
    await pool.query("CREATE TRIGGER qa_managed_approval_audit_fault BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION qa_managed_approval_audit_fault()");
    assert.equal((await post(a, a.run.id)).status, 500);
    assert.deepEqual(await snapshot(a), beforeFault, "approval committed despite audit failure");
  } finally {
    await pool.query("DROP TRIGGER IF EXISTS qa_managed_approval_audit_fault ON audit_events");
    await pool.query("DROP FUNCTION IF EXISTS qa_managed_approval_audit_fault()");
  }
  assert.throws(() => owned(receipts[0], b), /accepts another employer's data/);
  assert.throws(() => owned(receipts[1], a), /accepts another employer's data/);
  assert.deepEqual(await snapshot(victim), victimBefore);
  console.log(JSON.stringify({ kind: "MANAGED_CLIENT_APPROVAL_HTTP", result: "PASS", attackers: 2, ownApprovals: 2, ownReapprovals: 2, highVictimRunId: victim.run.id, revocationRace: true, auditFailureRollback: true, newCoverageCredits: 0, productionCertified: false }));
}
try { await verify(); } finally { await pool.end(); }
