/**
 * Partial HCM employee-skill POST proof on disposable PostgreSQL 16 and real
 * local production-mode HTTP. There is already a distinct shared-table method
 * row for POST hcm/capabilities (set_job_skill): do NOT add a duplicate row.
 * This runner exercises the separate set_employee_skill action independently.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRows } from "./tenant-hcm-employee-skills-contract.mjs";

const methodKey = "POST hcm/capabilities";
const endpoint = "/api/hcm/capabilities";
const plain = value => JSON.parse(JSON.stringify(value));

export function requireDisposableHcmSkills(env = process.env) {
  assert.equal(env.GITHUB_ACTIONS, "true", "HCM_SKILLS_REFUSED: GitHub fixture only");
  assert.equal(env.CI, "true");
  assert.equal(env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(env.NODE_ENV, "production");
  assert.equal(env.SECURITY_SMOKE_URL, "http://127.0.0.1:3000");
  assert.equal(env.DATABASE_URL, "postgresql://postgres:postgres@127.0.0.1:5432/app_db");
  for (const flag of ["PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED", "XENDIT_BILLING_ENABLED"]) {
    assert.equal(env[flag], "false", "HCM_SKILLS_REFUSED: no money/provider flags");
  }
  for (const secret of [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL",
  ]) assert.ok(!env[secret], "HCM_SKILLS_REFUSED: no live provider secrets");
  return true;
}

export async function verifyHcmEmployeeSkillsHttp() {
  // Guard before loading *any* application DB/client modules.
  requireDisposableHcmSkills();
  const [{ db, pool }, schema, orm, table, invariants] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
    import("./tenant-table-invariants.mjs"),
  ]);
  const { asc, eq } = orm;
  const { seedEmployer, standaloneMakeSession, standaloneRequest, standaloneExpectStatus,
    victimSnapshot, requireTenantTableDisposable } = table;
  const { auditBusinessSnapshot, seedTableRow } = invariants;
  const { hcmSkills, employees, employeePayProfiles, payrollRuns,
    hcmJobProfileSkillRequirements, auditEvents, organizations } = schema;

  try {
    requireTenantTableDisposable();
    const preexisting = await db.select({ id: organizations.id }).from(organizations).limit(1);
    assert.equal(preexisting.length, 0,
      "HCM_SKILLS_REFUSED: must begin with an empty disposable organization table");
    const [row] = createRows({
      assert, db, eq, asc, hcmSkills, employees, employeePayProfiles,
      payrollRuns, hcmJobProfileSkillRequirements, auditEvents,
      auditBusinessSnapshot, pool,
    });
    assert.equal(row.key, methodKey);
    assert.equal(row.forged?.status, 404);
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const attackerA = await seedEmployer("ATTA", nonce, standaloneMakeSession);
    const attackerB = await seedEmployer("ATTB", nonce, standaloneMakeSession);
    const victim = await seedEmployer("VICTIM", nonce, standaloneMakeSession);
    assert.notEqual(attackerA.cookie, attackerB.cookie,
      "each attacker must hold an independently authenticated session");
    assert.ok(victim.org.id > attackerA.org.id && victim.org.id > attackerB.org.id);
    assert.ok(victim.worker.id > attackerA.worker.id && victim.worker.id > attackerB.worker.id);
    const employers = [victim, attackerA, attackerB];
    await seedTableRow(row, employers);
    const victimSeeded = victim.seeded[methodKey];
    assert.ok(victimSeeded.id > attackerA.seeded[methodKey].id
      && victimSeeded.id > attackerB.seeded[methodKey].id,
      "actual victim skill ID must exceed both attackers' IDs");

    const victimBefore = plain(await row.state(victim.org.id));
    const victimCoreBefore = plain(await victimSnapshot(victim.org.id));
    assert.equal(victimBefore.assignments.length, 1,
      "victim must have a genuinely saved historical skill assignment");
    assert.equal(victimBefore.skills.length, 1,
      "victim must have a genuinely persisted private skill definition");

    let first = null;
    let ownWrites = 0, foreignDenials = 0, forgedDenials = 0;
    for (const own of [attackerA, attackerB]) {
      const ctx = {
        org: own.org, orgId: own.org.id,
        entity: own.entity, entityId: own.entity.id,
        unit: own.unit, unitId: own.unit.id,
        worker: own.worker, workerId: own.worker.id,
        owner: own.owner, marker: own.marker, rank: own.rank,
        seeded: own.seeded[methodKey], victim, victimSeeded,
      };
      assert.ok(ctx.seeded?.id && ctx.seeded.previousId);
      const before = plain(await row.state(own.org.id));
      assert.equal(before.assignments.length, 1);
      const ownResponse = standaloneExpectStatus(await standaloneRequest(endpoint, {
        method: "POST", cookie: own.cookie, body: row.ownBody(ctx),
      }), 200, "owned HCM unverified skill declaration must be accepted");
      const after = plain(await row.state(own.org.id));
      assert.notDeepEqual(after, before, "own write must actually change PostgreSQL business rows");
      row.expect(before, after, ctx, ownResponse);
      assert.ok(!ownResponse.text.includes(victim.marker), "own HTTP success leaked victim marker");
      assert.deepEqual(plain(await row.state(victim.org.id)), victimBefore,
        "successful own write must leave the victim's employee-skill rows unchanged");
      ownWrites++;

      if (first) {
        await assert.rejects(async () => row.expect(first.before, first.after, ctx, first.response),
          "attacker B must reject attacker A's genuine saved employee-skill evidence");
      } else {
        first = { before, after, response: ownResponse };
      }

      const foreign = standaloneExpectStatus(await standaloneRequest(endpoint, {
        method: "POST", cookie: own.cookie, body: row.foreignBody(ctx),
      }), 403, "foreign real employer/employee/skill denied");
      assert.ok(!foreign.text.includes(victim.marker), "foreign denial leaked private victim data");
      assert.deepEqual(plain(await row.state(own.org.id)), after,
        "foreign denial must leave attacker's rows and audit unchanged");
      assert.deepEqual(plain(await row.state(victim.org.id)), victimBefore,
        "foreign denial must leave victim skill assignments unchanged");
      foreignDenials++;

      const forged = standaloneExpectStatus(await standaloneRequest(endpoint, {
        method: "POST", cookie: own.cookie, body: row.forged.body(ctx),
      }), 404, "own employer plus real higher-ID victim employee denied");
      assert.ok(!forged.text.includes(victim.marker), "forged denial leaked victim data");
      assert.deepEqual(plain(await row.state(own.org.id)), after,
        "forged denial cannot alter attacker's skill assertions or audit");
      assert.deepEqual(plain(await row.state(victim.org.id)), victimBefore,
        "forged denial cannot alter actual victim evidence");
      forgedDenials++;
    }
    assert.deepEqual(plain(await victimSnapshot(victim.org.id)), victimCoreBefore,
      "victim core organization, employee, payroll and audit rows unchanged");
    assert.equal(ownWrites, 2);
    assert.equal(foreignDenials, 2);
    assert.equal(forgedDenials, 2);
    console.log(JSON.stringify({
      kind: "hcm-employee-skill-action-tenant-http", action: "set_employee_skill",
      methods: [methodKey], exactRouteComplete: false,
      fictionalEmployers: 3, independentOwnerAttackers: 2,
      actualHighIdVictimSkillAndEmployee: true, ownPersistedUnverifiedWrites: ownWrites,
      crossEmployerDenials: foreignDenials, forgedVictimEmployeeDenials: forgedDenials,
      sourceEmployerDiscrimination: true, victimDatabaseUnchanged: true,
      payrollOrProviderWrites: false, productionTested: false, certified: false,
      coverageCreditsAdded: 0,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-hcm-employee-skills-http.mjs")) {
  verifyHcmEmployeeSkillsHttp().then(() => process.exit(0), error => {
    console.error(error);
    process.exit(1);
  });
}
