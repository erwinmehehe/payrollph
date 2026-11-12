/**
 * Provisioning checklist legal-employer isolation (two real actors, two legal
 * entities in one organization, higher-ID independent victim organization).
 * Only fictional PostgreSQL 16 + production-mode localhost Next HTTP.
 * No money/providers, no production HR data, ZERO new coverage credits.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const ORIGIN = "http://127.0.0.1:3000";

export function requireDisposableProvisioningEnv(env = process.env) {
  const required = {
    CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
    TENANT_PROVISIONING_ENTITY_PROOF: "fictional-pg16-only",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: ORIGIN, APP_BASE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN,
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
    MULTI_ENTITY_ENABLED: "true", DEMO_MODE: "false",
    REQUIRE_PRIVILEGED_MFA: "true", WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false", PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  };
  for (const [key, value] of Object.entries(required))
    assert.equal(env[key], value, "PROVISIONING_ENTITY_REFUSED: " + key);
  for (const name of [
    "NEON_DATABASE_URL", "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
    "STRIPE_SECRET_KEY", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN",
    "SMTP_URL", "SMTP_PASSWORD", "OPENAI_API_KEY", "WORKER_TOKEN",
    "CRON_SECRET", "AWS_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID",
  ]) assert.ok(!env[name], "PROVISIONING_ENTITY_REFUSED: live credential " + name);
  return true;
}

const copy = value => JSON.parse(JSON.stringify(value,
  (_, v) => typeof v === "bigint" ? v.toString() : v));

async function call(path, cookie, method = "GET", body, extraHeaders = {}) {
  assert.ok(path.startsWith("/api/provisioning") || path === "/api/account");
  const response = await fetch(ORIGIN + path, {
    method,
    headers: { cookie,
      ...(method === "GET" ? {} : {
        origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json",
      }),
      ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: response.status, text, json };
}

function noForeignMarkers(response, opponents, message) {
  for (const opponent of opponents)
    for (const marker of [opponent.marker, opponent.worker?.employeeNo,
      opponent.task?.title].filter(Boolean))
      assert.ok(!response.text.includes(marker),
        message + ": response exposed a foreign employee/checklist marker");
}

export async function proveProvisioningEntityIsolation() {
  // Reject unsafe profiles BEFORE importing application, DB, or any fixture.
  requireDisposableProvisioningEnv();
  const [{ db, pool }, schema, { and, asc, eq }, fixture] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("drizzle-orm"), import("./tenant-table-http.mjs"),
  ]);
  const protectedTables = [
    "organizations", "legalEntities", "orgUnits", "userOrganizations",
    "userLegalEntityGrants", "employees", "employeePayProfiles",
    "provisioningTasks", "auditEvents", "payrollRuns",
    "itApplications", "itAccessGrants", "itManagedDevices", "itDeviceEvents", "assets",
  ];
  async function snapshot(orgId) {
    const state = {};
    for (const name of protectedTables) {
      const t = schema[name];
      assert.ok(t?.id, "Required real PostgreSQL table missing: " + name);
      state[name] = copy(await db.select().from(t).where(
        eq(name === "organizations" ? t.id : t.organizationId, orgId)
      ).orderBy(asc(t.id)));
    }
    return state;
  }

  try {
    const version = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(version >= 160000 && version < 170000, "An actual PostgreSQL 16 server is mandatory");
    assert.deepEqual(await db.select().from(schema.organizations).limit(1), [],
      "Refuse non-empty employer database: no existing HR records allowed");

    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = await fixture.seedEmployer("ATTA", nonce, fixture.standaloneMakeSession);
    const b = await fixture.seedEmployer("ATTB", nonce, fixture.standaloneMakeSession);
    const [entityB] = await db.insert(schema.legalEntities).values({
      organizationId: a.org.id, code: "PROV-B-" + nonce,
      legalName: "Fictional second legal employer " + nonce,
      displayName: "Fictional second employer " + nonce, primaryEntity: false,
    }).returning();
    const [unitB] = await db.insert(schema.orgUnits).values({
      organizationId: a.org.id, legalEntityId: entityB.id, type: "department",
      code: "PROV-B-UNIT-" + nonce, name: "Fictional B unit " + nonce,
    }).returning();
    const internalB = { org: a.org, entity: entityB, unit: unitB,
      marker: "PROV-B-" + nonce };
    internalB.worker = await fixture.addWorker(internalB, "WORKER");
    const unseededB = await fixture.addWorker(internalB, "UNSEEDED");
    await db.update(schema.employees).set({ status: "Separating" }).where(and(
      eq(schema.employees.id, unseededB.id),
      eq(schema.employees.organizationId, a.org.id),
    ));
    // A fictional active IT grant makes a cross-entity GET side effect observable.
    // Only B's OWN GET may ask a human to revoke B's app access.
    const [app] = await db.insert(schema.itApplications).values({
      organizationId: a.org.id, name: "Fictional B offboarding app " + nonce,
    }).returning();
    const [foreignGrant] = await db.insert(schema.itAccessGrants).values({
      organizationId: a.org.id, employeeId: unseededB.id,
      applicationId: app.id, state: "active", requestedByUserId: b.owner.id,
    }).returning();
    // This is a DIFFERENT signed-in person, with role and grant to only entity B
    // in the SAME parent organization. The other B organization is a comparator.
    await db.insert(schema.userOrganizations).values({
      userId: b.owner.id, organizationId: a.org.id, role: "hr", active: true,
    });
    await db.insert(schema.userLegalEntityGrants).values([
      { organizationId: a.org.id, userId: a.owner.id, legalEntityId: a.entity.id },
      { organizationId: a.org.id, userId: b.owner.id, legalEntityId: entityB.id },
    ]);

    const victim = await fixture.seedEmployer("VICTIM", nonce, fixture.standaloneMakeSession);
    assert.ok(victim.org.id > Math.max(a.org.id, b.org.id));
    assert.ok(victim.worker.id > Math.max(a.worker.id, b.worker.id,
      internalB.worker.id, unseededB.id));
    const makeTask = async (orgId, employeeId, title) =>
      (await db.insert(schema.provisioningTasks).values({
        organizationId: orgId, employeeId, kind: "onboarding", owner: "IT",
        title, done: false,
      }).returning())[0];
    const taskA = await makeTask(a.org.id, a.worker.id, "OWN-A-" + nonce);
    const taskB = await makeTask(a.org.id, internalB.worker.id, "OWN-B-" + nonce);
    const victimTask = await makeTask(victim.org.id, victim.worker.id, "VICTIM-" + nonce);
    assert.ok(victimTask.id > Math.max(taskA.id, taskB.id),
      "The foreign victim task ID must be genuinely higher, never fabricated");

    const actors = [
      { name: "owner-A", cookie: a.cookie, entity: a.entity, worker: a.worker,
        task: taskA, other: taskB,
        opponents: [{ marker: internalB.marker, worker: internalB.worker, task: taskB },
          { marker: victim.marker, worker: victim.worker, task: victimTask }] },
      { name: "hr-B", cookie: b.cookie, entity: entityB, worker: internalB.worker,
        task: taskB, other: taskA,
        opponents: [{ marker: a.marker, worker: a.worker, task: taskA },
          { marker: victim.marker, worker: victim.worker, task: victimTask }] },
    ];
    const orgs = [a, b, victim];
    const snapshots = async () => new Map(await Promise.all(orgs.map(async org =>
      [org.org.id, await snapshot(org.org.id)])));
    const unchanged = async (prior, label) => {
      for (const org of orgs) assert.deepEqual(
        await snapshot(org.org.id), prior.get(org.org.id),
        label + ": protected task, employee, IT or audit SQL changed " + org.marker);
    };
    let ownReads = 0, ownWrites = 0, refused = 0;
    const deny = async (actor, path, status, method = "GET", body, headers = {}) => {
      const before = await snapshots();
      const result = await call(path, actor.cookie, method, body, headers);
      assert.equal(result.status, status, actor.name + " " + method + " " + path +
        ": expected " + status + ", got " + result.status + " " + result.text.slice(0, 150));
      noForeignMarkers(result, actor.opponents, actor.name + " denied HTTP");
      await unchanged(before, "denied " + actor.name + " " + method);
      refused++;
      return result;
    };
    const endpoint = "/api/provisioning";
    const readPath = entityId => endpoint + "?organizationId=" + a.org.id +
      "&legalEntityId=" + entityId;

    for (const actor of actors) {
      const other = actor === actors[0] ? entityB.id : a.entity.id;
      const victimBefore = await snapshot(victim.org.id);
      const response = await call(readPath(actor.entity.id), actor.cookie);
      assert.equal(response.status, 200, actor.name + " owned checklist GET");
      assert.ok(Array.isArray(response.json?.employees));
      const owned = response.json.employees.find(e => e.employeeId === actor.worker.id);
      assert.ok(owned && owned.onboarding.some(t =>
        t.id === actor.task.id && t.title === actor.task.title),
        actor.name + ": real OWN employee and OWN PostgreSQL task must be returned");
      assert.equal(response.json.employees.some(e => e.employeeId === actor.other.employeeId), false);
      noForeignMarkers(response, actor.opponents, actor.name + " own checklist");
      assert.deepEqual(await snapshot(victim.org.id), victimBefore,
        "Owned checklist GET must not seed or edit a separate victim employer");
      if (actor === actors[0]) {
        assert.equal((await db.select().from(schema.provisioningTasks)
          .where(eq(schema.provisioningTasks.employeeId, unseededB.id))).length, 0,
          "A legal employer GET must not initialize B's onboarding OR offboarding tasks");
        const [grant] = await db.select().from(schema.itAccessGrants)
          .where(eq(schema.itAccessGrants.id, foreignGrant.id));
        assert.equal(grant.state, "active",
          "A-only GET must not request revocation of B's fictional IT access");
      } else {
        assert.equal((await db.select().from(schema.provisioningTasks)
          .where(eq(schema.provisioningTasks.employeeId, unseededB.id))).length, 10,
          "B's own GET must initialize B onboarding and offboarding task lists");
        const [grant] = await db.select().from(schema.itAccessGrants)
          .where(eq(schema.itAccessGrants.id, foreignGrant.id));
        assert.equal(grant.state, "revoke_requested",
          "Only an authorized B GET may request B's own offboarding IT revocation");
      }
      ownReads++;
      await deny(actor, readPath(other), 403);
      await deny(actor, endpoint + "?organizationId=" + victim.org.id +
        "&legalEntityId=" + victim.entity.id, 403);
      await deny(actor, readPath(actor.entity.id) +
        "&legalEntityId=" + actor.entity.id, 403);
      await deny(actor, readPath(actor.entity.id), 403, "GET", undefined,
        { "x-legal-entity-id": String(other) });
    }

    for (const actor of actors) {
      const other = actor === actors[0] ? entityB.id : a.entity.id;
      const payload = { id: actor.task.id, organizationId: a.org.id,
        employeeId: actor.worker.id, done: true, legalEntityId: actor.entity.id };
      const foreign = { ...payload, id: actor.other.id,
        employeeId: actor.other.employeeId };
      const deniedForeign = await deny(actor, endpoint, 404, "PATCH", foreign);
      const missingId = await deny(actor, endpoint, 404, "PATCH", {
        ...payload, id: victimTask.id + 100000,
      });
      assert.deepEqual(deniedForeign.json, missingId.json,
        "Foreign and nonexistent task IDs must have identical non-disclosing replies");
      await deny(actor, endpoint, 403, "PATCH",
        { ...payload, legalEntityId: other });
      await deny(actor, endpoint, 403, "PATCH", payload,
        { "x-legal-entity-id": String(other) });
      await deny(actor, endpoint + "?legalEntityId=" + other, 403, "PATCH", payload);
      await deny(actor, endpoint + "?legalEntityId=" + actor.entity.id +
        "&legalEntityId=" + actor.entity.id, 403, "PATCH", payload);
      await deny(actor, endpoint, 403, "PATCH", {
        ...payload, organizationId: victim.org.id, id: victimTask.id,
        employeeId: victim.worker.id,
      });

      const beforeVictim = await snapshot(victim.org.id);
      const success = await call(endpoint, actor.cookie, "PATCH", payload);
      assert.equal(success.status, 200, actor.name + ": own checklist PATCH");
      assert.equal(success.json?.id, actor.task.id);
      assert.equal(success.json?.employeeId, actor.worker.id);
      assert.equal(success.json?.organizationId, a.org.id);
      assert.equal(success.json?.done, true);
      assert.equal(success.json?.completedBy, actor === actors[0] ? a.owner.name : b.owner.name);
      const [row] = await db.select().from(schema.provisioningTasks).where(and(
        eq(schema.provisioningTasks.id, actor.task.id),
        eq(schema.provisioningTasks.organizationId, a.org.id),
        eq(schema.provisioningTasks.employeeId, actor.worker.id),
      ));
      assert.equal(row.done, true, actor.name + " own SQL task must change exactly");
      assert.deepEqual(await snapshot(victim.org.id), beforeVictim,
        "Owned task completion cannot affect the higher-ID victim employer");
      ownWrites++;
    }

    // A role with only a unit assignment must never initialize or see the
    // other legal employer's staff, even within the same company.
    const [unitActor] = await db.insert(schema.users).values({
      name: "Fictional unit HR " + nonce, email: "prov-unit-" + nonce + "@example.invalid",
      passwordHash: "fictional-local-only", role: "hr", totpEnabled: true,
    }).returning();
    await db.insert(schema.userOrganizations).values({
      userId: unitActor.id, organizationId: a.org.id, role: "hr",
      orgUnitId: a.unit.id, active: true,
    });
    await db.insert(schema.userLegalEntityGrants).values({
      userId: unitActor.id, organizationId: a.org.id, legalEntityId: a.entity.id,
    });
    const unitSession = await fixture.standaloneMakeSession(unitActor.id);
    await db.update(schema.sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(schema.sessions.id, unitSession.id));
    const unitOwned = await call(readPath(a.entity.id), unitSession.cookie);
    assert.equal(unitOwned.status, 200);
    assert.deepEqual(unitOwned.json?.employees.map(e => e.employeeId), [a.worker.id],
      "Unit-scoped HR may list only that unit's workers");
    const beforeWrongUnit = await snapshots();
    const wrongUnit = await call(endpoint, unitSession.cookie, "PATCH", {
      id: taskB.id, organizationId: a.org.id, employeeId: internalB.worker.id,
      done: false, legalEntityId: a.entity.id,
    });
    assert.equal(wrongUnit.status, 404);
    await unchanged(beforeWrongUnit, "unit-only cross-entity PATCH");
    refused++;

    // Live grant revocation overrides any old cookie or preference.
    await db.delete(schema.userLegalEntityGrants).where(and(
      eq(schema.userLegalEntityGrants.userId, a.owner.id),
      eq(schema.userLegalEntityGrants.organizationId, a.org.id),
      eq(schema.userLegalEntityGrants.legalEntityId, a.entity.id),
    ));
    await deny(actors[0], readPath(a.entity.id), 403);
    await deny(actors[0], endpoint, 403, "PATCH", {
      id: taskA.id, organizationId: a.org.id,
      employeeId: a.worker.id, done: false, legalEntityId: a.entity.id,
    });
    assert.equal(ownReads, 2);
    assert.equal(ownWrites, 2);
    assert.equal(refused, 25);
    console.log(JSON.stringify({
      suite: "provisioning-same-organization-different-legal-employer",
      realPostgres16: true, twoIndependentlyAuthenticatedActors: true,
      higherIdVictim: true, ownReads, ownWrites, refused,
      checkedProtectedTables: protectedTables.length,
      unseededForeignTaskProof: true, unitOnlyDenial: true, revocationDenial: true,
      victimDatabaseUnchanged: true, newCoverageCredits: 0,
      independentSecurityReview: "PENDING", productionCertified: false,
    }));
  } finally {
    await pool.end();
  }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("tenant-provisioning-entity-http.mjs")) {
  await proveProvisioningEntityIsolation();
}
