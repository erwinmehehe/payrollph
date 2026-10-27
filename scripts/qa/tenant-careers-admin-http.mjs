/**
 * Isolated, independently authenticated Careers publishing proof.
 * Proves only PATCH /api/careers/admin, plus bounded read-only public GET checks.
 * This is NOT applicant-intake/consent verification or a whole-family credit.
 *
 * Fresh GitHub Actions PostgreSQL 16 and real localhost Next only.
 * Requires a pinned, existing unnumbered careers SQL proposal, applied only
 * to the empty synthetic CI database and never to production.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  requireDisposableCareersAdminEnv, assertNoVictimLeak,
  provePublicCareersGet, assertUnchangedCareersTenant, provePublishedTransition,
} from "./tenant-careers-admin-contract.mjs";

const BASE = "http://127.0.0.1:3000";
const ADMIN = "/api/careers/admin";
const PINNED_PROPOSAL =
  "-- Source-only schema design (unnumbered). DBA review and migration receipt required.\n" +
  "ALTER TABLE job_requisitions ADD COLUMN IF NOT EXISTS careers_published boolean NOT NULL DEFAULT false;\n" +
  "-- Never run directly against production; check existing recruiting/position policy and historical hashes.\n";

async function awaitServer(proc, tail) {
  for (let i = 0; i < 80; i++) {
    if (proc.exitCode != null) throw new Error("Disposable Next exited early: " + tail());
    try {
      const r = await fetch(BASE + "/login", { cache: "no-store", redirect: "manual" });
      if (r.ok) return;
    } catch { /* wait for the ephemeral server */ }
    await delay(1000);
  }
  throw new Error("Local Next readiness timeout: " + tail());
}
async function stopServer(proc) {
  if (!proc || proc.exitCode != null) return;
  proc.kill("SIGTERM");
  await Promise.race([new Promise(resolve => proc.once("exit", resolve)), delay(4000)]);
  if (proc.exitCode == null) proc.kill("SIGKILL");
}

async function installDisposableCareersColumn(pool) {
  // This is intentionally the only DDL, and only for a new synthetic test DB.
  const proposal = readFileSync(new URL("../../docs/engineering/migration-proposals/careers-published.sql",
    import.meta.url), "utf8").replaceAll("\r\n", "\n");
  assert.equal(proposal, PINNED_PROPOSAL,
    "CAREERS_ADMIN_REFUSED: proposed schema source changed and needs independent review");
  const { rows: [target] } = await pool.query(
    "select current_database() as db, current_user as role, " +
    "current_schema() as schema, current_setting('server_version_num')::int as ver, " +
    "(select count(*)::int from organizations) as orgs, " +
    "(select count(*)::int from users) as users, " +
    "(select count(*)::int from audit_events) as audits");
  assert.equal(target.db, "app_db");
  assert.equal(target.role, "postgres");
  assert.equal(target.schema, "public");
  assert.equal(Math.floor(target.ver / 10000), 16, "PostgreSQL 16 is required");
  assert.equal(target.orgs, 0, "cannot use a pre-existing tenant database");
  assert.equal(target.users, 0, "cannot use a populated user database");
  assert.equal(target.audits, 0, "cannot use existing audit records");
  const { rows: existing } = await pool.query(
    "select column_name from information_schema.columns " +
    "where table_schema='public' and table_name='job_requisitions' " +
    "and column_name='careers_published'");
  assert.equal(existing.length, 0,
    "refuse unexpected preinstalled careers column; review current schema first");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(proposal);
    const { rows: [column] } = await client.query(
      "select data_type, is_nullable, column_default from information_schema.columns " +
      "where table_schema='public' and table_name='job_requisitions' " +
      "and column_name='careers_published'");
    assert.deepEqual(column,
      { data_type: "boolean", is_nullable: "NO", column_default: "false" });
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); }
}

export async function verifyCareersAdminTenantHttp() {
  // Before ANY app/DB dependency import or network operation.
  requireDisposableCareersAdminEnv();
  const [{ db, pool }, s, { asc, eq }, http, { auditBusinessSnapshot }] =
    await Promise.all([
      import("../../src/db/index.ts"),
      import("../../src/db/schema.ts"),
      import("drizzle-orm"),
      import("./tenant-table-http.mjs"),
      import("./tenant-table-invariants.mjs"),
    ]);
  let server;
  try {
    await installDisposableCareersColumn(pool);
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const employers = [];
    for (const label of ["ATTA", "ATTB", "VICTIM"]) {
      const seed = await http.seedEmployer(label, nonce, http.standaloneMakeSession);
      const [profile] = await db.insert(s.jobProfiles).values({
        organizationId: seed.org.id, title: seed.marker + " fictional profile",
      }).returning();
      const [position, closedPosition] = await db.insert(s.positions).values([
        {
          organizationId: seed.org.id, jobProfileId: profile.id,
          code: "CAREER-" + label + "-" + nonce, status: "open",
          legalEntityId: seed.entity.id, orgUnitId: seed.unit.id,
          createdByUserId: seed.owner.id,
        },
        {
          organizationId: seed.org.id, jobProfileId: profile.id,
          code: "CLOSED-" + label + "-" + nonce, status: "filled",
          legalEntityId: seed.entity.id, orgUnitId: seed.unit.id,
          createdByUserId: seed.owner.id,
        },
      ]).returning();
      const jobTitle = seed.marker + " public fictional opening";
      const closedTitle = seed.marker + " restricted closed-position opening";
      const department = seed.marker + " department";
      const description = seed.marker + " safely fictional role description";
      const [job, closedJob] = await db.insert(s.jobRequisitions).values([
        {
          organizationId: seed.org.id, positionId: position.id,
          title: jobTitle, department, description, status: "open",
          salaryMin: "25000", salaryMax: "43000",
        },
        {
          organizationId: seed.org.id, positionId: closedPosition.id,
          title: closedTitle, department, status: "open",
        },
      ]).returning();
      // Bookkeeper is an ORG_ADMIN_ROLE but explicitly cannot publish careers.
      const [bookkeeper] = await db.insert(s.users).values({
        name: seed.marker + " bookkeeper", role: "bookkeeper",
        email: seed.marker.toLowerCase() + "-bookkeeper@example.invalid",
        passwordHash: "fictional-only", totpEnabled: true,
      }).returning();
      await db.insert(s.userOrganizations).values({
        userId: bookkeeper.id, organizationId: seed.org.id,
        role: "bookkeeper", active: true,
      });
      const bookkeeperSession = await http.standaloneMakeSession(bookkeeper.id);
      const [unitHR] = await db.insert(s.users).values({
        name: seed.marker + " unit HR", role: "hr",
        email: seed.marker.toLowerCase() + "-unit-hr@example.invalid",
        passwordHash: "fictional-only", totpEnabled: true,
      }).returning();
      await db.insert(s.userOrganizations).values({
        userId: unitHR.id, organizationId: seed.org.id,
        orgUnitId: seed.unit.id, role: "hr", active: true,
      });
      const unitSession = await http.standaloneMakeSession(unitHR.id);
      employers.push({
        label, marker: seed.marker, orgId: seed.org.id,
        orgName: seed.org.name, ownerId: seed.owner.id,
        ownerName: seed.owner.name, ownerCookie: seed.cookie,
        workerId: seed.worker.id,
        profileId: profile.id, positionId: position.id,
        jobId: job.id, jobTitle, closedJobId: closedJob.id, closedTitle,
        department, description,
        bookkeeperCookie: bookkeeperSession.cookie,
        unitHrCookie: unitSession.cookie,
      });
    }
    const [a, b, victim] = employers;
    for (const attacker of [a, b]) {
      for (const key of ["orgId", "workerId", "profileId", "positionId", "jobId"]) {
        assert.ok(victim[key] > attacker[key],
          "victim must be a real persisted higher-ID target for " + key);
      }
    }
    const tables = Object.freeze({
      organizations: s.organizations, employees: s.employees,
      memberships: s.userOrganizations,
      profiles: s.jobProfiles, positions: s.positions,
      requisitions: s.jobRequisitions, applicants: s.jobApplicants,
      privacyEvidence: s.applicantPrivacyEvidence,
      payroll: s.payrollRuns,
    });
    const snapshot = async orgId => {
      const out = {};
      for (const [name, table] of Object.entries(tables)) {
        out[name] = await db.select().from(table)
          .where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
      }
      out.publication = (await pool.query(
        'select id, organization_id as "organizationId", ' +
          'careers_published as "published" from job_requisitions ' +
          'where organization_id=$1 order by id', [orgId])).rows;
      const audits = await db.select().from(s.auditEvents)
        .where(eq(s.auditEvents.organizationId, orgId))
        .orderBy(asc(s.auditEvents.id));
      out.audit = auditBusinessSnapshot(audits);
      return out;
    };
    const publicGet = employer => http.standaloneRequest(
      "/api/careers?organizationId=" + employer.orgId);
    const patch = (actor, targetOrgId, reqId, published, expectedPublished,
      cookie = actor.ownerCookie) => http.standaloneRequest(ADMIN, {
        method: "PATCH", cookie,
        body: {
          organizationId: targetOrgId, requisitionId: reqId,
          published, expectedPublished,
        },
      });
    const deny = (response, code, label) => {
      assert.equal(response.status, code,
        label + " returned " + response.status + " " + response.text.slice(0, 160));
      assertNoVictimLeak(response, victim, label);
    };
    let logs = "";
    server = spawn(process.execPath,
      ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3000"],
      { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
    const tail = data => { logs = (logs + String(data)).slice(-1700); };
    server.stdout.on("data", tail);
    server.stderr.on("data", tail);
    await awaitServer(server, () => logs);

    const expected = new Map();
    for (const e of employers) {
      expected.set(e.orgId, await snapshot(e.orgId));
      const own = await publicGet(e);
      provePublicCareersGet(own, e, false, employers.filter(t => t.orgId !== e.orgId));
      assert.equal(expected.get(e.orgId).publication.length, 2,
        "exactly two real requisitions per employer required");
    }
    let foreignDenials = 0, forgedDenials = 0;
    let closedDenials = 0, nonAdminDenials = 0;
    for (const actor of [a, b]) {
      deny(await patch(actor, victim.orgId, victim.jobId, true, false), 403,
        actor.label + " foreign employer publishing");
      foreignDenials++;
      deny(await patch(actor, actor.orgId, victim.jobId, true, false), 409,
        actor.label + " victim requisition forged into own employer");
      forgedDenials++;
      deny(await patch(actor, actor.orgId, actor.closedJobId, true, false), 409,
        actor.label + " filled linked position cannot publish");
      closedDenials++;
      deny(await patch(actor, actor.orgId, actor.jobId, true, false,
        actor.bookkeeperCookie), 403, actor.label + " bookkeeper cannot publish");
      nonAdminDenials++;
      deny(await patch(actor, actor.orgId, actor.jobId, true, false,
        actor.unitHrCookie), 403, actor.label + " unit-scoped HR cannot publish");
      nonAdminDenials++;
      for (const e of employers) {
        assertUnchangedCareersTenant(expected.get(e.orgId), await snapshot(e.orgId),
          actor.label + " negative publishing attempts on " + e.label);
      }
    }
    let ownedPublishes = 0, ownedUnpublishes = 0, staleDenials = 0;
    for (const actor of employers) {
      const before = await snapshot(actor.orgId);
      assertUnchangedCareersTenant(expected.get(actor.orgId), before,
        actor.label + " before published update");
      const pub = await patch(actor, actor.orgId, actor.jobId, true, false);
      const after = await snapshot(actor.orgId);
      provePublishedTransition(before, after, actor, true, pub);
      ownedPublishes++;
      expected.set(actor.orgId, after);
      deny(await patch(actor, actor.orgId, actor.jobId, true, false), 409,
        actor.label + " stale second publication");
      staleDenials++;
      assertUnchangedCareersTenant(after, await snapshot(actor.orgId),
        actor.label + " stale publication must not create an extra audit");
      const visible = await publicGet(actor);
      provePublicCareersGet(visible, actor, true,
        employers.filter(e => e.orgId !== actor.orgId));
      for (const e of employers.filter(e => e.orgId !== actor.orgId)) {
        assertUnchangedCareersTenant(expected.get(e.orgId), await snapshot(e.orgId),
          actor.label + " publish must not mutate " + e.label);
      }

      const old = await snapshot(actor.orgId);
      const unpub = await patch(actor, actor.orgId, actor.jobId, false, true);
      const updated = await snapshot(actor.orgId);
      provePublishedTransition(old, updated, actor, false, unpub);
      ownedUnpublishes++;
      expected.set(actor.orgId, updated);
      deny(await patch(actor, actor.orgId, actor.jobId, false, true), 409,
        actor.label + " stale second unpublication");
      staleDenials++;
      assertUnchangedCareersTenant(updated, await snapshot(actor.orgId),
        actor.label + " stale unpublication cannot create extra audit");
      provePublicCareersGet(await publicGet(actor), actor, false,
        employers.filter(e => e.orgId !== actor.orgId));
      for (const e of employers.filter(e => e.orgId !== actor.orgId)) {
        assertUnchangedCareersTenant(expected.get(e.orgId), await snapshot(e.orgId),
          actor.label + " unpublish must not mutate " + e.label);
      }
    }
    assert.deepEqual({
      foreignDenials, forgedDenials, closedDenials, nonAdminDenials,
      ownedPublishes, ownedUnpublishes, staleDenials,
    }, {
      foreignDenials: 2, forgedDenials: 2,
      closedDenials: 2, nonAdminDenials: 4,
      ownedPublishes: 3, ownedUnpublishes: 3,
      staleDenials: 6,
    });
    console.log(JSON.stringify({
      kind: "tenant-careers-admin-pg16-real-http",
      target: "PATCH careers/admin", threeFictionalEmployers: true,
      twoIndependentOwnerAttackers: true, higherIdVictim: true,
      foreignDenials, forgedDenials, closedDenials, nonAdminDenials,
      ownedPublishes, ownedUnpublishes, staleDenials,
      publicEmployerIsolation: true, auditAndProtectedStateVerified: true,
      publicApplicantPostTested: false, wholeCareersFamilyProven: false,
      coverageCredits: 0, productionCertified: false,
    }));
  } finally {
    await stopServer(server);
    await pool.end();
  }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-careers-admin-http.mjs")) {
  verifyCareersAdminTenantHttp().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
