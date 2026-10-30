/**
 * EDG-01: two independent attacker employers, a real higher-ID victim,
 * real owner/HR sessions, real PostgreSQL 16, production-mode localhost HTTP.
 *
 * ONLY the disposable test schema receives the unnumbered careers column.
 * No app route, production migration, provider, money or tenant ledger change.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  METHOD, PATH, requireDisposableCareersEnv,
  assertDenied, assertUnchanged, assertPublicationTransition,
} from "./tenant-edg01-careers-publication-contract.mjs";

const sqlProposalPath = "docs/engineering/migration-proposals/careers-published.sql";

async function database() {
  // Runtime guard is intentionally BEFORE any DB, Next or fixture import.
  requireDisposableCareersEnv();
  const [{ db, pool }, s, orm, fixtures, invariant] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("drizzle-orm"), import("./tenant-table-http.mjs"),
    import("./tenant-table-invariants.mjs"),
  ]);
  fixtures.requireTenantTableDisposable();
  const version = await pool.query("SHOW server_version_num");
  assert.equal(Math.floor(Number(version.rows[0].server_version_num) / 10000), 16,
    "EDG01_CAREERS_REFUSED: PostgreSQL 16 only");
  return { db, pool, s, orm, fixtures, invariant };
}

async function migrate() {
  const { db, pool, s } = await database();
  try {
    assert.equal((await db.select({ id: s.organizations.id })
      .from(s.organizations).limit(1)).length, 0,
    "EDG01_CAREERS_REFUSED: employer table must be empty");
    const before = await pool.query(
      "select count(*)::int as n from information_schema.columns " +
      "where table_schema=current_schema() and table_name='job_requisitions' " +
      "and column_name='careers_published'");
    assert.equal(before.rows[0].n, 0, "The optional careers column must not already be deployed");
    const proposal = readFileSync(sqlProposalPath, "utf8");
    const statements = proposal.split("\n")
      .filter(line => !line.trimStart().startsWith("--")).join(" ").trim();
    assert.equal(statements,
      "ALTER TABLE job_requisitions ADD COLUMN IF NOT EXISTS careers_published boolean NOT NULL DEFAULT false;",
      "EDG01_CAREERS_REFUSED: independently reviewed optional DDL changed");
    await pool.query(statements);
    const after = await pool.query(
      "select count(*)::int as n from information_schema.columns " +
      "where table_schema=current_schema() and table_name='job_requisitions' " +
      "and column_name='careers_published'");
    assert.equal(after.rows[0].n, 1);
    console.log("EDG01_CAREERS_LOCAL_SCHEMA_READY " +
      JSON.stringify({ disposablePg16: true, onlyOptionalReviewedColumn: true,
        moneyMoved: false, productionMigration: false }));
  } finally {
    await pool.end();
  }
}

async function prove() {
  const { db, pool, s, orm, fixtures, invariant } = await database();
  const { eq, asc } = orm;
  const { seedEmployer, standaloneMakeSession, standaloneRequest } = fixtures;
  try {
    assert.equal((await db.select({ id: s.organizations.id }).from(s.organizations).limit(1)).length, 0,
      "EDG01_CAREERS_REFUSED: only a fresh fictional employer database is allowed");
    assert.equal((await db.select({ id: s.auditEvents.id }).from(s.auditEvents).limit(1)).length, 0,
      "EDG01_CAREERS_REFUSED: empty audit source required");
    const column = await pool.query("select careers_published from job_requisitions limit 0");
    assert.ok(column.fields.some(field => field.name === "careers_published"),
      "The disposable optional careers column must be installed before HTTP proof");

    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const employers = [];
    for (const label of ["ATTA", "ATTB", "VICTIM"]) {
      const e = await seedEmployer(label, nonce, standaloneMakeSession);
      const [profile] = await db.insert(s.jobProfiles).values({
        organizationId: e.org.id, title: e.marker + " recruiter profile",
      }).returning();
      const [position, closedPosition] = await db.insert(s.positions).values([
        { organizationId: e.org.id, jobProfileId: profile.id,
          code: "EDG-" + label, status: "open", orgUnitId: e.unit.id },
        { organizationId: e.org.id, jobProfileId: profile.id,
          code: "EDG-CLOSED-" + label, status: "filled", orgUnitId: e.unit.id },
      ]).returning();
      const [job, closedJob] = await db.insert(s.jobRequisitions).values([
        { organizationId: e.org.id, positionId: position.id,
          title: e.marker + " fictional career opening",
          department: e.marker + " recruiting", status: "open" },
        { organizationId: e.org.id, positionId: closedPosition.id,
          title: e.marker + " closed career opening",
          department: e.marker + " recruiting", status: "filled" },
      ]).returning();
      await db.insert(s.jobApplicants).values({
        organizationId: e.org.id, requisitionId: job.id,
        fullName: e.marker + " fictional applicant",
        email: "edg01-" + label.toLowerCase() + "-" + nonce + "@example.invalid",
      });
      // A real fictional draft payroll source makes the no-payroll-change
      // assertion nonvacuous while never calculating or releasing payments.
      await db.insert(s.payrollRuns).values({
        organizationId: e.org.id, legalEntityId: e.entity.id,
        periodLabel: "FICTIONAL " + label + " October 2026",
        periodStart: "2026-10-01", periodEnd: "2026-10-15",
        payDate: "2026-10-20", status: "Draft",
      });

      // Independently authenticated unit-only HR, to verify that tenant
      // membership alone cannot grant a company-wide publication decision.
      const [unitHr] = await db.insert(s.users).values({
        email: "unit-hr-" + label.toLowerCase() + "-" + nonce + "@example.invalid",
        name: "Synthetic unit HR " + e.marker, role: "hr",
        passwordHash: "fictional-only", totpEnabled: true,
      }).returning();
      await db.insert(s.userOrganizations).values({
        userId: unitHr.id, organizationId: e.org.id,
        role: "hr", orgUnitId: e.unit.id, active: true,
      });
      const unitSession = await standaloneMakeSession(unitHr.id);
      await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
        .where(eq(s.sessions.id, unitSession.id));
      const [employeeActor] = await db.insert(s.users).values({
        email: "ess-careers-" + label.toLowerCase() + "-" + nonce + "@example.invalid",
        name: "Fictional employee " + e.marker, role: "employee",
        employeeId: e.worker.id, passwordHash: "fictional-only",
      }).returning();
      await db.insert(s.userOrganizations).values({
        userId: employeeActor.id, organizationId: e.org.id,
        role: "employee", active: true, workerEmployeeId: e.worker.id,
      });
      const employeeSession = await standaloneMakeSession(employeeActor.id);
      e.profile = profile; e.position = position; e.job = job;
      e.closedJob = closedJob; e.unitHrCookie = unitSession.cookie;
      e.employeeCookie = employeeSession.cookie;
      e.ownerSessionId = (await db.select({ id: s.sessions.id }).from(s.sessions)
        .where(eq(s.sessions.userId, e.owner.id)).limit(1))[0].id;
      employers.push(e);
    }
    const [a, b, victim] = employers;
    for (const field of ["org", "worker", "position", "job"]) {
      const target = victim[field].id;
      assert.ok(target > a[field].id && target > b[field].id,
        "victim " + field + " requires real higher persisted ID");
    }

    const snapshot = async id => {
      const rows = table => db.select().from(table)
        .where(eq(table.organizationId, id)).orderBy(asc(table.id));
      const [organization, entities, units, memberships, workers,
        payProfiles, profiles, positions, applicants, payroll, audits, rawJobs] =
        await Promise.all([
          db.select().from(s.organizations).where(eq(s.organizations.id, id)),
          rows(s.legalEntities), rows(s.orgUnits), rows(s.userOrganizations),
          rows(s.employees), rows(s.employeePayProfiles), rows(s.jobProfiles),
          rows(s.positions), rows(s.jobApplicants), rows(s.payrollRuns),
          rows(s.auditEvents).then(invariant.auditBusinessSnapshot),
          pool.query("select * from job_requisitions where organization_id=$1 order by id", [id]),
        ]);
      return { organization, entities, units, memberships, workers, payProfiles,
        profiles, positions, applicants, payroll, audits, jobs: rawJobs.rows };
    };
    const snapshotAll = () => Promise.all(employers.map(e => snapshot(e.org.id)));
    const patch = (actor, organizationId, requisitionId,
      published, expectedPublished, cookie = actor.cookie) =>
      standaloneRequest(PATH, { method: "PATCH", cookie,
        body: { organizationId, requisitionId, published, expectedPublished } });
    const forbidden = [victim.marker, victim.job.title, victim.closedJob.title];
    let successes = 0, denials = 0;
    const expectDenied = async (promise, status, label) => {
      const before = await snapshotAll();
      const response = await promise();
      assertDenied(response, status, forbidden);
      assertUnchanged(before, await snapshotAll(), label);
      denials++;
    };
    const publishOrUnpublish = async (e, published) => {
      const before = await snapshotAll();
      const response = await patch(e, e.org.id, e.job.id, published, !published);
      assert.equal(response.status, 200, e.label + " legitimate publication: " + response.text.slice(0, 160));
      assert.deepEqual(response.json, { id: e.job.id, published });
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
      const after = await snapshotAll(), i = employers.indexOf(e);
      assertPublicationTransition(before[i], after[i], {
        organizationId: e.org.id, requisitionId: e.job.id,
        actorUserId: e.owner.id, actorName: e.owner.name, published,
      });
      for (let j = 0; j < employers.length; j++)
        if (j !== i) assertUnchanged(before[j], after[j],
          e.label + " own publication cannot mutate another employer");
      successes++;
    };

    // Every real employer has a populated, independent own positive.
    for (const e of employers) await publishOrUnpublish(e, true);
    for (const attacker of [a, b]) {
      // A foreign employer ID must be refused before target content, even if
      // both the employer and requisition IDs are genuine and higher.
      await expectDenied(() => patch(attacker, victim.org.id, victim.job.id, false, true),
        403, attacker.label + " foreign employer");
      // A forged victim requisition ID under the attacker's *own* employer
      // cannot pass the composite UPDATE predicate, including the CAS column.
      await expectDenied(() => patch(attacker, attacker.org.id, victim.job.id, false, true),
        409, attacker.label + " higher-ID victim requisition forged in own employer");
      await expectDenied(() => patch(attacker, attacker.org.id, attacker.closedJob.id, true, false),
        409, attacker.label + " closed position cannot be published");
      await expectDenied(() => patch(attacker, attacker.org.id, attacker.job.id, true, false),
        409, attacker.label + " stale expected publication state");
      await expectDenied(() => patch(attacker, attacker.org.id, attacker.job.id, false, true,
        attacker.unitHrCookie), 403, attacker.label + " unit HR is not company-wide");
      await expectDenied(() => patch(attacker, attacker.org.id, attacker.job.id, false, true,
        attacker.employeeCookie), 403, attacker.label + " ordinary employee cannot publish");
      await expectDenied(() => patch(attacker, attacker.org.id, attacker.job.id, false, true,
        null), 401, attacker.label + " anonymous request cannot publish");

      // Actual MFA revocation on the existing real session must refuse
      // the privileged action, with no changes or audit side effects.
      await db.update(s.sessions).set({ mfaVerifiedAt: null })
        .where(eq(s.sessions.id, attacker.ownerSessionId));
      await expectDenied(() => patch(attacker, attacker.org.id, attacker.job.id, false, true),
        403, attacker.label + " stale MFA cannot publish");
      await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
        .where(eq(s.sessions.id, attacker.ownerSessionId));

      // A legitimate unpublish, and then a stale second unpublish, must
      // produce exactly one real status change and one business audit.
      await publishOrUnpublish(attacker, false);
      await expectDenied(() => patch(attacker, attacker.org.id, attacker.job.id, false, true),
        409, attacker.label + " repeated unpublish is not idempotent publication");
    }
    assert.equal(successes, 5);
    assert.equal(denials, 18);
    const final = await snapshotAll();
    assert.equal(final[2].jobs.find(j => j.id === victim.job.id).careers_published, true,
      "the victim's genuine published opening remains visible to its own tenant");
    assert.equal(final[2].payroll.length, 1,
      "victim draft payroll source remains intact");
    console.log("EDG01_CAREERS_PUBLICATION_REAL_HTTP " + JSON.stringify({
      method: METHOD, employers: 3, independentAttackers: 2,
      higherIdPopulatedVictim: true, realOwnedPublishes: 3,
      realOwnedUnpublishes: 2, verifiedDeniedCalls: denials,
      wrongEmployerAndObjectRefused: true, companyWideOnly: true,
      staleAndClosedBlocked: true, realMfaRevocationDenied: true,
      victimAndDraftPayrollUnchanged: true,
      disposablePg16: true, localhostProductionMode: true,
      coverageCredits: 0, globalTenantIsolationAccepted: false,
      productionCertified: false, moneyMoved: false,
      independentSecurityReviewPending: true,
    }));
  } finally {
    await pool.end();
  }
}

const task = process.argv[2];
if (!["--migrate", "--prove"].includes(task)) {
  console.error("EDG01_CAREERS_REFUSED: only --migrate or --prove in isolated CI");
  process.exitCode = 2;
} else {
  (task === "--migrate" ? migrate() : prove()).catch(err => {
    console.error("EDG01_CAREERS_FAILED", err instanceof Error ? err.stack : String(err));
    process.exitCode = 1;
  });
}
