/**
 * Synthetic authenticated PostgreSQL 16 / localhost HTTP test for exactly
 * GET /api/self/take-home-estimate. No live wages, providers or payments.
 *
 *   node --import tsx scripts/qa/tenant-self-take-home-http.mjs seed >> "$GITHUB_ENV"
 *   node --import tsx scripts/qa/tenant-self-take-home-http.mjs prove
 *
 * Guard first. Do not import the application or database before this check.
 */
import assert from "node:assert/strict";
import {
  constants, closeSync, fstatSync, lstatSync, mkdtempSync,
  openSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  ENDPOINT, METHOD, requireDisposableTakeHome, assertOwnTakeHome,
  assertPrivateDenial, assertUnchanged,
} from "./tenant-self-take-home-contract.mjs";

const stage = process.argv[2];
requireDisposableTakeHome(process.env, stage);
const JSONcopy = value => JSON.parse(JSON.stringify(value));

function fixturePath() {
  const path = process.env.TENANT_SELF_TAKE_HOME_FIXTURE_FILE;
  assert.match(path ?? "",
    /^\/tmp\/tenant-self-take-home-[A-Za-z0-9]{6}\/fixture\.json$/,
    "only a randomized private CI fixture path is accepted");
  return path;
}
function readFixture() {
  const path = fixturePath();
  const directory = lstatSync(dirname(path));
  assert.ok(directory.isDirectory() && !directory.isSymbolicLink() &&
    (directory.mode & 0o777) === 0o700 &&
    directory.uid === process.getuid(), "fixture directory must be private and owned");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    assert.ok(stat.isFile() && stat.nlink === 1 &&
      stat.uid === process.getuid() && (stat.mode & 0o777) === 0o600 &&
      stat.size > 0 && stat.size < 16000, "fixture file must be owner-only");
    const data = JSON.parse(readFileSync(fd, "utf8"));
    assert.equal(data.schemaVersion, 1);
    assert.deepEqual(data.employers.map(e => e.label), ["ATTA", "ATTB", "VICTIM"]);
    return data;
  } finally { closeSync(fd); }
}
async function deps() {
  const [{ db, pool }, s, t, { and, eq, asc },
    { auditBusinessSnapshot }, { estimateMonthlyTakeHome }] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("./tenant-table-http.mjs"), import("drizzle-orm"),
    import("./tenant-table-invariants.mjs"),
    import("../../src/lib/take-home-estimate.ts"),
  ]);
  return { db, pool, s, t, and, eq, asc, auditBusinessSnapshot, estimateMonthlyTakeHome };
}
const specs = {
  ATTA: { payBasis: "daily", rateAmount: "720.00", monthlyBasic: 15840, mwe: true },
  ATTB: { payBasis: "hourly", rateAmount: "375.00", monthlyBasic: 66000, mwe: false },
  VICTIM: { payBasis: "monthly", rateAmount: "88500.00", monthlyBasic: 88500, mwe: false },
};
async function seed() {
  const { db, pool, s, t, and, eq } = await deps();
  try {
    assert.equal((await db.select({ id: s.organizations.id }).from(s.organizations).limit(1)).length, 0,
      "TAKE_HOME_REFUSED: seed only into an empty disposable app_db");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
    const employers = [];
    const createEmployeeLogin = async (orgId, employeeId, marker, nameSuffix) => {
      const [login] = await db.insert(s.users).values({
        email: (marker + "-" + nameSuffix).toLowerCase() + "@example.invalid",
        name: marker + " fictional " + nameSuffix, role: "employee",
        employeeId, passwordHash: "fictional-never-a-login",
      }).returning();
      const [membership] = await db.insert(s.userOrganizations).values({
        userId: login.id, organizationId: orgId, role: "employee",
        workerEmployeeId: employeeId, active: true,
      }).returning();
      const session = await t.standaloneMakeSession(login.id);
      return { userId: login.id, membershipId: membership.id, cookie: session.cookie };
    };

    for (const label of ["ATTA", "ATTB", "VICTIM"]) {
      const e = await t.seedEmployer(label, nonce, t.standaloneMakeSession);
      const spec = specs[label];
      const [profile] = await db.update(s.employeePayProfiles).set({
        payBasis: spec.payBasis, rateAmount: spec.rateAmount,
        standardWorkDaysPerMonth: "22.00", standardHoursPerDay: "8.00",
      }).where(and(
        eq(s.employeePayProfiles.organizationId, e.org.id),
        eq(s.employeePayProfiles.employeeId, e.worker.id),
      )).returning();
      const [worker] = await db.update(s.employees).set({ mwe: spec.mwe }).where(and(
        eq(s.employees.organizationId, e.org.id),
        eq(s.employees.id, e.worker.id),
      )).returning();
      assert.equal(profile.employeeId, e.worker.id);
      assert.equal(profile.organizationId, e.org.id);
      assert.equal(worker.mwe, spec.mwe);
      assert.equal(Number(worker.basicRate), 20000,
        "fallback basic rate must differ from tested source profile");
      const self = await createEmployeeLogin(e.org.id, e.worker.id, e.marker, "self");
      employers.push({
        label, marker: e.marker, orgId: e.org.id, workerId: e.worker.id,
        profileId: profile.id, ownerCookie: e.cookie, ...spec, ...self,
      });
      if (label === "ATTA") {
        const peer = await t.addWorker(e, "PEER");
        const [peerProfile] = await db.update(s.employeePayProfiles).set({
          payBasis: "monthly", rateAmount: "97300.00",
        }).where(and(
          eq(s.employeePayProfiles.organizationId, e.org.id),
          eq(s.employeePayProfiles.employeeId, peer.id),
        )).returning();
        const peerSelf = await createEmployeeLogin(e.org.id, peer.id, e.marker, "peer");
        employers[0].peer = {
          label: "ATTA-PEER", marker: e.marker + "-PEER",
          orgId: e.org.id, workerId: peer.id, profileId: peerProfile.id,
          payBasis: "monthly", monthlyBasic: 97300, mwe: false, ...peerSelf,
        };
      }
    }
    const [a, b, victim] = employers;
    for (const attacker of [a, b]) {
      for (const key of ["orgId", "workerId", "profileId"]) {
        assert.ok(victim[key] > attacker[key], "real higher-ID victim " + key);
      }
    }
    assert.notEqual(a.monthlyBasic, b.monthlyBasic);
    assert.notEqual(a.monthlyBasic, victim.monthlyBasic);
    assert.notEqual(a.peer.monthlyBasic, a.monthlyBasic);

    // Actual login linked to the higher-ID victim, but with ONLY attacker-org
    // membership. EmployeeId alone is never an authorization grant.
    const forged = [];
    for (const actor of [a, b]) {
      const [user] = await db.insert(s.users).values({
        email: actor.marker.toLowerCase() + "-forged@example.invalid",
        name: actor.marker + " fictional forged user", role: "employee",
        employeeId: victim.workerId, passwordHash: "fictional-never-a-login",
      }).returning();
      await db.insert(s.userOrganizations).values({
        userId: user.id, organizationId: actor.orgId,
        role: "employee", active: true,
      });
      const session = await t.standaloneMakeSession(user.id);
      forged.push({ label: actor.label, cookie: session.cookie });
    }
    const [noWorker] = await db.insert(s.users).values({
      email: a.marker.toLowerCase() + "-unlinked@example.invalid",
      name: a.marker + " unlinked", role: "employee", employeeId: null,
      passwordHash: "fictional-never-a-login",
    }).returning();
    await db.insert(s.userOrganizations).values({
      userId: noWorker.id, organizationId: a.orgId, role: "employee", active: true,
    });
    const noWorkerSession = await t.standaloneMakeSession(noWorker.id);

    const dir = mkdtempSync(join(tmpdir(), "tenant-self-take-home-"));
    const path = join(dir, "fixture.json");
    const fd = openSync(path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      writeFileSync(fd, JSON.stringify({
        schemaVersion: 1, employers, forged, noWorkerCookie: noWorkerSession.cookie,
      }));
    } finally { closeSync(fd); }
    // Emit only the private fixture PATH, never fictional session credentials.
    process.stdout.write("TENANT_SELF_TAKE_HOME_FIXTURE_FILE=" + path + "\n");
  } finally { await pool.end(); }
}
async function prove() {
  const fixture = readFixture();
  const [a, b, victim] = fixture.employers;
  const { db, pool, s, t, and, eq, asc, auditBusinessSnapshot, estimateMonthlyTakeHome } = await deps();
  const request = (cookie, query = "") =>
    t.standaloneRequest(ENDPOINT + query, { method: "GET", cookie });
  const snapshot = async orgId => {
    const rows = table => db.select().from(table)
      .where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
    const [orgs, staff, payProfiles, payroll, entries, audit, memberships] = await Promise.all([
      db.select().from(s.organizations).where(eq(s.organizations.id, orgId)),
      rows(s.employees), rows(s.employeePayProfiles),
      rows(s.payrollRuns), rows(s.payrollEntries), rows(s.auditEvents),
      rows(s.userOrganizations),
    ]);
    return JSONcopy({
      orgs, staff, payProfiles, payroll, entries,
      audit: auditBusinessSnapshot(audit), memberships,
    });
  };
  const noForeign = (response, actor) => {
    for (const other of fixture.employers.filter(e => e.label !== actor.label)) {
      assert.ok(!response.text.includes(other.marker), "foreign employer identity leaked");
    }
    assert.ok(!response.text.includes(actor.marker),
      "self-estimate should contain neither raw employee identity nor payroll source rows");
  };
  const own = async (actor, query = "") => {
    const response = await request(actor.cookie, query);
    const data = assertOwnTakeHome(response, actor);
    assert.deepEqual(data.estimate, estimateMonthlyTakeHome({
      monthlyBasic: actor.monthlyBasic, mwe: actor.mwe, asOf: data.asOf,
    }), "source-only projected pay must exactly match current estimator, not another user's salary");
    noForeign(response, actor);
    return response;
  };
  const denied = async (cookie, status, label, markers = [victim.marker]) => {
    const response = await request(cookie);
    assertPrivateDenial(response, status, markers);
    return response;
  };
  try {
    const source = new Map();
    for (const actor of fixture.employers) source.set(actor.orgId, await snapshot(actor.orgId));
    const victimOwn = await own(victim);
    const first = await own(a);
    const second = await own(b);
    assert.throws(() => assertOwnTakeHome(first, b),
      "A's actual HTTP body must fail B's independent positive assertion");
    assert.throws(() => assertOwnTakeHome(second, a),
      "B's actual HTTP body must fail A's independent positive assertion");
    assert.throws(() => assertOwnTakeHome(victimOwn, a),
      "victim's actual HTTP body cannot be accepted as attacker data");

    for (const actor of [a, b]) {
      const forgedQuery = "?organizationId=" + victim.orgId +
        "&employeeId=" + victim.workerId + "&payBasis=monthly&monthlyBasic=" +
        victim.monthlyBasic + "&mwe=false";
      await own(actor, forgedQuery);
      const peerQuery = "?organizationId=" + a.orgId +
        "&employeeId=" + a.peer.workerId;
      await own(actor, peerQuery);
    }
    // Same-employer cross-worker IDOR: a separate real signed-in employee
    // sees their own 97,300 baseline; original A cannot select it by query.
    const peerResponse = await own(a.peer);
    assert.throws(() => assertOwnTakeHome(peerResponse, a),
      "same-employer peer pay must not pass A's own-salary assertion");
    await own(a, "?employeeId=" + a.peer.workerId);

    await denied(undefined, 401, "anonymous");
    await denied(a.ownerCookie, 403, "owner must not use employee-only endpoint");
    await denied(b.ownerCookie, 403, "other owner must not use employee-only endpoint");
    await denied(fixture.noWorkerCookie, 403, "unlinked employee must be denied");
    for (const forged of fixture.forged) {
      await denied(forged.cookie, 403, forged.label + " linked to victim without membership");
    }
    for (const actor of fixture.employers) {
      assertUnchanged(source.get(actor.orgId), await snapshot(actor.orgId),
        actor.label + " positive, forged and denied GET requests");
    }

    // Real membership revocation must deny even a previously successful
    // employee cookie; the only intentional SQL mutation is this fixture step.
    const [revoked] = await db.update(s.userOrganizations).set({ active: false })
      .where(and(eq(s.userOrganizations.organizationId, b.orgId),
        eq(s.userOrganizations.userId, b.userId))).returning();
    assert.equal(revoked.id, b.membershipId);
    const revokedBaseline = await snapshot(b.orgId);
    await denied(b.cookie, 403, "revoked B membership");
    assertUnchanged(revokedBaseline, await snapshot(b.orgId),
      "revocation denial must not change the already-revoked employer");
    for (const actor of [a, victim]) {
      assertUnchanged(source.get(actor.orgId), await snapshot(actor.orgId),
        "revocation must not change a different employer " + actor.label);
    }
    console.log(JSON.stringify({
      kind: "tenant-self-take-home-pg16-http", method: METHOD,
      realPostgreSQL16AndLocalhostHttp: true,
      authenticatedIndependentEmployees: 3,
      higherIdVictimOwnPositive: true,
      peerEmployeeOwnPositive: true,
      forgedSelectorProofs: 5,
      forgedVictimEmployeeLinkDenials: fixture.forged.length,
      ownerAndAnonymousDenied: true, revokedMembershipDenied: true,
      sourceRowsUnchangedAfterRequests: true,
      moneyOrProviderMovement: false, coverageCredits: 0,
      productionTested: false, certified: false,
    }));
  } finally {
    await pool.end();
    rmSync(dirname(fixturePath()), { recursive: true, force: true });
  }
}
(stage === "seed" ? seed() : prove()).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
