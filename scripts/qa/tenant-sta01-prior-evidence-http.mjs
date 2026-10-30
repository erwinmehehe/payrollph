/**
 * STA-01: real HTTP GET plus POST save/approve, three fictional employers,
 * two independently signed-in attacker owners, and a higher-ID victim.
 * Source-only proof on disposable PG16/localhost Next. No production, payouts,
 * external identity providers, statutory filing or coverage credit.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  PRIOR_PATH, PRIOR_YEAR, requireDisposablePriorEvidenceEnv,
  assertOwnPriorSave, assertOwnPriorRead, assertPriorDenied, assertUnchanged,
} from "./tenant-sta01-prior-evidence-contract.mjs";

export async function provePriorEvidenceFamily() {
  // Refuse unsafe inputs BEFORE importing any DB or application module.
  requireDisposablePriorEvidenceEnv();

  const [{ db, pool }, s, { asc, eq }, fixtures, { auditBusinessSnapshot },
    { isEncryptedGovernmentId }] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
    import("./tenant-table-invariants.mjs"),
    import("../../src/lib/government-id-crypto.ts"),
  ]);

  try {
    const v = await pool.query("SHOW server_version_num");
    assert.equal(Math.floor(Number(v.rows[0].server_version_num) / 10000), 16,
      "STA01_PRIOR_REFUSED: only disposable PostgreSQL 16");
    assert.equal((await db.select({ id: s.organizations.id })
      .from(s.organizations).limit(1)).length, 0,
    "STA01_PRIOR_REFUSED: require fresh empty fictional employer database");
    assert.equal((await db.select({ id: s.yearEndPriorEvidence.id })
      .from(s.yearEndPriorEvidence).limit(1)).length, 0,
    "STA01_PRIOR_REFUSED: require empty prior evidence database");
    assert.equal((await db.select({ id: s.auditEvents.id })
      .from(s.auditEvents).limit(1)).length, 0,
    "STA01_PRIOR_REFUSED: require empty business audit database");

    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const employers = [];
    for (const label of ["ATTA", "ATTB", "VICTIM"]) {
      const e = await fixtures.seedEmployer(label, nonce, fixtures.standaloneMakeSession);
      // The fictional employee switched from a prior employer in the same
      // tax year, so the verified pre-hire interval is valid.
      await db.update(s.employees).set({ startDate: "2026-07-01" })
        .where(eq(s.employees.id, e.worker.id));
      const [checker] = await db.insert(s.users).values({
        email: e.marker.toLowerCase() + "-checker@example.invalid",
        name: e.marker + " independent checker", role: "owner",
        passwordHash: "fictional-no-login", totpEnabled: true,
      }).returning();
      await db.insert(s.userOrganizations).values({
        userId: checker.id, organizationId: e.org.id, role: "owner", active: true,
      });
      const checkerSession = await fixtures.standaloneMakeSession(checker.id);
      await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
        .where(eq(s.sessions.id, checkerSession.id));
      const [adjustment] = await db.insert(s.yearEndAdjustments).values({
        organizationId: e.org.id, employeeId: e.worker.id, taxYear: PRIOR_YEAR,
        grossCompensation: "100000.00", taxableIncome: "90000.00",
        taxDue: "1000.00", taxWithheld: "1000.00",
        adjustment: "0.00", outcome: "balanced", status: "computed",
      }).returning();
      e.checker = checker;
      e.checkerCookie = checkerSession.cookie;
      e.adjustmentId = adjustment.id;
      e.reference = e.marker + " fictional prior tax statement";
      e.priorEmployerName = e.marker + " former employer";
      e.sha = createHash("sha256").update(e.reference).digest("hex");
      e.income = (10000 + e.rank * 100).toFixed(2);
      e.withheld = (100 + e.rank).toFixed(2);
      e.evidence = {
        status: "verified",
        employerName: e.priorEmployerName,
        employerTin: "123456789-0000",
        periodFrom: "2026-01-01", periodTo: "2026-06-30",
        taxableIncome: e.income, taxWithheld: e.withheld,
        exemptBenefits: "0.00",
        sourceReference: e.reference, sourceSha256: e.sha,
        peraCredit: "0.00", peraReference: "", peraSha256: "",
      };
      employers.push(e);
    }
    const [a, b, victim] = employers;
    for (const attacker of [a, b]) {
      for (const key of ["org", "worker", "adjustmentId"]) {
        const own = key === "org" ? attacker.org.id :
          key === "worker" ? attacker.worker.id : attacker.adjustmentId;
        const target = key === "org" ? victim.org.id :
          key === "worker" ? victim.worker.id : victim.adjustmentId;
        assert.ok(target > own, "STA01: persisted victim " + key + " must have higher ID");
      }
    }

    const snapshot = async organizationId => {
      const byOrg = table => db.select().from(table)
        .where(eq(table.organizationId, organizationId)).orderBy(asc(table.id));
      const [organization, entities, units, workers, evidence, adjustments, payroll, audits] =
        await Promise.all([
          db.select().from(s.organizations).where(eq(s.organizations.id, organizationId)),
          byOrg(s.legalEntities), byOrg(s.orgUnits), byOrg(s.employees),
          byOrg(s.yearEndPriorEvidence), byOrg(s.yearEndAdjustments),
          byOrg(s.payrollRuns), byOrg(s.auditEvents),
        ]);
      return {
        organization, entities, units, workers, evidence, adjustments, payroll,
        audits: auditBusinessSnapshot(audits),
      };
    };
    const snapshotAll = async () => Promise.all(employers.map(e => snapshot(e.org.id)));
    const pathFor = (orgId, employeeId) =>
      PRIOR_PATH + "?organizationId=" + orgId +
      "&employeeId=" + employeeId + "&taxYear=" + PRIOR_YEAR;
    const get = (actor, orgId = actor.org.id, workerId = actor.worker.id) =>
      fixtures.standaloneRequest(pathFor(orgId, workerId), { cookie: actor.cookie });
    const post = (actor, orgId, workerId, data, checker = false) =>
      fixtures.standaloneRequest(pathFor(orgId, workerId), {
        method: "POST", cookie: checker ? actor.checkerCookie : actor.cookie,
        body: data,
      });
    const save = (actor, orgId = actor.org.id, workerId = actor.worker.id) =>
      post(actor, orgId, workerId, {
        action: "save", evidence: actor.evidence, expectedDigest: "",
      });
    const approve = (actor, digest, orgId = actor.org.id,
      workerId = actor.worker.id, checker = true) =>
      post(actor, orgId, workerId, {
        action: "approve", expectedDigest: digest,
      }, checker);

    // A real persisted own-positive write for EACH employer (including victim),
    // followed by a decrypted own-positive GET with individual prior tax values.
    for (const e of employers) {
      const noEvidence = await get(e);
      assert.equal(noEvidence.status, 200);
      assert.equal(noEvidence.json?.record, null,
        "An empty read cannot be counted as a positive");
      assertOwnPriorSave(await save(e), e);
      const own = await get(e);
      e.read = assertOwnPriorRead(own, e, 1, false);
      const state = await snapshot(e.org.id);
      assert.equal(state.evidence.length, 1);
      const persisted = state.evidence[0];
      e.priorId = persisted.id;
      assert.equal(persisted.organizationId, e.org.id);
      assert.equal(persisted.employeeId, e.worker.id);
      assert.equal(persisted.makerUserId, e.owner.id);
      assert.equal(persisted.checkerUserId, null);
      assert.equal(persisted.sourceDigest, e.read.digest);
      assert.ok(isEncryptedGovernmentId(persisted.encryptedEvidence),
        "Sensitive prior-employer identity must be stored encrypted");
      assert.ok(!persisted.encryptedEvidence.includes(e.reference),
        "No plaintext source reference may persist in ciphertext");
      assert.equal(state.adjustments.length, 1);
      assert.equal(state.adjustments[0].id, e.adjustmentId);
      assert.equal(state.adjustments[0].status, "computed");
      assert.equal(state.adjustments[0].payrollRunId, null);
      assert.equal(state.payroll.length, 0);
      assert.equal(state.audits.length, 1,
        "Own save emits exactly one audit receipt");
    }
    assert.ok(victim.priorId > a.priorId && victim.priorId > b.priorId,
      "Victim has actual persisted higher-ID encrypted prior evidence");

    const baseline = await snapshotAll();
    for (const attacker of [a, b]) {
      // Both attackers' own genuine GET must fail the OTHER employer's
      // expected-data assertion; boilerplate 200 cannot substitute for proof.
      const own = await get(attacker);
      assertOwnPriorRead(own, attacker, 1, false);
      assert.throws(() => assertOwnPriorRead(own, victim, 1, false),
        "An attacker GET cannot masquerade as victim's populated evidence");
      const foreignRead = await get(attacker, victim.org.id, victim.worker.id);
      assertPriorDenied(foreignRead, 403, victim,
        attacker.label + " foreign organization GET");
      const foreignSave = await save(attacker, victim.org.id, victim.worker.id);
      assertPriorDenied(foreignSave, 403, victim,
        attacker.label + " foreign organization POST save");
      const foreignApprove = await approve(attacker, victim.read.digest,
        victim.org.id, victim.worker.id);
      assertPriorDenied(foreignApprove, 403, victim,
        attacker.label + " foreign organization POST approve");

      // Supplying a real higher-ID victim worker under an owned organization
      // is NOT an owned record, and must never read or write the victim.
      const forgedRead = await get(attacker, attacker.org.id, victim.worker.id);
      assertPriorDenied(forgedRead, 409, victim,
        attacker.label + " forged victim worker GET");
      const forgedSave = await save(attacker, attacker.org.id, victim.worker.id);
      assertPriorDenied(forgedSave, 409, victim,
        attacker.label + " forged victim worker POST");

      // A stale digest, or maker self-approval, must never add an approval.
      assertPriorDenied(await approve(attacker, "0".repeat(64)), 409, victim,
        attacker.label + " stale digest approval");
      assertPriorDenied(await approve(attacker, attacker.read.digest,
        attacker.org.id, attacker.worker.id, false), 409, victim,
        attacker.label + " maker self-approval");

      assertUnchanged(baseline, await snapshotAll(),
        attacker.label + " GET, foreign/forged POST and maker-checker denials");
    }

    // Real independent checker positives for both attackers; other employer
    // rows, audit and source fingerprint must be unchanged by either approval.
    let expected = baseline;
    for (const attacker of [a, b]) {
      assertOwnPriorSave(await approve(attacker, attacker.read.digest), attacker);
      const read = await get(attacker);
      assertOwnPriorRead(read, attacker, 1, true);
      const current = await snapshotAll();
      const i = employers.indexOf(attacker);
      const updated = current[i].evidence[0];
      assert.equal(updated.checkerUserId, attacker.checker.id);
      assert.ok(updated.approvedAt instanceof Date);
      assert.equal(updated.makerUserId, attacker.owner.id);
      assert.notEqual(updated.checkerUserId, updated.makerUserId,
        "Approval must be by a different signed-in account");
      assert.equal(updated.sourceDigest, attacker.read.digest);
      assert.equal(updated.encryptedEvidence, expected[i].evidence[0].encryptedEvidence,
        "Approval must not rewrite sensitive evidence");
      assert.deepEqual(current[i].adjustments, expected[i].adjustments,
        "No tax calculation or settled payroll may change");
      assert.deepEqual(current[i].payroll, expected[i].payroll,
        "Approval is evidence-only, never a payroll release");
      assert.equal(current[i].audits.length, expected[i].audits.length + 1,
        "Real approval emits one new audited business event");
      for (let other = 0; other < employers.length; other++) {
        if (other !== i) assertUnchanged(expected[other], current[other],
          "A checker cannot modify another employer's rows");
      }
      expected = current;
    }
    assertUnchanged(expected[2], await snapshot(victim.org.id),
      "Victim encrypted tax evidence, employee, adjustment, payroll and audit");
    console.log("STA01_PRIOR_EVIDENCE_REAL_HTTP " + JSON.stringify({
      methods: ["GET /api/year-end/prior-evidence",
        "POST /api/year-end/prior-evidence (save and approve)"],
      employers: 3, independentAttackers: 2, victimHigherIds: true,
      genuineOwnedEncryptedRows: 3, ownSaves: 3,
      foreignOrgReadDenied: 2, foreignOrgSaveDenied: 2,
      foreignOrgApproveDenied: 2, forgedVictimEmployeeReadDenied: 2,
      forgedVictimEmployeeWriteDenied: 2, staleOrMakerApprovalsDenied: 4,
      ownIndependentCheckerApprovals: 2, unchangedVictimAndPayroll: true,
      realHttpPg16: true, productionCertified: false,
      globalTenantIsolationAccepted: false, moneyMoved: false,
      coverageCredits: 0, independentReviewerPending: true,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].replaceAll("\\", "/")
  .endsWith("scripts/qa/tenant-sta01-prior-evidence-http.mjs")) {
  provePriorEvidenceFamily().catch(error => {
    console.error("STA01_PRIOR_EVIDENCE_FAILED",
      error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
