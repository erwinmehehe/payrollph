/**
 * Fail-closed discipline legal-employer proof: production-mode localhost Next
 * and actual disposable PostgreSQL 16; never production or a tenant credit.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const ORIGIN = "http://127.0.0.1:3000";
export function requireDisposableDisciplineEntityEnv(env = process.env) {
  for (const [key, expected] of Object.entries({
    CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
    TENANT_DISCIPLINE_ENTITY_PROOF: "fictional-pg16-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: ORIGIN, APP_BASE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN,
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
    MULTI_ENTITY_ENABLED: "true", DEMO_MODE: "false",
    REQUIRE_PRIVILEGED_MFA: "true", WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false", PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  })) assert.equal(env[key], expected, "DISCIPLINE_REFUSED: unsafe " + key);
  for (const key of [
    "NEON_DATABASE_URL", "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
    "STRIPE_SECRET_KEY", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN",
    "SMTP_PASSWORD", "SMTP_URL", "OPENAI_API_KEY", "CRON_SECRET",
    "WORKER_TOKEN", "AWS_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID",
  ]) assert.ok(!env[key], "DISCIPLINE_REFUSED: live provider " + key);
  return true;
}
function noOtherMarkers(response, subjects, label) {
  for (const subject of subjects) for (const marker of [
    subject.marker, subject.worker?.employeeNo, subject.case?.caseNumber,
    subject.case?.nteDetails,
  ].filter(Boolean)) assert.ok(!response.text.includes(marker),
    label + ": leaked foreign case or employee identifier");
}
async function request(path, cookie, method = "GET", data, extraHeaders = {}) {
  const response = await fetch(ORIGIN + path, {
    method, headers: {
      ...(cookie ? { cookie } : {}),
      ...(method === "GET" ? {} : { origin: ORIGIN, "sec-fetch-site": "same-origin",
        "content-type": "application/json" }), ...extraHeaders,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: response.status, text, json };
}
const API = "/api/discipline";
const GET = (orgId, entityId, suffix = "") =>
  API + "?organizationId=" + orgId + "&legalEntityId=" + entityId + suffix;
const jsonCopy = x => JSON.parse(JSON.stringify(x));

export async function proveDisciplineEntityIsolation() {
  requireDisposableDisciplineEntityEnv(); // BEFORE any application/DB import
  const [{ db, pool }, s, { eq, asc, and }, fixture] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("drizzle-orm"), import("./tenant-table-http.mjs"),
  ]);
  const tables = ["organizations", "legalEntities", "orgUnits",
    "userOrganizations", "userLegalEntityGrants", "employees",
    "employeePayProfiles", "disciplinaryCases", "auditEvents", "payrollRuns"];
  async function snapshot(orgId) {
    const state = {};
    for (const name of tables) {
      const table = s[name];
      assert.ok(table?.id, "Missing protected SQL table " + name);
      state[name] = jsonCopy(await db.select().from(table).where(
        eq(name === "organizations" ? table.id : table.organizationId, orgId)
      ).orderBy(asc(table.id)));
    }
    return state;
  }
  try {
    const ver = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(ver >= 160000 && ver < 170000, "Actual PostgreSQL 16 required");
    assert.deepEqual(await db.select().from(s.organizations).limit(1), [],
      "Refuse nonempty database: this must be a disposable fictional fixture");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = await fixture.seedEmployer("ATTA", nonce, fixture.standaloneMakeSession);
    const b = await fixture.seedEmployer("ATTB", nonce, fixture.standaloneMakeSession);
    // Deliberately create a second legal employer inside A's organization.
    const [entityB] = await db.insert(s.legalEntities).values({
      organizationId: a.org.id, code: "DISC-B-" + nonce,
      legalName: "Fictional second employer " + nonce,
      displayName: "Fictional B " + nonce, primaryEntity: false,
    }).returning();
    const [unitB] = await db.insert(s.orgUnits).values({
      organizationId: a.org.id, legalEntityId: entityB.id, type: "department",
      code: "DISC-UNIT-B-" + nonce, name: "Second legal employer unit " + nonce,
    }).returning();
    const internalB = { ...a, marker: "DISC-ENTITY-B-" + nonce,
      entity: entityB, unit: unitB };
    internalB.worker = await fixture.addWorker(internalB, "WORKER");
    // Different authenticated people: only A's primary employer for actor A,
    // only A's second legal employer for actor B. A != B's legal employer.
    await db.insert(s.userOrganizations).values({
      userId: b.owner.id, organizationId: a.org.id, role: "hr", active: true,
    });
    await db.insert(s.userLegalEntityGrants).values([
      { organizationId: a.org.id, userId: a.owner.id, legalEntityId: a.entity.id },
      { organizationId: a.org.id, userId: b.owner.id, legalEntityId: entityB.id },
    ]);
    const victim = await fixture.seedEmployer("VICTIM", nonce, fixture.standaloneMakeSession);
    assert.ok(victim.org.id > Math.max(a.org.id, b.org.id));
    assert.ok(victim.worker.id > Math.max(a.worker.id, b.worker.id, internalB.worker.id));
    assert.ok(victim.entity.id > entityB.id);
    const createCase = async (organizationId, employeeId, label) =>
      (await db.insert(s.disciplinaryCases).values({
        organizationId, employeeId, caseNumber: "DISC-" + label + "-" + nonce,
        offense: "PRIVATE-" + label + "-" + nonce, incidentDate: "2026-03-01",
        nteDetails: "PRIVATE-NTE-" + label + "-" + nonce,
      }).returning())[0];
    const [caseA, caseB, caseV] = await Promise.all([
      createCase(a.org.id, a.worker.id, "A"),
      createCase(a.org.id, internalB.worker.id, "B"),
      createCase(victim.org.id, victim.worker.id, "VICTIM"),
    ]);
    assert.ok(caseV.id > Math.max(caseA.id, caseB.id),
      "Third employer must have genuine higher-ID victim case");
    const actors = [
      { label: "actorA", cookie: a.cookie, entityId: a.entity.id,
        worker: a.worker, ownCase: caseA, foreignCase: caseB,
        foreign: [{ marker: caseB.offense, worker: internalB.worker, case: caseB },
          { marker: victim.marker, worker: victim.worker, case: caseV }] },
      { label: "actorB", cookie: b.cookie, entityId: entityB.id,
        worker: internalB.worker, ownCase: caseB, foreignCase: caseA,
        foreign: [{ marker: caseA.offense, worker: a.worker, case: caseA },
          { marker: victim.marker, worker: victim.worker, case: caseV }] },
    ];
    const employers = [a, b, victim];
    const snapshots = async () => new Map(await Promise.all(employers.map(async employer =>
      [employer.org.id, await snapshot(employer.org.id)])));
    const unchanged = async (before, label) => {
      for (const employer of employers)
        assert.deepEqual(await snapshot(employer.org.id), before.get(employer.org.id),
          label + ": protected case, payroll and audit SQL changed " + employer.marker);
    };
    let ownGets = 0, ownPosts = 0, ownPatches = 0, deniedRequests = 0;
    const denied = async (actor, path, method = "GET", body, headers = {}) => {
      const before = await snapshots();
      const response = await request(path, actor.cookie, method, body, headers);
      assert.equal(response.status, 403, actor.label + " " + method +
        " should refuse a private target (actual " + response.status + " " +
        response.text.slice(0, 150) + ")");
      assert.ok(!response.json?.nteDetails && !response.json?.employeeExplanation,
        "Denial may not expose disciplinary case content");
      noOtherMarkers(response, actor.foreign, actor.label + " denial");
      await unchanged(before, "denied " + method + "/" + actor.label);
      deniedRequests++;
    };
    for (const actor of actors) {
      const before = await snapshots();
      const own = await request(GET(a.org.id, actor.entityId), actor.cookie);
      assert.equal(own.status, 200, actor.label + " own legal-employer GET");
      assert.ok(Array.isArray(own.json?.cases) &&
        own.json.cases.some(row => row.id === actor.ownCase.id &&
          row.caseNumber === actor.ownCase.caseNumber));
      assert.equal(own.json.cases.some(row => row.id === actor.foreignCase.id), false);
      noOtherMarkers(own, actor.foreign, actor.label + " owned list");
      const directForeignWorker = await request(GET(a.org.id, actor.entityId,
        "&employeeId=" + actor.foreignCase.employeeId), actor.cookie);
      assert.equal(directForeignWorker.status, 200);
      assert.deepEqual(directForeignWorker.json?.cases, []);
      await unchanged(before, actor.label + " read-only GET");
      ownGets++;
      await denied(actor, GET(a.org.id,
        actor === actors[0] ? entityB.id : a.entity.id));
      await denied(actor, GET(victim.org.id, victim.entity.id));
      await denied(actor, GET(a.org.id, actor.entityId,
        "&legalEntityId=" + actor.entityId));
    }
    const postBody = actor => ({
      organizationId: a.org.id, legalEntityId: actor.entityId,
      employeeId: actor.worker.id, offense: "OWN-POST-" + actor.label + nonce,
      incidentDate: "2026-03-02", nteDetails: "OWN-PRIVATE-" + actor.label + nonce,
    });
    for (const actor of actors) {
      const before = await snapshots();
      const posted = await request(API, actor.cookie, "POST", postBody(actor));
      assert.equal(posted.status, 201, actor.label + " authorized case creation");
      assert.equal(posted.json?.organizationId, a.org.id);
      assert.equal(posted.json?.employeeId, actor.worker.id);
      assert.equal(posted.json?.offense, postBody(actor).offense);
      assert.equal((await db.select().from(s.disciplinaryCases).where(and(
        eq(s.disciplinaryCases.id, posted.json?.id),
        eq(s.disciplinaryCases.organizationId, a.org.id),
        eq(s.disciplinaryCases.employeeId, actor.worker.id),
      ))).length, 1, "POST must persist a case for the authorized legal employer");
      assert.deepEqual(await snapshot(victim.org.id), before.get(victim.org.id));
      assert.deepEqual(await snapshot(b.org.id), before.get(b.org.id));
      ownPosts++;
      // A and B are in the SAME organization, but have distinct entity grants.
      const foreignWorker = { ...postBody(actor),
        employeeId: actor.foreignCase.employeeId };
      const beforeForeign = await snapshots();
      const refused = await request(API, actor.cookie, "POST", foreignWorker);
      assert.equal(refused.status, 404, actor.label + " cannot create cross-entity case");
      noOtherMarkers(refused, actor.foreign, actor.label + " denied worker POST");
      await unchanged(beforeForeign, "cross-entity POST");
      deniedRequests++;
      await denied(actor, API, "POST", postBody(actor), {
        "x-legal-entity-id": String(actor === actors[0] ? entityB.id : a.entity.id),
      });
      await denied(actor, API + "?legalEntityId=" +
        (actor === actors[0] ? entityB.id : a.entity.id), "POST", postBody(actor));
      await denied(actor, API, "POST", {
        ...postBody(actor), organizationId: victim.org.id, employeeId: victim.worker.id,
      });
    }
    const actions = [
      ["submit_explanation", { employeeExplanation: "Fictional explanation " + nonce }, "explanation_submitted"],
      ["schedule_hearing", { hearingDate: "2026-09-19" }, "hearing_scheduled"],
      ["issue_nod", { nodDecision: "Fictional decision " + nonce }, "nod_issued"],
      ["close", {}, "closed"],
    ];
    for (const actor of actors) for (const [action, data, status] of actions) {
      const payload = { id: actor.ownCase.id, action,
        legalEntityId: actor.entityId, ...data };
      await denied(actor, API, "PATCH", { ...payload, id: actor.foreignCase.id });
      await denied(actor, API, "PATCH", { ...payload, id: caseV.id });
      await denied(actor, API, "PATCH", { ...payload, id: caseV.id + 100000 });
      await denied(actor, API, "PATCH", payload, {
        "x-legal-entity-id": String(actor === actors[0] ? entityB.id : a.entity.id),
      });
      const before = await snapshots();
      const own = await request(API, actor.cookie, "PATCH", payload);
      assert.equal(own.status, 200, actor.label + " authorized " + action);
      assert.equal(own.json?.id, actor.ownCase.id);
      assert.equal(own.json?.status, status);
      const [persisted] = await db.select().from(s.disciplinaryCases)
        .where(eq(s.disciplinaryCases.id, actor.ownCase.id));
      assert.equal(persisted?.status, status);
      const [other] = await db.select().from(s.disciplinaryCases)
        .where(eq(s.disciplinaryCases.id, actor.foreignCase.id));
      assert.deepEqual(jsonCopy(other), before.get(a.org.id).disciplinaryCases
        .find(c => c.id === actor.foreignCase.id), "Other legal employer case unchanged");
      assert.deepEqual(await snapshot(victim.org.id), before.get(victim.org.id));
      ownPatches++;
    }
    // Revoking the actual grant must deny a still-valid owner session.
    const revoked = await db.delete(s.userLegalEntityGrants).where(and(
      eq(s.userLegalEntityGrants.organizationId, a.org.id),
      eq(s.userLegalEntityGrants.userId, a.owner.id),
      eq(s.userLegalEntityGrants.legalEntityId, a.entity.id),
    )).returning();
    assert.equal(revoked.length, 1);
    await denied(actors[0], GET(a.org.id, a.entity.id));
    await denied(actors[0], API, "PATCH", {
      id: caseA.id, action: "close", legalEntityId: a.entity.id,
    });
    assert.equal(ownGets, 2);
    assert.equal(ownPosts, 2);
    assert.equal(ownPatches, 8);
    assert.equal(deniedRequests, 48);
    console.log(JSON.stringify({
      family: "discipline-same-org-legal-employer", pg16: true,
      independentlyAuthenticatedActors: 2, higherIdVictim: true,
      ownGets, ownPosts, ownPatches, deniedRequests,
      protectedTables: tables.length, victimSqlUnchanged: true,
      newCoverageCredits: 0, independentSecurityReview: "PENDING",
      productionCertified: false, externalProviderCalls: 0,
    }));
  } finally {
    await pool.end();
  }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("tenant-discipline-entity-http.mjs")) {
  await proveDisciplineEntityIsolation();
}
