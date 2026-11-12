/**
 * Read-only, fictional PG16 real-HTTP proof for the two private People page
 * routes while the multi-entity HCM embargo is ON.
 *
 * Must run ONLY in the dedicated disposable GitHub Actions job. A 403 shell
 * is NOT tenant-isolation acceptance for the feature-OFF pages.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  PEOPLE_PAGE_ORIGIN, requireDisposablePeoplePagesEnv,
  assertNoOtherEmployerMarkers,
} from "./tenant-people-pages-contract.mjs";

function requireHoldProofEnv(env = process.env) {
  requireDisposablePeoplePagesEnv(env);
  assert.equal(env.MULTI_ENTITY_ENABLED, "true",
    "PEOPLE_HOLD_REFUSED: multi-entity hold must be enabled");
  assert.equal(env.SECURITY_SMOKE_URL, PEOPLE_PAGE_ORIGIN,
    "PEOPLE_HOLD_REFUSED: localhost-only HTTP target required");
  for (const key of ["STRIPE_SECRET_KEY", "SMTP_PASSWORD", "POSTMARK_SERVER_TOKEN",
    "XENDIT_WEBHOOK_SECRET", "PAYMONGO_WEBHOOK_SECRET"]) {
    assert.ok(!env[key], "PEOPLE_HOLD_REFUSED: external provider secret " + key);
  }
}

const pages = ["/app/engagement", "/app/goals-reviews"];

async function deniedRead(path, cookie, all, label, prefetch = false) {
  assert.ok(pages.some(page => path === page || path.startsWith(page + "?")),
    "PEOPLE_HOLD_REFUSED: unreviewed path " + path);
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (prefetch) {
    headers["next-router-prefetch"] = "1";
    headers.purpose = "prefetch";
  }
  const response = await fetch(PEOPLE_PAGE_ORIGIN + path, {
    method: "GET", headers, redirect: "manual", cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.text();
  assert.equal(response.status, 403, label + " must be denied before SSR");
  assert.match(response.headers.get("cache-control") ?? "", /private.*no-store/,
    label + " must not cache sensitive page denial");
  assert.equal(JSON.parse(body).code, "ENTITY_HCM_DEFERRED",
    label + " must be denied by the existing HCM embargo, not a generic error");
  assertNoOtherEmployerMarkers(body, all, label);
}

export async function verifyPeopleMultiEntityHold() {
  // Validate environment BEFORE importing any application/database module.
  requireHoldProofEnv();

  const [{ db, pool }, schema, { asc, eq }, fixtures] = await Promise.all([
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
      await db.insert(schema.performanceCycles).values({
        organizationId: actor.org.id,
        name: actor.marker + " review cycle",
        startDate: "2026-10-01", endDate: "2026-12-31",
        createdByUserId: actor.owner.id, createdBy: actor.owner.name,
      });
      await db.insert(schema.engagementSurveys).values({
        organizationId: actor.org.id,
        question: actor.marker + " Private test question?",
        status: "closed", createdByUserId: actor.owner.id,
      });
      subjects.push(actor);
    }
    const [a, b, victim] = subjects;
    assert.ok(victim.org.id > a.org.id && victim.org.id > b.org.id,
      "Must test a real higher-ID persisted foreign employer");
    assert.equal(new Set(subjects.map(e => e.cookie)).size, 3,
      "Must use independently signed-in owner cookies");

    const tables = [
      "organizations", "legalEntities", "orgUnits", "employees",
      "employeePayProfiles", "performanceCycles", "engagementSurveys",
      "userOrganizations", "auditEvents", "payrollRuns",
    ];
    async function snapshot(actor) {
      const out = {};
      for (const name of tables) {
        const table = schema[name];
        assert.ok(table?.id, "Missing actual stored table: " + name);
        out[name] = await db.select().from(table)
          .where(eq(name === "organizations" ? table.id : table.organizationId,
            actor.org.id)).orderBy(asc(table.id));
      }
      return JSON.parse(JSON.stringify(out));
    }
    const before = await Promise.all(subjects.map(snapshot));
    let ownDenials = 0, foreignDenials = 0, prefetchDenials = 0;
    for (const actor of [a, b]) {
      for (const page of pages) {
        await deniedRead(page + "?organizationId=" + actor.org.id,
          actor.cookie, subjects, actor.label + " own " + page);
        ownDenials++;
        await deniedRead(page + "?organizationId=" + victim.org.id,
          actor.cookie, subjects, actor.label + " foreign " + page);
        foreignDenials++;
        await deniedRead(page + "?organizationId=" + actor.org.id,
          actor.cookie, subjects, actor.label + " prefetched " + page, true);
        prefetchDenials++;
        await deniedRead(page + "?organizationId=" + actor.org.id +
          "&organizationId=" + victim.org.id, actor.cookie, subjects,
        actor.label + " duplicated employer " + page);
        await deniedRead(page + "?organizationId=1e3",
          actor.cookie, subjects, actor.label + " malformed " + page);
      }
    }
    for (const page of pages) {
      await deniedRead(page + "?organizationId=" + victim.org.id,
        undefined, subjects, "anonymous " + page);
      await deniedRead(page, a.cookie, subjects, "implicit employer " + page);
    }
    const after = await Promise.all(subjects.map(snapshot));
    assert.deepEqual(after, before, "Every fictional employer's private/audit state must remain unchanged");
    assert.equal(ownDenials, 4);
    assert.equal(foreignDenials, 4);
    assert.equal(prefetchDenials, 4);
    console.log("PEOPLE_HOLD_PG16_HTTP_COMPLETE " + JSON.stringify({
      kind: "PRIVATE_PEOPLE_MULTI_ENTITY_HOLD_FICTIONAL_ONLY",
      realEmployers: 3, authenticatedOwners: 2, ownDenials,
      foreignDenials, prefetchDenials, immutableSqlSnapshots: true,
      pageCredits: 0, methodCredits: 0, productionCertified: false,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/")
  .endsWith("tenant-people-pages-multi-entity-http.mjs")) {
  verifyPeopleMultiEntityHold().catch(error => {
    console.error("PEOPLE_HOLD_PG16_HTTP_FAILED " +
      (error instanceof Error ? error.stack : String(error)));
    process.exitCode = 1;
  });
}
