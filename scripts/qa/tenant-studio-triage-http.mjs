/**
 * Independent Automation Studio operational-case acknowledgement isolation.
 * Two authenticated employer owners, one real higher-ID victim, and real
 * authoritative attendance-event sources in disposable PG16 only.
 *
 * This is one narrow POST action, NOT full Automation Studio POST coverage.
 * No workflow execution, retry, publication, payment or external provider.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  STUDIO_TRIAGE_ORIGIN, STUDIO_TRIAGE_ROUTE, STUDIO_TRIAGE_ROUTE_SHA,
  gitBlobSha, requireDisposableStudioTriageEnv, assertNoTenantMarkers,
  assertOwnedCaseAck, assertDeniedTriage, assertUnchangedSnapshot,
  assertOwnAcknowledgementDelta,
} from "./tenant-studio-triage-contract.mjs";

const plain = value => JSON.parse(JSON.stringify(value));

async function postTriage(actor, body, options = {}) {
  const override = options.cookie;
  const headers = {
    "content-type": "application/json",
    origin: options.origin ?? STUDIO_TRIAGE_ORIGIN,
    "sec-fetch-site": options.fetchSite ?? "same-origin",
    ...(override === null ? {} : { cookie: override ?? actor.cookie }),
  };
  const response = await fetch(STUDIO_TRIAGE_ORIGIN + STUDIO_TRIAGE_ROUTE, {
    method: "POST", headers, body: JSON.stringify(body), redirect: "manual",
    cache: "no-store", signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* Failure assertions reject fake results. */ }
  return { status: response.status, text, json };
}

const acknowledge = (organizationId, caseId, note = "Fictional operator reviewed the assigned manual case.") => ({
  organizationId, caseId, action: "triage-operational-case",
  transition: "acknowledge", note,
});

export async function proveStudioCaseTriageIsolation() {
  // Guard first, BEFORE importing any app, DB, fixture or token-handling code.
  requireDisposableStudioTriageEnv();

  const reviewedRoute = readFileSync(new URL("../../src/app/api/automation-studio/route.ts", import.meta.url));
  assert.equal(gitBlobSha(reviewedRoute), STUDIO_TRIAGE_ROUTE_SHA,
    "STUDIO_TRIAGE_REFUSED: route changed without renewed source and HTTP review");
  const route = reviewedRoute.toString("utf8");
  for (const required of [
    'if (action === "triage-operational-case")',
    "assertStudioAdmin(user.id, organizationId)",
    "requireSensitiveActionMfa(user)",
    "enforceSensitiveActionRateLimit(request",
    "eq(automationOperationalCases.id, caseId)",
    "eq(automationOperationalCases.organizationId, organizationId)",
    "eq(automationOperationalCases.status, expected)",
    "tx.insert(auditEvents)",
    "sourceMutation: false",
    "executionStatusUnchanged: true",
  ]) assert.ok(route.includes(required), "Missing reviewed tenant gate: " + required);

  const [{ db, pool }, s, orm, fixtures] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const { asc, eq } = orm;
  const protectedTables = [
    "organizations", "userOrganizations", "employees", "employeePayProfiles",
    "attendanceExceptionEvents", "automationOperationalCases", "automationRules",
    "automationExecutions", "payrollRuns", "outbox", "auditEvents",
  ];

  async function snapshot(orgId) {
    const result = {};
    for (const tableName of protectedTables) {
      const table = s[tableName];
      assert.ok(table?.id, "Missing tracked schema table: " + tableName);
      const column = tableName === "organizations" ? table.id : table.organizationId;
      assert.ok(column, "Tracked table must be employer scoped: " + tableName);
      result[tableName] = plain(await db.select().from(table)
        .where(eq(column, orgId)).orderBy(asc(table.id)));
    }
    return result;
  }

  let ownSuccess = 0, foreignDenials = 0, negativeChecks = 0;
  try {
    const pgVersion = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(pgVersion >= 160000 && pgVersion < 170000,
      "STUDIO_TRIAGE_REFUSED: fresh disposable PostgreSQL 16 required");
    assert.equal((await db.select().from(s.organizations).limit(1)).length, 0,
      "STUDIO_TRIAGE_REFUSED: app_db must start empty");
    assert.equal((await db.select().from(s.users).limit(1)).length, 0,
      "STUDIO_TRIAGE_REFUSED: user fixtures must start empty");

    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const subjects = [];
    for (const label of ["ATTA", "ATTB", "VICTIM"]) {
      const actor = { ...(await fixtures.seedEmployer(label, nonce,
        fixtures.standaloneMakeSession)), label };
      const [source] = await db.insert(s.attendanceExceptionEvents).values({
        organizationId: actor.org.id, employeeId: actor.worker.id,
        workDate: "2026-10-15", exceptionKind: "missing_punch", severity: "warning",
        message: actor.marker + " fictional attendance anomaly for manual review",
        fingerprintSha256: createHash("sha256")
          .update(actor.marker + "-frozen-source").digest("hex"),
        status: "open", ownerUserId: actor.owner.id,
      }).returning();
      const [caseRow] = await db.insert(s.automationOperationalCases).values({
        organizationId: actor.org.id,
        caseType: "attendance_resolution", sourceType: "attendance_exception_event",
        sourceId: source.id, sourceVersion: 1,
        employeeId: actor.worker.id, ownerTeam: "people-ops",
        assignedOwnerUserId: actor.owner.id,
        title: actor.marker + " attendance review case",
        detail: actor.marker + " fictional manual triage; no source mutation",
        status: "open",
      }).returning();
      actor.source = source;
      actor.case = caseRow;
      subjects.push(actor);
    }
    const [a, b, victim] = subjects;
    assert.equal(new Set(subjects.map(x => x.cookie)).size, 3);
    assert.equal(new Set(subjects.map(x => x.org.id)).size, 3);
    for (const field of ["org", "owner", "worker", "source", "case"]) {
      assert.ok(victim[field].id > a[field].id && victim[field].id > b[field].id,
        "A real victim-only " + field + " ID must exceed both attackers");
    }

    const baseline = new Map();
    for (const actor of subjects) baseline.set(actor.org.id, await snapshot(actor.org.id));
    const checkAllUnchanged = async context => {
      for (const actor of subjects) {
        assertUnchangedSnapshot(baseline.get(actor.org.id),
          await snapshot(actor.org.id), context + ": " + actor.label);
      }
    };
    const checkDenied = async (actor, body, status, context, options) => {
      const denied = await postTriage(actor, body, options);
      assertDeniedTriage(denied, status, subjects, context);
      await checkAllUnchanged(context);
      negativeChecks += 1;
      return denied;
    };

    for (const actor of [a, b]) {
      const other = actor === a ? b : a;
      const account = await fetch(STUDIO_TRIAGE_ORIGIN + "/api/account", {
        headers: { cookie: actor.cookie }, redirect: "manual",
        cache: "no-store", signal: AbortSignal.timeout(30000),
      });
      assert.equal(account.status, 200, "Actual signed-in owner session required");
      assert.equal((await account.json()).profile.id, actor.owner.id);

      const before = await snapshot(actor.org.id);
      const own = await postTriage(actor, acknowledge(actor.org.id, actor.case.id));
      assertOwnedCaseAck(own, actor, subjects.filter(x => x !== actor));
      const after = await snapshot(actor.org.id);
      assertOwnAcknowledgementDelta(before, after, actor);
      baseline.set(actor.org.id, after);
      ownSuccess += 1;
      await checkAllUnchanged("own acknowledgement changed only one employer");

      // Different victim-org selector: denied before a private case lookup.
      await checkDenied(actor, acknowledge(victim.org.id, victim.case.id), 403,
        actor.label + " foreign employer request");
      foreignDenials += 1;
      // Even with the owned organization selector, a real foreign case ID
      // must be hidden; no audit, status or authoritative source changes.
      await checkDenied(actor, acknowledge(actor.org.id, victim.case.id), 404,
        actor.label + " real victim case ID substitution");
      foreignDenials += 1;
      await checkDenied(actor, acknowledge(actor.org.id, other.case.id), 404,
        actor.label + " other attacker case ID substitution");
      await checkDenied(actor, acknowledge(actor.org.id, actor.case.id), 409,
        actor.label + " duplicate acknowledge must fail closed");
      await checkDenied(actor, acknowledge(actor.org.id, "not-an-integer"), 400,
        actor.label + " malformed case identifier");
      await checkDenied(actor, acknowledge(actor.org.id, actor.case.id, "short"), 400,
        actor.label + " missing evidence note");
    }

    async function scopedSession(role, orgUnitId, totpEnabled = true) {
      const [account] = await db.insert(s.users).values({
        email: "studio-triage-" + role + "-" + (orgUnitId ?? "company") + "-" + nonce + "@example.invalid",
        name: "Fictional " + role + " studio triage",
        passwordHash: "fictional-no-login", role: "owner", totpEnabled,
      }).returning();
      await db.insert(s.userOrganizations).values({
        organizationId: a.org.id, userId: account.id, role, orgUnitId, active: true,
      });
      const session = await fixtures.standaloneMakeSession(account.id);
      if (totpEnabled) await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
        .where(eq(s.sessions.id, session.id));
      return { cookie: session.cookie, account };
    }
    const unitBookkeeper = await scopedSession("bookkeeper", a.unit.id);
    const companyHr = await scopedSession("hr", null);
    const noMfaOwner = await scopedSession("owner", null, false);
    // Role/MFA fixture inserts are intentional, not proof of an action write.
    baseline.set(a.org.id, await snapshot(a.org.id));
    await checkDenied(a, acknowledge(a.org.id, a.case.id), 403,
      "unit-only bookkeeper denied", { cookie: unitBookkeeper.cookie });
    await checkDenied(a, acknowledge(a.org.id, a.case.id), 403,
      "company HR outside Studio admin roles denied", { cookie: companyHr.cookie });
    await checkDenied(a, acknowledge(a.org.id, a.case.id), 403,
      "owner with no MFA denied", { cookie: noMfaOwner.cookie });
    await checkDenied(a, acknowledge(a.org.id, a.case.id), 401,
      "anonymous POST denied", { cookie: null });
    await checkDenied(a, acknowledge(a.org.id, a.case.id), 403,
      "cross-site POST denied", { origin: "https://attacker.invalid", fetchSite: "cross-site" });

    const [revoked] = await db.update(s.userOrganizations).set({ active: false })
      .where(orm.and(eq(s.userOrganizations.userId, a.owner.id),
        eq(s.userOrganizations.organizationId, a.org.id)))
      .returning();
    assert.equal(revoked?.userId, a.owner.id, "Exactly one real owner grant revoked");
    baseline.set(a.org.id, await snapshot(a.org.id));
    const stillAuthenticated = await fetch(STUDIO_TRIAGE_ORIGIN + "/api/account", {
      headers: { cookie: a.cookie }, redirect: "manual", cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(stillAuthenticated.status, 200,
      "Membership revocation must not be confused with session logout");
    await checkDenied(a, acknowledge(a.org.id, a.case.id), 403,
      "revoked membership denies original signed-in owner");

    assert.equal(ownSuccess, 2, "Both independent legitimate own POST requests must succeed");
    assert.equal(foreignDenials, 4, "Two attackers must get org and victim-case denial");
    assert.equal(negativeChecks, 18, "All independent negative controls must execute");
    assertNoTenantMarkers({ text: "No customer data is included." }, subjects, "baseline negative control");
    await checkAllUnchanged("final SQL invariants");
    console.log(JSON.stringify({ family: "automation-studio-case-triage-acknowledge",
      fictionalPG16: true, ownSuccess, foreignDenials, negativeChecks,
      realAuthoritativeSources: 3, twoIndependentOwners: true,
      higherIdVictim: true, exactlyOneAuditPerOwnAck: true,
      readOnlyAuthoritativeSources: true, liveProviders: 0,
      methodCoverageCredits: 0, wholePostCertified: false,
      independentlyAccepted: false, productionCertified: false }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("tenant-studio-triage-http.mjs")) {
  await proveStudioCaseTriageIsolation();
}
