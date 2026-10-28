/**
 * Recovers exactly one API-method GAP with the four-part executed proof.
 * POST manager-attestation is deliberately OUT OF SCOPE.
 * This script NEVER imports the app/database until disposable CI has been checked.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export const METHOD = "GET hcm/employment-term-decisions/[id]/manager-attestation";
export const PATH = "/api/hcm/employment-term-decisions/";

export function requireDisposableAttestationRecovery(env = process.env) {
  for (const [name, value] of Object.entries({
    GITHUB_ACTIONS: "true",
    CI: "true",
    NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_TABLE_PROFILE: "default",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    DEMO_MODE: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
  })) {
    assert.equal(env[name], value,
      "MANAGER_ATTESTATION_RECOVERY_REFUSED: expected disposable " + name);
  }
  for (const secret of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "RESEND_API_KEY"]) {
    assert.ok(!env[secret],
      "MANAGER_ATTESTATION_RECOVERY_REFUSED: external provider credential " + secret);
  }
}

export function routeFor(decisionId, organizationId, extraQuery = "") {
  for (const [label, value] of [["decisionId", decisionId], ["organizationId", organizationId]]) {
    assert.ok(Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647,
      "MANAGER_ATTESTATION_RECOVERY_REFUSED: invalid " + label);
  }
  assert.ok(extraQuery === "" || /^&[A-Za-z0-9_=&]+$/.test(extraQuery),
    "MANAGER_ATTESTATION_RECOVERY_REFUSED: unsafe forged selector probe");
  return PATH + decisionId + "/manager-attestation?organizationId=" + organizationId + extraQuery;
}

export function assertRefused(reply, expectedStatus, forbiddenMarkers, label) {
  assert.equal(reply.status, expectedStatus,
    label + " must return HTTP " + expectedStatus + " (actual " + reply.status + ")");
  assert.ok(typeof reply.text === "string" && reply.text.length <= 1200,
    label + ": denial response must be bounded");
  assert.ok(reply.json && typeof reply.json.error === "string",
    label + ": denial must be an error, not empty/default data");
  assert.equal(reply.json.attestations, undefined,
    label + ": unauthorized response cannot contain an attestation list");
  for (const marker of forbiddenMarkers) {
    assert.ok(!reply.text.includes(marker),
      label + ": foreign private employer, decision or attestation marker leaked");
  }
}

export function assertSourceUnchanged(before, after, label) {
  assert.deepEqual(after, before,
    label + ": employment decisions, manager attestations, people, audit and payroll must remain byte-identical");
}

async function execute() {
  // Do this before ANY application, database, runtime environment or network import.
  requireDisposableAttestationRecovery();
  const [{ db, pool }, schema, orm, shared, rowModule, invariant] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
    import("./tenant-table-rows/read/hcm-manager-attestation.mjs"),
    import("./tenant-table-invariants.mjs"),
  ]);
  const { eq, inArray } = orm;
  const {
    organizations, employees, employeePayProfiles, orgUnits, legalEntities,
    userOrganizations, users, auditEvents, jobProfiles, positions,
    positionAssignments, hcmEmploymentTerms, hcmEmploymentTermDecisions,
    hcmEmploymentDecisionManagerAttestations, payrollRuns, payrollEntries,
    payoutBatches,
  } = schema;
  const {
    requireTenantTableDisposable, seedEmployer, standaloneMakeSession,
    standaloneRequest, standaloneExpectStatus, addWorker,
  } = shared;
  const { auditBusinessSnapshot } = invariant;
  requireTenantTableDisposable();

  const readBusiness = async organizationId => {
    const scoped = table => db.select().from(table)
      .where(eq(table.organizationId, organizationId)).orderBy(table.id);
    const [org, staff, profiles, units, entities, memberships, audit,
      jobs, positionsOwned, assignments, terms, decisions, attestations,
      payroll, payouts] = await Promise.all([
        db.select().from(organizations).where(eq(organizations.id, organizationId)),
        scoped(employees), scoped(employeePayProfiles), scoped(orgUnits),
        scoped(legalEntities), scoped(userOrganizations), scoped(auditEvents),
        scoped(jobProfiles), scoped(positions), scoped(positionAssignments),
        scoped(hcmEmploymentTerms), scoped(hcmEmploymentTermDecisions),
        scoped(hcmEmploymentDecisionManagerAttestations), scoped(payrollRuns),
        scoped(payoutBatches),
      ]);
    const entries = payroll.length ? await db.select().from(payrollEntries)
      .where(inArray(payrollEntries.payrollRunId, payroll.map(run => run.id)))
      .orderBy(payrollEntries.id) : [];
    return JSON.parse(JSON.stringify({
      org, staff, profiles, units, entities, memberships,
      audit: auditBusinessSnapshot(audit),
      jobs, positionsOwned, assignments, terms, decisions, attestations,
      payroll, entries, payouts,
    }));
  };

  try {
    // A genuinely empty disposable DB, not an existing shared tenant or snapshot.
    assert.equal((await db.select({ id: organizations.id }).from(organizations).limit(1)).length,
      0, "MANAGER_ATTESTATION_RECOVERY_REFUSED: organizations must be empty");
    assert.equal((await db.select({ id: auditEvents.id }).from(auditEvents).limit(1)).length,
      0, "MANAGER_ATTESTATION_RECOVERY_REFUSED: audit events must be empty");

    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = await seedEmployer("ATTA", nonce, standaloneMakeSession);
    const b = await seedEmployer("ATTB", nonce, standaloneMakeSession);
    const victim = await seedEmployer("VICTIM", nonce, standaloneMakeSession);
    const owners = [a, b, victim];
    const [row] = rowModule.createRows({ assert, db, addWorker, rowTables: schema });
    assert.equal(row.key, METHOD);
    assert.deepEqual(row.pathIds, { id: "id" });
    for (const employer of owners) {
      employer.seeded = await row.seed(employer);
    }
    for (const field of ["org", "entity", "unit", "worker"]) {
      assert.ok(victim[field].id > a[field].id && victim[field].id > b[field].id,
        "real higher-ID victim requires persisted " + field);
    }
    for (const field of ["id", "attestationId", "workerId", "managerId",
      "positionId", "assignmentId"]) {
      assert.ok(victim.seeded[field] > a.seeded[field]
        && victim.seeded[field] > b.seeded[field],
      "real victim " + field + " must exceed both attacker IDs");
    }
    assert.ok(new Set(owners.map(e => e.seeded.statement)).size === 3,
      "attestations require three distinct employer-specific persisted statements");

    // A legitimate employee of A is not a People administrator or manager.
    const [employeeLogin] = await db.insert(users).values({
      name: "Fictional unprivileged manager-attestation reader " + a.marker,
      email: "manager-attestation-unauthorized-" + randomUUID() + "@example.invalid",
      passwordHash: "synthetic-session-only", role: "employee",
      employeeId: a.worker.id, active: true,
    }).returning({ id: users.id });
    await db.insert(userOrganizations).values({
      userId: employeeLogin.id, organizationId: a.org.id,
      role: "employee", active: true, workerEmployeeId: a.worker.id,
    });
    const employeeCookie = (await standaloneMakeSession(employeeLogin.id)).cookie;

    const before = new Map();
    for (const e of owners) before.set(e.org.id, await readBusiness(e.org.id));

    const victimOwn = standaloneExpectStatus(await standaloneRequest(
      routeFor(victim.seeded.id, victim.org.id), { cookie: victim.cookie }),
      200, "real victim's own existing attestation is accessible");
    assert.equal(victimOwn.json?.attestations?.length, 1);
    assert.equal(victimOwn.json.attestations[0].id, victim.seeded.attestationId);
    assert.equal(victimOwn.json.attestations[0].statement, victim.seeded.statement);

    let ownPositives = 0, realVictimDenials = 0, stolenIdDenials = 0;
    let ignoredSpoofSelectors = 0;
    let earlierOwn = null;
    for (const [attacker, other] of [[a, b], [b, a]]) {
      const ctx = {
        orgId: attacker.org.id, seeded: attacker.seeded,
        marker: attacker.marker, victim,
      };
      const own = standaloneExpectStatus(await standaloneRequest(
        routeFor(attacker.seeded.id, attacker.org.id), { cookie: attacker.cookie }),
        200, "signed-in owner receives populated own manager attestation");
      row.prove(own, ctx);
      if (earlierOwn) {
        assert.throws(() => row.prove(earlierOwn, ctx),
          "an actual authenticated other-employer response must fail own evidence");
      }
      earlierOwn = own;
      ownPositives++;

      // The actual higher-ID victim organization's genuine path is denied.
      const foreign = await standaloneRequest(
        routeFor(victim.seeded.id, victim.org.id), { cookie: attacker.cookie });
      assertRefused(foreign, 403, [victim.marker, victim.seeded.statement],
        "real higher-ID foreign employer and decision");
      realVictimDenials++;

      // The previously missing test: borrow a genuine victim path ID while
      // keeping a valid OWN organization selector and signed-in own cookie.
      const stolenVictimPath = await standaloneRequest(
        routeFor(victim.seeded.id, attacker.org.id), { cookie: attacker.cookie });
      assertRefused(stolenVictimPath, 404, [victim.marker, victim.seeded.statement],
        "forged high-ID victim decision inside attacker's own employer");
      stolenIdDenials++;

      const stolenPeerPath = await standaloneRequest(
        routeFor(other.seeded.id, attacker.org.id), { cookie: attacker.cookie });
      assertRefused(stolenPeerPath, 404, [other.marker, other.seeded.statement,
        victim.marker, victim.seeded.statement],
      "forged other attacker decision under own employer");
      stolenIdDenials++;

      const forgedQuery = routeFor(attacker.seeded.id, attacker.org.id,
        "&decisionId=" + victim.seeded.id + "&employeeId=" + victim.seeded.workerId
        + "&managerEmployeeId=" + victim.seeded.managerId
        + "&userId=" + victim.owner.id);
      const ignored = standaloneExpectStatus(await standaloneRequest(
        forgedQuery, { cookie: attacker.cookie }), 200, "forged extra selector control");
      row.prove(ignored, ctx);
      assert.deepEqual(ignored.json, own.json,
        "query-only victim selectors cannot override the real path/tenant guard");
      ignoredSpoofSelectors++;

      const invalidForeign = await standaloneRequest(
        routeFor(attacker.seeded.id, victim.org.id), { cookie: attacker.cookie });
      assertRefused(invalidForeign, 403, [victim.marker, victim.seeded.statement],
        "own path ID with forged real victim employer");
      realVictimDenials++;
    }

    const unprivileged = await standaloneRequest(
      routeFor(a.seeded.id, a.org.id), { cookie: employeeCookie });
    assertRefused(unprivileged, 403, [a.seeded.statement, victim.seeded.statement],
      "actual same-employer employee without HCM read role");
    const anonymous = await standaloneRequest(routeFor(victim.seeded.id, victim.org.id));
    assertRefused(anonymous, 401, [victim.marker, victim.seeded.statement],
      "anonymous real-victim manager attestation");

    for (const e of owners) {
      assertSourceUnchanged(before.get(e.org.id), await readBusiness(e.org.id),
        e.label + " own, forged and denied reads");
    }
    assert.equal(ownPositives, 2);
    assert.equal(realVictimDenials, 4);
    assert.equal(stolenIdDenials, 4);
    assert.equal(ignoredSpoofSelectors, 2);
    console.log(JSON.stringify({
      kind: "tenant-hcm-manager-attestation-gap-recovery",
      method: METHOD, http: "localhost-production-mode",
      engine: "fictional-postgresql-16",
      independentEmployerAttackers: 2,
      genuineHigherIdVictim: true,
      realOwnAttestationReadPositives: ownPositives,
      foreignOrganizationDenials: realVictimDenials,
      forgedStolenPathIdDenials: stolenIdDenials,
      ignoredForeignQuerySelectors: ignoredSpoofSelectors,
      unprivilegedAndAnonymousDenials: true,
      ownAndVictimEmploymentDecisionAttestationAuditAndPayrollUnchanged: true,
      postManagerAttestationCredited: false,
      manifestCreditsApplied: 0,
      productionTested: false, accepted: false,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/")
  .endsWith("/tenant-hcm-manager-attestation-recovery-http.mjs")) {
  execute().catch(error => { console.error(error); process.exitCode = 1; });
}
