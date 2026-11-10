/** Independent resolve/reopen evidence. No execution, retry, publish or money. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  ORIGIN, ROUTE, SOURCE_BLOBS, requireDisposableResolutionEnv, verifyResolutionSources,
  assertDenied, assertUnchanged, assertAuditRollback, assertHigherVictim, assertOwnedTransition,
} from "./tenant-studio-resolution-contract.mjs";

const plain = value => JSON.parse(JSON.stringify(value));
const NOTE = "Fictional operator reviewed the authoritative attendance resolution evidence.";
const ABSENT_ID = 2147483646;
const ARTIFACT = "qa-artifacts/tenant-studio-resolution-receipt.json";
const TABLES = [
  "organizations", "legalEntities", "orgUnits", "users", "userOrganizations",
  "employees", "employeePayProfiles", "attendanceExceptionEvents", "automationOperationalCases",
  "automationRules", "automationRuleVersions", "automationEventLog", "automationExecutions",
  "payrollRuns", "payrollEntries", "outbox", "auditEvents",
];
async function post(actor, transition, body = {}, options = {}) {
  const response = await fetch(ORIGIN + ROUTE, {
    method: "POST", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30000),
    headers: {
      "content-type": "application/json", origin: options.origin ?? ORIGIN,
      "sec-fetch-site": options.fetchSite ?? "same-origin",
      ...(options.cookie === null ? {} : { cookie: options.cookie ?? actor.cookie }),
    },
    body: JSON.stringify({ organizationId: actor.org.id, caseId: actor.case.id, note: NOTE,
      ...body, action: "triage-operational-case", transition }),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* denial oracle accepts a framework 500 */ }
  return { status: response.status, text, json };
}
async function assertSignedIn(actor) {
  const response = await fetch(ORIGIN + "/api/account", {
    headers: { cookie: actor.cookie }, redirect: "manual", cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200, "same real session must remain authenticated");
  assert.equal((await response.json()).profile.id, actor.owner.id);
}
export async function proveStudioResolution() {
  requireDisposableResolutionEnv();
  verifyResolutionSources(); // both guards precede ALL application and DB imports
  const [{ db, pool }, s, { and, asc, eq }, fixtures] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("drizzle-orm"), import("./tenant-table-http.mjs"),
  ]);
  let ownSuccess = 0, negativeChecks = 0, foreignDenials = 0, auditRollbacks = 0;
  let cleanupAuthorized = false;
  const snapshot = async () => Object.fromEntries(await Promise.all(TABLES.map(async name => {
    assert.ok(s[name]?.id, "missing protected table " + name);
    return [name, plain(await db.select().from(s[name]).orderBy(asc(s[name].id)))];
  })));
  try {
    const version = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(version >= 160000 && version < 170000, "disposable PostgreSQL 16 required");
    const empty = await snapshot();
    for (const [table, rows] of Object.entries(empty))
      assert.equal(rows.length, 0, "fixture refuses nonempty business table " + table);
    cleanupAuthorized = true;
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    async function seed(label, resolved = false) {
      const actor = await fixtures.seedEmployer(label, nonce, fixtures.standaloneMakeSession);
      [actor.membership] = await db.select().from(s.userOrganizations).where(and(
        eq(s.userOrganizations.organizationId, actor.org.id), eq(s.userOrganizations.userId, actor.owner.id)));
      [actor.profile] = await db.select().from(s.employeePayProfiles).where(eq(s.employeePayProfiles.employeeId, actor.worker.id));
      [actor.source] = await db.insert(s.attendanceExceptionEvents).values({
        organizationId: actor.org.id, employeeId: actor.worker.id, workDate: "2026-10-15",
        exceptionKind: "missing_punch", severity: "warning", ownerUserId: actor.owner.id,
        message: actor.marker + " fictional authoritative attendance record",
        fingerprintSha256: createHash("sha256").update(actor.marker).digest("hex"),
        status: resolved ? "resolved" : "open",
      }).returning();
      [actor.case] = await db.insert(s.automationOperationalCases).values({
        organizationId: actor.org.id, caseType: "attendance_resolution", sourceType: "attendance_exception",
        sourceId: actor.source.id, employeeId: actor.worker.id, ownerTeam: "People Operations",
        assignedOwnerUserId: actor.owner.id, title: actor.marker + " resolution review",
        detail: actor.marker + " fictional case, never automation execution",
        status: "acknowledged", acknowledgedByUserId: actor.owner.id,
        acknowledgedByName: actor.owner.name, acknowledgedAt: new Date(),
      }).returning();
      [actor.payroll] = await db.insert(s.payrollRuns).values({
        organizationId: actor.org.id, legalEntityId: actor.entity.id,
        periodLabel: actor.marker + " inert payroll", periodStart: "2026-10-01", periodEnd: "2026-10-15",
        payDate: "2026-10-15", scopeLabel: "All locations", status: "Draft",
      }).returning();
      await db.insert(s.auditEvents).values({
        organizationId: actor.org.id, actor: "Fictional fixture",
        action: "Studio resolution fixture seeded", resource: actor.marker, metadata: { fictionalOnly: true },
      });
      return actor;
    }
    const a = await seed("RSVA"), b = await seed("RSVB");
    for (let index = 0; index < 7; index++) await seed("RSVF" + index);
    const victim = await seed("RSVV", true);
    const actors = [a, b, victim];
    assertHigherVictim([a, b], victim);
    assert.equal(new Set(actors.map(actor => actor.cookie)).size, 3);
    assert.equal((await db.select().from(s.automationOperationalCases).where(eq(s.automationOperationalCases.id, ABSENT_ID))).length, 0);
    assert.equal((await db.select().from(s.attendanceExceptionEvents).where(eq(s.attendanceExceptionEvents.id, ABSENT_ID))).length, 0);

    async function deny(actor, transition, body, status, label, options) {
      const before = await snapshot();
      const response = await post(actor, transition, body, options);
      assertDenied(response, status, actors, label);
      assertUnchanged(before, await snapshot(), label);
      negativeChecks++;
      return response;
    }
    async function success(actor, transition) {
      const before = await snapshot();
      const response = await post(actor, transition);
      assertOwnedTransition(response, before, await snapshot(), actor, transition, NOTE,
        actors.filter(other => other !== actor));
      ownSuccess++;
    }
    // The sequence is deliberately nontransactional: an HTTP 500 alone is NOT
    // evidence that the audit insert was reached and its case update rolled back.
    await pool.query("CREATE SEQUENCE qa_studio_resolution_veto_hits START WITH 1");
    await pool.query(`CREATE FUNCTION qa_studio_resolution_veto() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action IN ('Automation operations case resolve', 'Automation operations case reopen') THEN
          PERFORM nextval('qa_studio_resolution_veto_hits');
          RAISE EXCEPTION 'FICTIONAL_STUDIO_RESOLUTION_AUDIT_VETO';
        END IF;
        RETURN NEW;
      END; $$`);
    async function veto(actor, transition) {
      const hits = async () => {
        const row = (await pool.query("SELECT last_value, is_called FROM qa_studio_resolution_veto_hits")).rows[0];
        return row.is_called ? Number(row.last_value) : 0;
      };
      const before = await snapshot(), priorHits = await hits();
      await pool.query("CREATE TRIGGER zz_qa_studio_resolution_veto BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION qa_studio_resolution_veto()");
      try {
        const response = await post(actor, transition);
        assertDenied(response, 500, actors, "injected audit veto " + transition);
        assertAuditRollback(before, await snapshot(), priorHits, await hits());
        auditRollbacks++;
      } finally {
        await pool.query("DROP TRIGGER IF EXISTS zz_qa_studio_resolution_veto ON audit_events");
      }
    }
    for (const actor of [a, b]) {
      await assertSignedIn(actor);
      const peer = actor === a ? b : a;
      for (const transition of ["resolve", "reopen"]) {
        await deny(actor, transition, { organizationId: victim.org.id, caseId: victim.case.id }, 403, "foreign employer");
        const foreign = await deny(actor, transition, { caseId: victim.case.id }, 404, "own employer with foreign case");
        await deny(actor, transition, { caseId: peer.case.id }, 404, "peer case substitution");
        foreignDenials += 3;
        const absent = await deny(actor, transition, { caseId: ABSENT_ID }, 404, "nonexistent case");
        assert.deepEqual(foreign.json, absent.json, "foreign and nonexistent case must be indistinguishable");
        await deny(actor, transition, { caseId: 0 }, 400, "invalid case ID");
        await deny(actor, transition, { note: "too short" }, 400, "short evidence note");
        await deny(actor, transition, { note: "x".repeat(2001) }, 400, "oversized evidence note");
      }
      await deny(actor, "reopen", {}, 409, "acknowledged case cannot reopen");
      await deny(actor, "resolve", {}, 409, "underlying source still open");
      // A caller cannot use a resolved source belonging to another employer.
      for (const sourceId of [victim.source.id, ABSENT_ID]) {
        const beforeFixture = await snapshot();
        await db.update(s.automationOperationalCases).set({ sourceId }).where(eq(s.automationOperationalCases.id, actor.case.id));
        try { await deny(actor, "resolve", {}, 409, "foreign or missing authoritative source"); }
        finally {
          await db.update(s.automationOperationalCases).set({ sourceId: actor.source.id }).where(eq(s.automationOperationalCases.id, actor.case.id));
        }
        assertUnchanged(beforeFixture, await snapshot(), "restore deliberate source-link fixture");
      }
      await db.update(s.automationOperationalCases).set({ status: "open" }).where(eq(s.automationOperationalCases.id, actor.case.id));
      await deny(actor, "resolve", {}, 409, "unacknowledged case cannot resolve");
      await db.update(s.automationOperationalCases).set({ status: "acknowledged" }).where(eq(s.automationOperationalCases.id, actor.case.id));
      // Fixture-only stand-in for an already-governed attendance resolution.
      // The Studio request itself must never perform this source update.
      await db.update(s.attendanceExceptionEvents).set({ status: "resolved" }).where(eq(s.attendanceExceptionEvents.id, actor.source.id));
      await veto(actor, "resolve");
      await success(actor, "resolve");
      await deny(actor, "resolve", {}, 409, "duplicate resolve");
      await veto(actor, "reopen");
      await success(actor, "reopen");
      await deny(actor, "reopen", {}, 409, "duplicate reopen");
      await deny(actor, "resolve", {}, 409, "reopened case requires acknowledgement again");
    }
    async function restrictedSession(role, orgUnitId, mfa = true) {
      const [account] = await db.insert(s.users).values({
        email: "resolution-" + role + "-" + mfa + "-" + nonce + "@example.invalid",
        name: "Fictional restricted Studio operator", passwordHash: "fictional-no-login", role: "owner", totpEnabled: mfa,
      }).returning();
      await db.insert(s.userOrganizations).values({ organizationId: a.org.id, userId: account.id, role, orgUnitId, active: true });
      const session = await fixtures.standaloneMakeSession(account.id);
      if (mfa) await db.update(s.sessions).set({ mfaVerifiedAt: new Date() }).where(eq(s.sessions.id, session.id));
      return session.cookie;
    }
    const hr = await restrictedSession("hr", null);
    const scoped = await restrictedSession("bookkeeper", a.unit.id);
    const noMfa = await restrictedSession("owner", null, false);
    for (const transition of ["resolve", "reopen"]) {
      // Make the business action otherwise eligible so access refusals are not
      // confused with an invalid business-state failure.
      await db.update(s.automationOperationalCases).set({ status: transition === "resolve" ? "acknowledged" : "resolved" })
        .where(eq(s.automationOperationalCases.id, a.case.id));
      await deny(a, transition, {}, 403, "HR role", { cookie: hr });
      await deny(a, transition, {}, 403, "unit-scoped bookkeeper", { cookie: scoped });
      await deny(a, transition, {}, 403, "owner missing MFA", { cookie: noMfa });
      await deny(a, transition, {}, 401, "anonymous", { cookie: null });
      await deny(a, transition, {}, 403, "cross-site", { origin: "https://attacker.invalid", fetchSite: "cross-site" });
    }
    const [revoked] = await db.update(s.userOrganizations).set({ active: false }).where(eq(s.userOrganizations.id, a.membership.id)).returning();
    assert.equal(revoked.active, false);
    await assertSignedIn(a);
    for (const transition of ["resolve", "reopen"]) {
      await db.update(s.automationOperationalCases).set({ status: transition === "resolve" ? "acknowledged" : "resolved" })
        .where(eq(s.automationOperationalCases.id, a.case.id));
      await deny(a, transition, {}, 403, "revoked member with still-valid session");
    }
    assert.equal(ownSuccess, 4);
    assert.equal(foreignDenials, 12);
    assert.equal(negativeChecks, 56);
    assert.equal(auditRollbacks, 4);
    const final = await snapshot();
    for (const table of ["automationRules", "automationRuleVersions", "automationEventLog", "automationExecutions", "payrollEntries", "outbox"])
      assert.deepEqual(final[table], [], "no execution or financial side effects: " + table);
    assert.ok(final.payrollRuns.every(run => run.status === "Draft"), "no payroll release");
    const receipt = {
      family: "studio-operational-case-resolve-reopen", status: "passed",
      sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      sourceBlobs: SOURCE_BLOBS,
      proofSha256: createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex"),
      fictionalPG16: true, ownSuccess, foreignDenials, negativeChecks, auditRollbacks,
      victimBusinessIdsOverSix: true, twoIndependentOwners: true,
      sourceFamily: "attendance_resolution", protectedTables: TABLES,
      wholeMethodCredits: 0, independentlyAccepted: false, productionCertified: false,
    };
    mkdirSync("qa-artifacts", { recursive: true });
    writeFileSync(ARTIFACT, JSON.stringify(receipt, null, 2) + "\n");
    console.log(JSON.stringify(receipt));
  } finally {
    // Only dedicated disposable test objects; never alter app triggers or data.
    try {
      if (cleanupAuthorized) {
        await pool.query("DROP TRIGGER IF EXISTS zz_qa_studio_resolution_veto ON audit_events");
        await pool.query("DROP FUNCTION IF EXISTS qa_studio_resolution_veto()");
        await pool.query("DROP SEQUENCE IF EXISTS qa_studio_resolution_veto_hits");
      }
    } finally { await pool.end(); }
  }
}
if (process.argv[1]?.endsWith("tenant-studio-resolution-http.mjs")) {
  await proveStudioResolution();
}
