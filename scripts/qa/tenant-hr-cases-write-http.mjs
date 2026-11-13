/**
 * HR Cases POST/PATCH real-HTTP tenant isolation in an EMPTY fictional PG16.
 * Deliberately excludes COE object creation, provider I/O and production writes.
 * No API or page coverage credit, no automatic acceptance or deployment.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ORIGIN, API_PATH, requireDisposableHrWriteEnv, verifyHrWriteSourcePins,
  assertCreatedEmployeeCase, assertOwnCasePatch, assertDeniedCaseMutation,
  assertForeignSqlUnchanged,
} from "./tenant-hr-cases-write-contract.mjs";

const plain = value => JSON.parse(JSON.stringify(value));
const protectedTables = [
  "organizations", "legalEntities", "orgUnits", "employees",
  "employeePayProfiles", "userOrganizations", "employeeHrCases",
  "employeeHrCaseMessages", "auditEvents", "payrollRuns",
];

async function http(method, cookie, body, origin = ORIGIN) {
  assert.ok(method === "POST" || method === "PATCH", "HR_CASE_WRITE_REFUSED: out-of-scope method");
  const response = await fetch(ORIGIN + API_PATH, {
    method, redirect: "manual", cache: "no-store",
    headers: {
      "content-type": "application/json", origin,
      "sec-fetch-site": origin === ORIGIN ? "same-origin" : "cross-site",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body), signal: AbortSignal.timeout(25000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON denials are still rejected by assertions */ }
  return { status: response.status, text, json, headers: response.headers };
}

export async function proveHrCasesWriteIsolation() {
  // Refuse unsafe targets and source drift before opening DB modules or sessions.
  requireDisposableHrWriteEnv();
  verifyHrWriteSourcePins();
  const [{ db, pool }, s, { and, asc, eq }, fixture] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  let positiveWrites = 0, deniedWrites = 0, crossEmployerDenials = 0;
  try {
    const version = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(version >= 160000 && version < 170000,
      "HR_CASE_WRITE_REFUSED: PostgreSQL 16 required");
    assert.equal((await db.select().from(s.organizations).limit(1)).length, 0,
      "HR_CASE_WRITE_REFUSED: database not empty");
    assert.equal((await db.select().from(s.users).limit(1)).length, 0,
      "HR_CASE_WRITE_REFUSED: existing user data");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);

    async function makeEmployer(label) {
      return { ...(await fixture.seedEmployer(label, nonce, fixture.standaloneMakeSession)),
        cases: {}, label };
    }
    async function makeCase(actor, type, worker = actor.worker) {
      const role = type === "payslip_correction" ? "payroll" : "hr";
      const [row] = await db.insert(s.employeeHrCases).values({
        organizationId: actor.org.id, employeeId: worker.id,
        createdByUserId: actor.owner.id, caseType: type,
        subject: actor.marker + " " + type + " confidential",
        description: actor.marker + " protected fictional HR source",
        assignedRole: role, status: "open",
        slaDueAt: new Date(Date.now() + 72 * 3600000),
      }).returning();
      await db.insert(s.employeeHrCaseMessages).values({
        organizationId: actor.org.id, caseId: row.id, actorUserId: actor.owner.id,
        visibility: "internal", body: actor.marker + " private case note",
      });
      return row;
    }
    async function snapshot(orgId) {
      const values = {};
      for (const name of protectedTables) {
        const table = s[name];
        assert.ok(table?.id, "Unknown protected table " + name);
        values[name] = plain(await db.select().from(table)
          .where(eq(name === "organizations" ? table.id : table.organizationId, orgId))
          .orderBy(asc(table.id)));
      }
      return values;
    }
    // No negative request is allowed to modify the actor OR the victim.
    async function deny(method, cookie, body, status, label, actors, protectedEmployers) {
      const baselines = await Promise.all(protectedEmployers.map(actor => snapshot(actor.org.id)));
      const response = await http(method, cookie, body);
      assertDeniedCaseMutation(response, status, actors, label);
      for (let i = 0; i < protectedEmployers.length; i++) {
        assertForeignSqlUnchanged(baselines[i], await snapshot(protectedEmployers[i].org.id),
          label + " / " + protectedEmployers[i].label);
      }
      deniedWrites++;
    }
    const fillers = [];
    for (let i = 1; i <= 7; i++) {
      const filler = await makeEmployer("FILL" + i);
      await makeCase(filler, "general");
      fillers.push(filler);
    }
    const a = await makeEmployer("ATTA");
    const b = await makeEmployer("ATTB");
    const victim = await makeEmployer("VICTIM");
    const actors = [a, b, victim];
    for (const actor of actors) {
      actor.cases.hr = await makeCase(actor, "general");
      actor.cases.payroll = await makeCase(actor, "payslip_correction");
      actor.cases.coe = await makeCase(actor, "coe");
    }
    for (const field of ["org", "entity", "unit", "worker", "owner"]) {
      assert.ok(victim[field].id > Math.max(a[field].id, b[field].id, 6),
        "Victim " + field + " must be genuine higher-ID fixture");
    }
    assert.ok(victim.cases.hr.id > Math.max(a.cases.hr.id, b.cases.hr.id, 6));
    assert.equal(new Set(actors.map(actor => actor.cookie)).size, 3);

    // Successful real staff writes MUST persist in the correct organization's
    // cases, messages and audit events before denials can count as isolation.
    for (const actor of [a, b]) {
      const original = actor.cases.hr;
      const reply = actor.marker + " real owner reply";
      const result = await http("PATCH", actor.cookie,
        { id: original.id, action: "reply", message: reply });
      assertOwnCasePatch(result, original.id, actor.org.id);
      const [message] = await db.select().from(s.employeeHrCaseMessages).where(and(
        eq(s.employeeHrCaseMessages.organizationId, actor.org.id),
        eq(s.employeeHrCaseMessages.caseId, original.id),
        eq(s.employeeHrCaseMessages.body, reply),
      )).limit(1);
      assert.equal(message?.visibility, "employee", "Own PATCH must persist employee-visible message");
      const [audit] = await db.select().from(s.auditEvents).where(and(
        eq(s.auditEvents.organizationId, actor.org.id),
        eq(s.auditEvents.action, "HR case reply"),
        eq(s.auditEvents.resource, String(original.id)),
      )).limit(1);
      assert.ok(audit, "Real own PATCH audit event missing");
      positiveWrites++;

      const statusResult = await http("PATCH", actor.cookie,
        { id: original.id, action: "status", status: "in_progress" });
      assertOwnCasePatch(statusResult, original.id, actor.org.id);
      const [stored] = await db.select().from(s.employeeHrCases).where(
        eq(s.employeeHrCases.id, original.id)).limit(1);
      assert.equal(stored?.status, "in_progress", "Real status update not persisted");
      positiveWrites++;
    }

    // Each actor attempts real foreign case IDs: reply, private note,
    // status change and disabled-vault COE approval. Every denial is 404
    // and the entire protected employer/attacker SQL snapshot is unchanged.
    for (const actor of [a, b]) {
      for (const target of actors.filter(other => other !== actor)) {
        for (const item of [
          { id: target.cases.hr.id, action: "reply", message: actor.marker + " foreign reply" },
          { id: target.cases.hr.id, action: "internal_note", message: actor.marker + " foreign note" },
          { id: target.cases.hr.id, action: "status", status: "resolved" },
          { id: target.cases.coe.id, action: "approve_coe" },
        ]) {
          await deny("PATCH", actor.cookie, item, 404,
            actor.label + " -> " + target.label + " " + item.action,
            actors, [actor, target]);
          crossEmployerDenials++;
        }
      }
    }
    // The document vault is strictly disabled in this test environment.
    // Even a valid own COE action must not issue a document.
    for (const actor of [a, b]) {
      await deny("PATCH", actor.cookie,
        { id: actor.cases.coe.id, action: "approve_coe" }, 503,
        actor.label + " own COE vault disabled", actors, [actor, victim]);
    }

    async function employeeLogin(actor) {
      const [user] = await db.insert(s.users).values({
        email: "hr-case-employee-" + actor.label.toLowerCase() + "-" + nonce + "@example.invalid",
        name: actor.marker + " linked employee", passwordHash: "fictional-only",
        role: "employee", employeeId: actor.worker.id,
      }).returning();
      await db.insert(s.userOrganizations).values({
        organizationId: actor.org.id, userId: user.id, role: "employee", active: true,
      });
      const session = await fixture.standaloneMakeSession(user.id);
      return { user, cookie: session.cookie };
    }
    const employeesByActor = new Map();
    for (const actor of [a, b]) {
      const employee = await employeeLogin(actor);
      employeesByActor.set(actor.label, employee);
      // Deliberately forged employer/employee body selectors must be ignored.
      // The created row must use the signed-in employee's actual link.
      const created = await http("POST", employee.cookie, {
        organizationId: victim.org.id, employeeId: victim.worker.id,
        caseType: "general", subject: actor.marker + " genuine HR question",
        description: actor.marker + " fictional employee description with enough detail",
      });
      const id = assertCreatedEmployeeCase(created, actor, employee.user.id, "general");
      const [stored] = await db.select().from(s.employeeHrCases)
        .where(eq(s.employeeHrCases.id, id)).limit(1);
      assert.equal(stored?.organizationId, actor.org.id);
      assert.equal(stored?.employeeId, actor.worker.id);
      const [submissionAudit] = await db.select().from(s.auditEvents).where(and(
        eq(s.auditEvents.organizationId, actor.org.id),
        eq(s.auditEvents.action, "Employee HR request submitted"),
        eq(s.auditEvents.resource, String(id)),
      )).limit(1);
      assert.ok(submissionAudit, "Own employee POST audit missing");
      actor.createdCaseId = id;
      positiveWrites++;

      const reply = await http("PATCH", employee.cookie,
        { id, action: "reply", message: actor.marker + " own employee reply" });
      assertOwnCasePatch(reply, id, actor.org.id);
      const [storedReply] = await db.select().from(s.employeeHrCaseMessages).where(and(
        eq(s.employeeHrCaseMessages.organizationId, actor.org.id),
        eq(s.employeeHrCaseMessages.caseId, id),
        eq(s.employeeHrCaseMessages.body, actor.marker + " own employee reply"),
      )).limit(1);
      assert.equal(storedReply?.visibility, "employee");
      positiveWrites++;

      for (const other of actors.filter(item => item !== actor)) {
        await deny("PATCH", employee.cookie,
          { id: other.cases.hr.id, action: "reply", message: actor.marker + " foreign attempt" },
          404, actor.label + " employee foreign case " + other.label, actors, [actor, other]);
        crossEmployerDenials++;
      }
      for (const item of [
        { id, action: "internal_note", message: actor.marker + " forbidden note" },
        { id, action: "status", status: "resolved" },
        { id, action: "approve_coe" },
      ]) {
        await deny("PATCH", employee.cookie, item, 403,
          actor.label + " employee forbidden " + item.action, actors, [actor, victim]);
      }
    }
    await deny("POST", a.cookie,
      { caseType: "general", subject: "forbidden", description: "staff account case creation" },
      403, "staff cannot impersonate linked employee", actors, [a, victim]);
    await deny("PATCH", undefined,
      { id: victim.cases.hr.id, action: "reply", message: "anonymous attempt" },
      401, "anonymous foreign write", actors, [victim]);
    await deny("PATCH", a.cookie,
      { id: "not-a-case-id", action: "reply", message: "bad id" },
      422, "malformed case ID", actors, [a, victim]);

    // Cross-site origin refusal occurs before any membership or case lookup.
    const beforeOrigin = await snapshot(victim.org.id);
    const crossSite = await http("PATCH", a.cookie,
      { id: victim.cases.hr.id, action: "reply", message: "cross-origin" },
      "https://untrusted.invalid");
    assertDeniedCaseMutation(crossSite, 403, actors, "cross-site request");
    assertForeignSqlUnchanged(beforeOrigin, await snapshot(victim.org.id),
      "cross-site refusal");
    deniedWrites++;

    // A revoked employee retains the same account login but loses the
    // employer's POST and PATCH privileges without modifying any case.
    const employeeA = employeesByActor.get(a.label);
    await db.update(s.userOrganizations).set({ active: false }).where(and(
      eq(s.userOrganizations.userId, employeeA.user.id),
      eq(s.userOrganizations.organizationId, a.org.id),
    ));
    const account = await fetch(ORIGIN + "/api/account", {
      headers: { cookie: employeeA.cookie }, cache: "no-store",
      signal: AbortSignal.timeout(25000),
    });
    assert.equal(account.status, 200, "Revoked employer membership must not destroy account login");
    await deny("POST", employeeA.cookie, {
      caseType: "general", subject: a.marker + " revoked request",
      description: a.marker + " should never create any request on revocation",
    }, 403, "revoked employee POST", actors, [a, victim]);
    await deny("PATCH", employeeA.cookie, {
      id: a.createdCaseId, action: "reply", message: a.marker + " revoked reply",
    }, 404, "revoked employee PATCH", actors, [a, victim]);

    assert.equal(positiveWrites, 8, "Expected real owner and employee writes for A/B");
    assert.equal(crossEmployerDenials, 20, "All cross-employer actions must be exercised");
    assert.ok(deniedWrites >= 31, "Expected broad API negative controls");
    console.log(JSON.stringify({
      family: "hr-cases-post-patch-write-isolation", fictionalPg16: true,
      exactSourcePins: true, featureOnOnlyInDisposableCi: true,
      attackers: 2, genuineHigherIdVictim: true,
      ownedPersistedWrites: positiveWrites, foreignCaseDenials: crossEmployerDenials,
      deniedWriteRequests: deniedWrites, forgedPostSelectorsBoundToSession: true,
      employeeStaffActionDenied: true, revokedEmployeeWritesDenied: true,
      coeDocumentVaultDisabled: true, externalProviderCalls: 0,
      victimAndAttackerProtectedSqlUnchangedOnDenials: true,
      apiMethodCredits: 0, pageActionCredits: 0,
      independentlyAccepted: false, productionCertified: false,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("tenant-hr-cases-write-http.mjs"))
  await proveHrCasesWriteIsolation();
