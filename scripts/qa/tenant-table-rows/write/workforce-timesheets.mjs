/**
 * Workforce timesheets: every POST action (update_policy, submit, decide approved/rejected) on fictional
 * employers only. The shared write runner adds two attackers, victim denial, discrimination and an
 * unchanged victim. Policies are saved advisory and inactive; no payroll run, payout or provider is touched.
 */
import { createHash, randomBytes } from "node:crypto";

export const fixtureOrder = {};

export function createRows(deps) {
  const { addWorker, assert, asc, auditBusinessSnapshot, auditEvents, db, eq, userOrganizations, users } = deps;
  // The shared write runner's dependency list is bound by reviewed receipts, so tables it does not pass are
  // read from the application schema here (only the real PG16 proof runs this; unit harnesses inject them).
  let schema;
  const table = async (name) => deps[name] ?? (schema ??= await import("../../../../src/db/schema.ts"))[name];
  const url = "/api/workforce/timesheets";
  const read = (target, orgId) => db.select().from(target).where(eq(target.organizationId, orgId)).orderBy(asc(target.id));
  const timesheetState = async (orgId) => ({
    policies: await read(await table("workforceTimesheetPolicies"), orgId),
    timesheets: await read(await table("workforceTimesheets"), orgId),
    audit: auditBusinessSnapshot(await read(auditEvents, orgId)),
  });
  const plainState = async (orgId) => JSON.parse(JSON.stringify(await timesheetState(orgId)));
  const newAudit = (before, after, c, action) => {
    assert.equal(after.audit.length, before.audit.length + 1, "exactly one audit receipt: " + action);
    assert.deepEqual(after.audit.slice(0, -1), before.audit, "earlier audit rows are unchanged");
    const audit = after.audit.at(-1);
    assert.equal(audit.organizationId, c.orgId);
    assert.equal(audit.action, action);
    return audit;
  };
  const policyBody = (organizationId) => ({ organizationId, action: "update_policy", enforcementMode: "advisory", active: false });
  // A submitted period with no punches or schedules: no blockers, so a second manager can approve it.
  const SUBMIT = { periodStart: "2026-03-02", periodEnd: "2026-03-15" };
  const submitBody = (organizationId, employeeId) => ({ organizationId, action: "submit", employeeId, ...SUBMIT });

  return [
    { key: "POST workforce/timesheets",
      seed: async (e) => {
        // A worker of this row only: other families seed punches/overtime for the default worker, which would
        // add timesheet blockers to this period.
        const worker = await addWorker(e, "TS");
        // A second company-wide manager: decide refuses the submitter approving their own version.
        const [manager] = await db.insert(users).values({ email: e.marker.toLowerCase() + "-ts-manager@example.invalid",
          name: e.marker + " timesheet manager", passwordHash: "fictional-session-only", role: "admin", totpEnabled: true }).returning();
        await db.insert(userOrganizations).values({ userId: manager.id, organizationId: e.org.id, role: "admin", active: true });
        const raw = randomBytes(32).toString("hex");
        await db.insert(await table("sessions")).values({ userId: manager.id, tokenHash: createHash("sha256").update(raw).digest("hex"),
          expiresAt: new Date(Date.now() + 3_600_000), lastSeenAt: new Date(), mfaVerifiedAt: new Date() });
        // An already-submitted version for a different period: the forged-reference target in the victim.
        const [timesheet] = await db.insert(await table("workforceTimesheets")).values({ organizationId: e.org.id, employeeId: worker.id,
          periodStart: "2026-02-02", periodEnd: "2026-02-15", version: 1, status: "submitted",
          snapshot: { fictional: e.marker }, snapshotHash: createHash("sha256").update(e.marker).digest("hex"),
          submittedBy: e.marker + " fixture", submittedAt: new Date() }).returning();
        assert.equal(timesheet.organizationId, e.org.id);
        return { workerId: worker.id, timesheetId: timesheet.id, managerId: manager.id, managerName: manager.name, managerCookie: "__Host-linaw_session=" + raw };
      },
      state: timesheetState,
      ownBody: (c) => policyBody(c.orgId),
      foreignBody: (c) => policyBody(c.victim.org.id),
      expect: (before, after, c, response) => {
        assert.equal(before.policies.length, 0, "the employer starts with no timesheet policy");
        assert.equal(after.policies.length, 1, "exactly one policy is created");
        const policy = after.policies[0];
        assert.equal(policy.organizationId, c.orgId);
        assert.equal(policy.enforcementMode, "advisory");
        assert.equal(policy.active, false, "the gate is saved inactive, never enforced by this proof");
        assert.equal(policy.updatedByUserId, c.owner.id, "the signed-in owner is recorded as the editor");
        assert.deepEqual(after.timesheets, before.timesheets, "updating the policy changes no timesheet");
        const audit = newAudit(before, after, c, "WFM timesheet payroll gate policy updated");
        assert.equal(audit.actor, c.owner.name);
        assert.equal(audit.metadata.policyId, policy.id);
        assert.deepEqual(response.json?.policy, { active: false, enforcementMode: "advisory" });
      },
      exercise: async (c, { request, expectStatus, cookie }) => {
        const victimBefore = await plainState(c.victim.org.id);
        const unchangedVictim = async (label) => assert.deepEqual(await plainState(c.victim.org.id), victimBefore, label + " must leave the victim unchanged");

        // submit: the owner submits for the own worker; the version is read back from PostgreSQL.
        let before = await plainState(c.orgId);
        const submitted = expectStatus(await request(url, { method: "POST", cookie, body: submitBody(c.orgId, c.seeded.workerId) }), 201, "own timesheet submit");
        let after = await plainState(c.orgId);
        assert.equal(after.timesheets.length, before.timesheets.length + 1, "exactly one timesheet version is created");
        const created = after.timesheets.at(-1);
        assert.equal(created.organizationId, c.orgId);
        assert.equal(created.employeeId, c.seeded.workerId);
        assert.equal(created.periodStart, SUBMIT.periodStart);
        assert.equal(created.status, "submitted");
        assert.equal(created.submittedByUserId, c.owner.id);
        assert.equal(submitted.json?.timesheet?.id, created.id, "the response names the committed version");
        assert.equal(newAudit(before, after, c, "WFM timesheet submitted").metadata.timesheetId, created.id);
        // A victim worker named under the own employer, and the victim employer named directly, both write nothing.
        const forgedSubmit = expectStatus(await request(url, { method: "POST", cookie, body: submitBody(c.orgId, c.victimSeeded.workerId) }), 404, "forged victim worker submit");
        const foreignSubmit = expectStatus(await request(url, { method: "POST", cookie, body: submitBody(c.victim.org.id, c.seeded.workerId) }), 403, "victim employer submit");
        for (const r of [forgedSubmit, foreignSubmit]) assert.ok(!r.text.includes(c.victim.marker), "a refused submit leaks no victim data");
        assert.deepEqual(await plainState(c.orgId), after, "refused submits write nothing in the own employer");
        await unchangedVictim("refused submits");

        // decide approved: a different manager approves the HTTP-submitted version.
        before = after;
        const approveBody = { organizationId: c.orgId, action: "decide", timesheetId: created.id, decision: "approved", decisionNote: c.marker + " approved" };
        expectStatus(await request(url, { method: "POST", cookie: c.seeded.managerCookie, body: approveBody }), 200, "second manager approves own timesheet");
        after = await plainState(c.orgId);
        const approved = after.timesheets.find((t) => t.id === created.id);
        assert.equal(approved.status, "approved");
        assert.equal(approved.decidedByUserId, c.seeded.managerId, "the deciding manager, not the submitter, is recorded");
        assert.deepEqual(after.timesheets.filter((t) => t.id !== created.id), before.timesheets.filter((t) => t.id !== created.id),
          "approval changes only the decided version");

        // decide rejected: the owner rejects the seeded version that someone else submitted.
        before = after;
        const rejectBody = (organizationId, timesheetId) => ({ organizationId, action: "decide", timesheetId, decision: "rejected", decisionNote: c.marker + " rejected" });
        expectStatus(await request(url, { method: "POST", cookie, body: rejectBody(c.orgId, c.seeded.timesheetId) }), 200, "owner rejects own seeded timesheet");
        after = await plainState(c.orgId);
        const rejected = after.timesheets.find((t) => t.id === c.seeded.timesheetId);
        assert.equal(rejected.status, "rejected");
        assert.equal(rejected.decidedByUserId, c.owner.id);
        // The victim's real submitted version, named under the own employer or the victim employer, is refused.
        const forgedDecide = expectStatus(await request(url, { method: "POST", cookie, body: rejectBody(c.orgId, c.victimSeeded.timesheetId) }), 404, "forged victim timesheet decision");
        const foreignDecide = expectStatus(await request(url, { method: "POST", cookie, body: rejectBody(c.victim.org.id, c.victimSeeded.timesheetId) }), 403, "victim employer decision");
        for (const r of [forgedDecide, foreignDecide]) assert.ok(!r.text.includes(c.victim.marker), "a refused decision leaks no victim data");
        assert.deepEqual(await plainState(c.orgId), after, "refused decisions write nothing in the own employer");
        await unchangedVictim("refused decisions");
        return { actions: ["submit", "decide:approved", "decide:rejected"], forgedReferences: 2, victimEmployerDenials: 2 };
      } },
  ];
}
