/**
 * PII-02 employee schedule page SSR: real two-attacker, higher-ID victim HTTP
 * proof in disposable PG16. This is READ-ONLY and confers zero page credits.
 * The existing GET/POST receipt API proof remains unmodified.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  requireDisposableScheduleReceipt, assertUnchanged,
} from "./tenant-self-schedule-receipts-contract.mjs";

const PATH = "/self/schedule-receipts";

function assertOwnPage(response, employer, others) {
  assert.equal(response.status, 200,
    employer.label + " must reach their own feature-ON SSR page");
  assert.match(response.text, /My schedule receipts/);
  assert.ok(response.text.includes('data-organization-id="' + employer.org.id + '"'),
    "Owned SSR must identify the authenticated employee's actual employer");
  assert.ok(response.text.includes("data-employee-schedule-receipts"),
    "The employee receipt client must mount only after the server checks");
  for (const other of others) {
    assert.ok(!response.text.includes('data-organization-id="' + other.org.id + '"'),
      "A foreign tenant must never be bound to the rendered client");
    assert.ok(!response.text.includes(other.marker),
      "SSR must not serialize another employer's private fixture");
  }
}
function assertDeniedPage(response, subjects, context) {
  assert.equal(response.status, 404, context + ": fail-closed SSR status");
  assert.ok(!response.text.includes("data-employee-schedule-receipts"),
    context + ": private client must not mount on denied response");
  for (const employer of subjects) {
    assert.ok(!response.text.includes('data-organization-id="' + employer.org.id + '"'),
      context + ": no employer binding on denied page");
    assert.ok(!response.text.includes(employer.marker),
      context + ": no private employer fixture on denied page");
  }
}

export async function proveSelfSchedulePageIsolation() {
  // Must run before importing any module that can establish a DB connection.
  requireDisposableScheduleReceipt();
  const [{ db, pool }, s, t, { eq, asc }] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("./tenant-table-http.mjs"),
    import("drizzle-orm"),
  ]);
  const records = (table, organizationId) =>
    db.select().from(table).where(eq(table.organizationId, organizationId)).orderBy(asc(table.id));
  const snapshot = async organizationId => {
    const [staff, memberships, payroll, audit] = await Promise.all([
      records(s.employees, organizationId),
      records(s.userOrganizations, organizationId),
      records(s.payrollRuns, organizationId),
      records(s.auditEvents, organizationId),
    ]);
    return { staff, memberships, payroll, audit };
  };
  async function employeeSession(employer, worker, suffix, role = "employee") {
    const [user] = await db.insert(s.users).values({
      name: employer.marker + " " + suffix,
      email: (employer.marker + "-" + suffix).toLowerCase() + "@example.invalid",
      passwordHash: "fictional-no-login", role: "employee", active: true,
      employeeId: worker.id,
    }).returning();
    const [membership] = await db.insert(s.userOrganizations).values({
      userId: user.id, organizationId: employer.org.id, role, active: true,
      workerEmployeeId: role === "employee" ? worker.id : null,
    }).returning();
    const session = await t.standaloneMakeSession(user.id);
    await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(s.sessions.id, session.id));
    return { user, membership, cookie: session.cookie };
  }
  async function seed(label, nonce) {
    const employer = await t.seedEmployer(label, nonce, t.standaloneMakeSession);
    return { ...employer, self: await employeeSession(employer, employer.worker, "SELF") };
  }
  const request = (path, cookie) => t.standaloneRequest(path, { cookie });
  try {
    assert.equal((await db.select({ id: s.organizations.id })
      .from(s.organizations).limit(1)).length, 0,
      "ESS_PAGE_TENANT_REFUSED: PostgreSQL must be an empty disposable fixture");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = await seed("ATTA", nonce);
    const b = await seed("ATTB", nonce);
    const victim = await seed("VICTIM", nonce);
    const subjects = [a, b, victim];
    assert.deepEqual(subjects.map(e => e.org.id), [1, 2, 3]);
    assert.ok(victim.worker.id > b.worker.id && b.worker.id > a.worker.id,
      "Victim employee must have a real higher persisted ID");
    assert.equal(new Set(subjects.map(e => e.self.cookie)).size, 3);
    let ownPositives = 0, denials = 0;

    for (const actor of [a, b]) {
      const own = await request(PATH, actor.self.cookie);
      assertOwnPage(own, actor, subjects.filter(e => e !== actor));
      ownPositives++;
      const before = new Map(await Promise.all(subjects.map(async e =>
        [e.org.id, await snapshot(e.org.id)])));
      for (const forged of [
        "?organizationId=" + victim.org.id,
        "?employeeId=" + victim.worker.id,
        "?userId=" + victim.self.user.id,
        "?orgUnitId=" + victim.unit.id,
        "?workDate=2026-11-09",
        "?organizationId=" + actor.org.id + "&organizationId=" + victim.org.id,
        "?organizationId=",
      ]) {
        assertDeniedPage(await request(PATH + forged, actor.self.cookie),
          subjects, actor.label + " forged " + forged);
        denials++;
      }
      assertDeniedPage(await request(PATH, actor.cookie),
        subjects, actor.label + " owner-role session");
      denials++;
      for (const subject of subjects) {
        assertUnchanged(before.get(subject.org.id), await snapshot(subject.org.id),
          actor.label + " forged/owner read must not alter any employer/payroll/audit rows");
      }
    }
    assertOwnPage(await request(PATH, victim.self.cookie), victim, [a, b]);
    ownPositives++;

    // An employee global role + another organization's OWNER membership passed
    // the former generic assertMembership check. The SSR must now refuse it.
    const wrongRole = await employeeSession(b, b.worker, "WRONGROLE", "owner");
    const beforeWrongRole = new Map(await Promise.all(subjects.map(async e =>
      [e.org.id, await snapshot(e.org.id)])));
    assertDeniedPage(await request(PATH, wrongRole.cookie),
      subjects, "employee account with owner membership");
    denials++;
    for (const subject of subjects) assertUnchanged(
      beforeWrongRole.get(subject.org.id), await snapshot(subject.org.id),
      "wrong-role denied read must preserve SQL");

    // A user who holds Alpha membership but has a *real* victim employee ID
    // must not be re-bound to the attacker's allowed organization.
    const [forgedUser] = await db.insert(s.users).values({
      name: "Forged link " + nonce, email: "cross-linked-" + nonce + "@example.invalid",
      passwordHash: "fictional-no-login", role: "employee", employeeId: victim.worker.id, active: true,
    }).returning();
    await db.insert(s.userOrganizations).values({
      userId: forgedUser.id, organizationId: a.org.id, role: "employee", active: true,
    });
    const forgedSession = await t.standaloneMakeSession(forgedUser.id);
    await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(s.sessions.id, forgedSession.id));
    const beforeForged = await Promise.all(subjects.map(e => snapshot(e.org.id)));
    assertDeniedPage(await request(PATH, forgedSession.cookie),
      subjects, "real victim employee ID with attacker membership");
    denials++;
    for (let i = 0; i < subjects.length; i++) assertUnchanged(
      beforeForged[i], await snapshot(subjects[i].org.id),
      "cross-linked employee read cannot mutate SQL");

    // A disabled employee record cannot enter the page, matching API service
    // assertBoundIdentity. Restore the fictional row before revocation proof.
    await db.update(s.employees).set({ status: "Inactive" })
      .where(eq(s.employees.id, a.worker.id));
    const beforeInactive = await snapshot(a.org.id);
    assertDeniedPage(await request(PATH, a.self.cookie), subjects, "inactive worker");
    denials++;
    assertUnchanged(beforeInactive, await snapshot(a.org.id), "inactive employee denial");
    await db.update(s.employees).set({ status: "Active" })
      .where(eq(s.employees.id, a.worker.id));
    assertOwnPage(await request(PATH, a.self.cookie), a, [b, victim]);
    ownPositives++;

    // Maintain the same Alpha session with a live Beta membership, then revoke
    // Alpha: no stale Alpha access and no cross-organization fallback.
    await db.insert(s.userOrganizations).values({
      userId: a.self.user.id, organizationId: b.org.id, role: "employee", active: true,
    });
    await db.update(s.userOrganizations).set({ active: false })
      .where(eq(s.userOrganizations.id, a.self.membership.id));
    const finalBefore = await Promise.all(subjects.map(e => snapshot(e.org.id)));
    assertDeniedPage(await request(PATH, a.self.cookie), subjects, "revoked Alpha member");
    denials++;
    assertOwnPage(await request(PATH, b.self.cookie), b, [a, victim]);
    ownPositives++;
    for (let i = 0; i < subjects.length; i++) assertUnchanged(
      finalBefore[i], await snapshot(subjects[i].org.id),
      "post-revocation SSR must not mutate employer, payroll or audit SQL");

    const anonymous = await request(PATH);
    assert.ok([302, 303, 307, 308].includes(anonymous.status),
      "Anonymous page must redirect to login, never mount the receipt client");
    assert.ok(!anonymous.text.includes("data-employee-schedule-receipts"));
    console.log(JSON.stringify({
      suite: "PII02_ESS_SCHEDULE_PAGE_PG16_HTTP", ownPositives, denials,
      higherIdVictim: true, unchangedEmployerPayrollAudit: true,
      pageActionCredits: 0, apiMethodCredits: 0, productionAccepted: false,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/")
  .endsWith("scripts/qa/tenant-self-schedule-page-http.mjs")) {
  proveSelfSchedulePageIsolation().catch(error => {
    console.error("PII02_ESS_SCHEDULE_PAGE_PG16_HTTP_FAIL:", error.message);
    process.exitCode = 1;
  });
}
