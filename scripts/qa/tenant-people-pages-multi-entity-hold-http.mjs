/**
 * Exact-head, fictional PG16 HTTP check for the global multi-entity HCM hold.
 * This only tests /app/engagement and /app/goals-reviews. It grants zero
 * tenant-isolation page/action credits and cannot authorize production use.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  PEOPLE_PAGE_ORIGIN, assertNoOtherEmployerMarkers,
  requireDisposablePeoplePagesEnv,
} from "./tenant-people-pages-contract.mjs";

function requireMultiEntityHoldProofEnv(env = process.env) {
  // Fail closed before importing application modules or opening PostgreSQL.
  requireDisposablePeoplePagesEnv(env);
  assert.equal(env.MULTI_ENTITY_ENABLED, "true",
    "PEOPLE_HOLD_REFUSED: exact multi-entity enabled flag required");
  assert.equal(env.SECURITY_SMOKE_URL, PEOPLE_PAGE_ORIGIN,
    "PEOPLE_HOLD_REFUSED: localhost HTTP only");
  for (const key of [
    "PAYMONGO_WEBHOOK_SECRET", "XENDIT_PAYOUT_SECRET_KEY", "STRIPE_SECRET_KEY",
    "POSTMARK_SERVER_TOKEN", "SMTP_PASSWORD", "SMTP_URL",
  ]) {
    assert.ok(!env[key], "PEOPLE_HOLD_REFUSED: provider credential " + key);
  }
}

async function readLocal(path, cookie, rsc = false) {
  assert.ok(path.startsWith("/app/engagement") ||
    path.startsWith("/app/goals-reviews"),
    "PEOPLE_HOLD_REFUSED: no unrelated HTTP requests");
  const headers = { ...(cookie ? { cookie } : {}), ...(rsc ? { RSC: "1" } : {}) };
  const response = await fetch(PEOPLE_PAGE_ORIGIN + path, {
    method: "GET", headers, redirect: "manual", cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  return { status: response.status, text: await response.text() };
}

function assertHeld(response, subjects, context) {
  assert.equal(response.status, 404, context + ": feature-ON must return a real 404");
  assertNoOtherEmployerMarkers(response.text, subjects, context + " HTML/RSC");
}

export async function verifyPeopleMultiEntityHold() {
  requireMultiEntityHoldProofEnv();
  const [{ db, pool }, s, { and, asc, eq }, fixtures] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  try {
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const subjects = [];
    for (const label of ["ATTA", "ATTB", "VICTIM"]) {
      const actor = { ...(await fixtures.seedEmployer(label, nonce,
        fixtures.standaloneMakeSession)), label };
      await db.insert(s.performanceCycles).values({
        organizationId: actor.org.id, name: actor.marker + " review cycle",
        startDate: "2026-10-01", endDate: "2026-12-31",
        createdByUserId: actor.owner.id, createdBy: actor.owner.name,
      });
      await db.insert(s.engagementSurveys).values({
        organizationId: actor.org.id,
        question: actor.marker + " How is your work experience?",
        status: "closed", createdByUserId: actor.owner.id,
      });
      subjects.push(actor);
    }
    const [a, b, victim] = subjects;
    assert.equal(new Set(subjects.map(x => x.org.id)).size, 3);
    assert.equal(new Set(subjects.map(x => x.cookie)).size, 3);
    for (const actor of [a, b]) {
      assert.ok(victim.org.id > actor.org.id,
        "The victim must have a real higher persisted employer ID");
    }

    const [unitOnly] = await db.insert(s.users).values({
      email: "hold-unit-" + nonce + "@example.invalid",
      name: "Fictional unit-only HR", passwordHash: "fictional-session-only",
      role: "owner",
    }).returning({ id: s.users.id });
    await db.insert(s.userOrganizations).values({
      userId: unitOnly.id, organizationId: a.org.id,
      role: "hr", orgUnitId: a.unit.id, active: true,
    });
    const unitSession = await fixtures.standaloneMakeSession(unitOnly.id);

    // Keep the revoked owner session alive. Snapshot after the deliberate
    // revocation, so subsequent HTTP reads must not mutate any fixture rows.
    const revoked = await db.update(s.userOrganizations).set({ active: false })
      .where(and(eq(s.userOrganizations.userId, victim.owner.id),
        eq(s.userOrganizations.organizationId, victim.org.id),
        eq(s.userOrganizations.active, true)))
      .returning({ id: s.userOrganizations.id });
    assert.equal(revoked.length, 1);

    const protectedTables = [
      "organizations", "legalEntities", "orgUnits", "employees",
      "employeePayProfiles", "performanceCycles", "engagementSurveys",
      "userOrganizations", "auditEvents", "payrollRuns",
    ];
    async function snapshot(orgId) {
      const result = {};
      for (const name of protectedTables) {
        const table = s[name];
        assert.ok(table?.id, "Persisted fixture table missing: " + name);
        result[name] = await db.select().from(table)
          .where(name === "organizations" ?
            eq(table.id, orgId) : eq(table.organizationId, orgId))
          .orderBy(asc(table.id));
      }
      return JSON.parse(JSON.stringify(result));
    }
    const before = new Map(await Promise.all(subjects.map(async actor =>
      [actor.org.id, await snapshot(actor.org.id)])));

    let denials = 0;
    async function mustDeny(path, cookie, context, rsc = false) {
      assertHeld(await readLocal(path, cookie, rsc), subjects, context);
      denials++;
    }
    for (const actor of [a, b]) {
      for (const page of ["/app/engagement", "/app/goals-reviews"]) {
        await mustDeny(page + "?organizationId=" + actor.org.id,
          actor.cookie, actor.label + " own authorized " + page);
        await mustDeny(page, actor.cookie,
          actor.label + " no-selector " + page);
        await mustDeny(page + "?organizationId=" + victim.org.id,
          actor.cookie, actor.label + " foreign " + page);
        await mustDeny(page + "?organizationId=" + actor.org.id +
          "&organizationId=" + actor.org.id, actor.cookie,
          actor.label + " duplicate " + page);
        for (const invalid of ["0", "01", "bad", "9007199254740992"]) {
          await mustDeny(page + "?organizationId=" + invalid,
            actor.cookie, actor.label + " malformed " + page);
        }
        await mustDeny(page + "?organizationId=" + actor.org.id,
          actor.cookie, actor.label + " RSC " + page, true);
      }
    }
    for (const page of ["/app/engagement", "/app/goals-reviews"]) {
      await mustDeny(page + "?organizationId=" + a.org.id,
        undefined, "anonymous feature-ON " + page);
      await mustDeny(page + "?organizationId=" + a.org.id,
        unitSession.cookie, "unit-only HR feature-ON " + page);
      await mustDeny(page + "?organizationId=" + victim.org.id,
        victim.cookie, "revoked-session feature-ON " + page);
    }
    for (const actor of subjects) {
      assert.deepEqual(await snapshot(actor.org.id), before.get(actor.org.id),
        "Feature-ON SSR reads changed private, payroll or audit rows: " + actor.label);
    }
    const result = {
      kind: "PEOPLE_MULTI_ENTITY_HOLD_FICTIONAL_PG16_HTTP",
      feature: "MULTI_ENTITY_ENABLED=true",
      employers: 3, authenticatedOwnerEmployers: 2,
      deniedHtmlAndRscRequests: denials,
      unitOnlyHrDenied: true, revokedSessionDenied: true,
      employerAndPayrollAuditRowsUnchanged: true,
      pageCredits: 0, methodCredits: 0, productionCertified: false,
    };
    console.log("PEOPLE_MULTI_ENTITY_HOLD_COMPLETE " + JSON.stringify(result));
    return result;
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith(
  "tenant-people-pages-multi-entity-hold-http.mjs")) {
  verifyPeopleMultiEntityHold().catch(error => {
    console.error("PEOPLE_MULTI_ENTITY_HOLD_FAILED " +
      (error instanceof Error ? error.stack : String(error)));
    process.exitCode = 1;
  });
}
