/**
 * Read-only, zero-new-credit ESS Explain My Pay proof.
 * Disposable PostgreSQL 16 + Next HTTP only. No production account or money.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, asc, eq, inArray } from "drizzle-orm";
import { requireIsolatedEssExplainProof, ROUTE, ROUTE_BLOB } from "./tenant-ess-explanation-contract.mjs";

export async function verifyEssExplainHttp() {
  // This must run BEFORE importing any application database or fixture.
  requireIsolatedEssExplainProof();
  const [{ db, pool }, s, f] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("./tenant-table-http.mjs"),
  ]);
  const flag = process.env.MULTI_ENTITY_ENABLED === "true";
  try {
    const bytes = readFileSync(ROUTE);
    const blob = createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0"))
      .update(bytes).digest("hex");
    assert.equal(blob, ROUTE_BLOB, "Changed payroll route needs a new exact-source proof");
    for (const table of [s.organizations, s.payrollRuns, s.payrollEntries, s.auditEvents]) {
      assert.equal((await db.select().from(table).limit(1)).length, 0,
        "ESS_EXPLAIN_REFUSED: synthetic database must begin empty");
    }
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = await f.seedEmployer("EA", nonce, f.standaloneMakeSession);
    const b = await f.seedEmployer("EB", nonce, f.standaloneMakeSession);
    const victim = await f.seedEmployer("EV", nonce, f.standaloneMakeSession);
    assert.ok(victim.org.id > b.org.id && victim.worker.id > b.worker.id,
      "Foreign victim IDs must be genuine higher-ID rows");
    const actors = [a, b, victim];

    async function employeeSession(actor, worker, suffix) {
      const [user] = await db.insert(s.users).values({
        email: "fictional-ess-" + actor.marker.toLowerCase() + "-" + suffix + "@example.invalid",
        name: actor.marker + " fictional employee", role: "employee",
        passwordHash: "synthetic-only-no-password-login", employeeId: worker.id,
      }).returning({ id: s.users.id });
      const [membership] = await db.insert(s.userOrganizations).values({
        userId: user.id, organizationId: actor.org.id, role: "employee", active: true,
      }).returning({ id: s.userOrganizations.id });
      const session = await f.standaloneMakeSession(user.id);
      await db.update(s.sessions).set({ mfaVerifiedAt: new Date(), lastSeenAt: new Date() })
        .where(eq(s.sessions.id, session.id));
      return { user, membership, session };
    }

    async function seed(actor) {
      const colleague = await f.addWorker(actor, "COL");
      const [otherEntity] = await db.insert(s.legalEntities).values({
        organizationId: actor.org.id, code: actor.marker + "-OTHER",
        legalName: actor.marker + " second fictional employer",
        displayName: actor.marker + " second entity", primaryEntity: false,
      }).returning({ id: s.legalEntities.id });
      const plans = [
        ["OWN-EARLIER", "2026-07-01", "2026-07-15", "2026-07-16", actor.entity.id],
        ["OTHER-ENTITY", "2026-08-01", "2026-08-15", "2026-08-16", otherEntity.id],
        ["COLLEAGUE-ONLY", "2026-09-01", "2026-09-15", "2026-09-16", actor.entity.id],
        ["OWN-CURRENT", "2026-10-01", "2026-10-15", "2026-10-16", actor.entity.id],
      ];
      const runs = await db.insert(s.payrollRuns).values(plans.map(p => ({
        organizationId: actor.org.id, legalEntityId: p[4],
        periodLabel: actor.marker + "-" + p[0],
        periodStart: p[1], periodEnd: p[2], payDate: p[3], status: "Released",
      }))).returning({ id: s.payrollRuns.id });
      const entries = await db.insert(s.payrollEntries).values([
        { payrollRunId: runs[0].id, employeeId: actor.worker.id,
          grossPay: "1000.00", deductions: "100.00", netPay: "900.00" },
        { payrollRunId: runs[1].id, employeeId: actor.worker.id,
          grossPay: "2000.00", deductions: "200.00", netPay: "1800.00" },
        { payrollRunId: runs[2].id, employeeId: colleague.id,
          grossPay: "3000.00", deductions: "300.00", netPay: "2700.00" },
        { payrollRunId: runs[3].id, employeeId: actor.worker.id,
          grossPay: "4000.00", deductions: "400.00", netPay: "3600.00" },
      ]).returning({ id: s.payrollEntries.id });
      const account = await employeeSession(actor, actor.worker, "primary");
      return { ...actor, colleague, otherEntity, runs, entries, account };
    }
    const seeded = [];
    for (const employer of actors) seeded.push(await seed(employer));
    const [ownA, ownB, foreign] = seeded;
    assert.ok(foreign.entries[3].id > ownA.entries[3].id &&
      foreign.entries[3].id > ownB.entries[3].id,
      "High-ID victim must have a real stored released payroll entry");

    // Missing legal-employer attribution must be fail-closed with multi-entity ON,
    // while historical flag-OFF behavior remains supported.
    const [unattributed] = await db.insert(s.employees).values({
      organizationId: ownA.org.id, orgUnitId: ownA.unit.id,
      legalEntityId: null, employeeNo: ownA.marker + "-NULL",
      firstName: "Fictional", lastName: "No Entity", title: "Employee",
      avatarInitials: "NE", basicRate: "20000.00", startDate: "2026-01-05",
    }).returning({ id: s.employees.id });
    const [legacyRun] = await db.insert(s.payrollRuns).values({
      organizationId: ownA.org.id, legalEntityId: null,
      periodLabel: ownA.marker + "-NULL-ENTITY",
      periodStart: "2026-05-01", periodEnd: "2026-05-15",
      payDate: "2026-05-16", status: "Released",
    }).returning({ id: s.payrollRuns.id });
    const [legacyEntry] = await db.insert(s.payrollEntries).values({
      payrollRunId: legacyRun.id, employeeId: unattributed.id,
      grossPay: "1100.00", deductions: "100.00", netPay: "1000.00",
    }).returning({ id: s.payrollEntries.id });
    const legacyAccount = await employeeSession(ownA, unattributed, "no-entity");

    async function snapshot() {
      const result = {};
      for (const [name, table] of [
        ["organizations", s.organizations], ["employees", s.employees],
        ["payrollRuns", s.payrollRuns], ["payrollEntries", s.payrollEntries],
        ["audits", s.auditEvents],
      ]) result[name] = await db.select().from(table).orderBy(asc(table.id));
      return result;
    }
    const before = await snapshot();
    const endpoint = id => "/api/self/payslips/" + id + "/explain";
    const request = (id, cookie) => f.standaloneRequest(endpoint(id), { cookie });
    const noStore = result => {
      const cache = result.headers.get("cache-control") || "";
      assert.match(cache, /private/i, "Pay explanation must remain private");
      assert.match(cache, /no-store/i, "Pay explanation must not be cached");
    };
    for (const actor of [ownA, ownB]) {
      const cookie = actor.account.session.cookie;
      const own = f.standaloneExpectStatus(await request(actor.entries[3].id, cookie), 200,
        "Own signed-in employee current released payslip must exist");
      noStore(own);
      assert.equal(own.json?.organizationId, actor.org.id);
      assert.equal(own.json?.employeeId, actor.worker.id);
      assert.equal(own.json?.entryId, actor.entries[3].id);
      assert.equal(own.json?.run?.id, actor.runs[3].id);
      const expectedPrior = flag ? actor.runs[0].id : actor.runs[1].id;
      const expectedPriorNet = flag ? 900 : 1800;
      assert.equal(own.json?.previousRun?.id, expectedPrior,
        "Previous metadata must follow this employee's entry, not a colleague's latest run");
      assert.equal(own.json?.explanation?.previousNet, expectedPriorNet);
      assert.notEqual(own.json?.previousRun?.id, actor.runs[2].id,
        "Colleague-only September run must never appear as previousRun");
      assert.ok(!own.text.includes(foreign.marker), "Foreign employer marker leaked");

      const victimReply = f.standaloneExpectStatus(
        await request(foreign.entries[3].id, cookie), 404, "Real higher-ID foreign payslip denied");
      const missingReply = f.standaloneExpectStatus(
        await request(foreign.entries[3].id + 100000, cookie), 404, "Missing payslip denied");
      const colleagueReply = f.standaloneExpectStatus(
        await request(actor.entries[2].id, cookie), 404, "Colleague-only entry denied");
      const aliasReply = f.standaloneExpectStatus(
        await request("00" + actor.entries[3].id, cookie), 404, "Non-canonical entry ID denied");
      for (const reply of [victimReply, missingReply, colleagueReply, aliasReply]) noStore(reply);
      assert.equal(victimReply.text, missingReply.text,
        "Existing foreign ID and missing ID must be indistinguishable");
      assert.ok(!victimReply.text.includes(foreign.marker));
      assert.ok(!missingReply.text.includes(foreign.marker));
      f.standaloneExpectStatus(await request(actor.entries[3].id), 401,
        "Anonymous employee pay explanation denied");
    }
    const legacy = await request(legacyEntry.id, legacyAccount.session.cookie);
    assert.equal(legacy.status, flag ? 409 : 200,
      "Missing employee legal employer must be blocked only with multi-entity enabled");
    if (legacy.status === 200) noStore(legacy);
    assert.deepEqual(await snapshot(), before,
      "Read-only explained pay must not mutate fictional payroll or audit data");

    // Revoking active membership must deny the same previously valid cookie.
    for (const actor of [ownA, ownB]) {
      await db.update(s.userOrganizations).set({ active: false })
        .where(eq(s.userOrganizations.id, actor.account.membership.id));
      const revoked = await request(actor.entries[3].id, actor.account.session.cookie);
      assert.ok([401, 403].includes(revoked.status),
        "Revoked member must not read the previously owned released payslip");
      assert.ok(!revoked.text.includes(actor.marker) && !revoked.text.includes(foreign.marker));
    }
    const after = await snapshot();
    assert.deepEqual(after, before, "Revocation may not modify payroll rows or audits");
    console.log("ESS_PAY_EXPLANATION_FICTIONAL_PG16_PASS " + JSON.stringify({
      independentEmployeeSessions: 2, higherIdRealVictim: true,
      ownCurrent200: 2, colleagueRunExcluded: true,
      crossEntityFlag: process.env.MULTI_ENTITY_ENABLED,
      foreignMissingEquivalent404: true, revokedMembershipDenied: true,
      victimPayrollAuditUnchanged: true, actualPayrollWrites: 0,
      externalProviders: 0, newMethodCredits: 0, productionCertified: false,
      independentSecurityAcceptance: false,
    }));
  } finally {
    await pool.end();
  }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-ess-explanation-http.mjs")) {
  verifyEssExplainHttp().catch(err => { console.error(err); process.exitCode = 1; });
}
