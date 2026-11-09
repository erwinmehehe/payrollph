/**
 * One current-head PATCH candidate with THREE independent fresh PG16 legs:
 * previously reviewed accepted, previously reviewed rejected, and real
 * authenticated role/MFA denial controls. NEVER promotes the ledger.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  METHOD, ORIGIN, assertMethodMode, requireFilingPatchRecoveryEnv,
  verifyFilingPatchSourcePins, parseLegacyReceipt,
  assertBoundedDenial,
} from "./tenant-filing-patch-method-contract.mjs";

const mode = assertMethodMode(process.argv[2]);
requireFilingPatchRecoveryEnv(); // Safety guard MUST precede any app / DB import.
verifyFilingPatchSourcePins();  // Source must match both existing proven code paths.

function runReviewedMode(which) {
  const script = which === "accepted"
    ? "scripts/qa/tenant-compliance-accepted-http.mjs"
    : "scripts/qa/tenant-filing-outcome-http.mjs";
  const child = spawnSync(process.execPath, ["--import", "tsx", script], {
    cwd: process.cwd(), env: process.env, encoding: "utf8",
    timeout: 12 * 60 * 1000, maxBuffer: 16 * 1024 * 1024,
  });
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  assert.equal(child.error, undefined,
    "FILING_PATCH_REFUSED: failed or timed-out actual real-HTTP runner");
  assert.equal(child.status, 0,
    "FILING_PATCH_REFUSED: " + which + " failed against fresh PG16");
  const receipt = parseLegacyReceipt(which, child.stdout);
  console.log("FILING_PATCH_METHOD_LEG_PASS " + JSON.stringify({
    method: METHOD, leg: which,
    reviewedSourceUnchanged: true, realHttpPostgres16: true,
    actualOwnWrites: which === "accepted" ? receipt.realOwnAccepted200 : receipt.ownPersistedRejections,
    actualVictimDenied: true, auditVetoRollback: true,
    protectedOtherEmployersUnchanged: true,
    credits: 0, independentlyAccepted: false, productionCertified: false,
  }));
}

async function proveRoleMfaDenials() {
  // Do not import app, db, or fixture modules before guard and source check.
  const [{ db, pool }, s, { eq, asc, and }, fixtures] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const clone = x => JSON.parse(JSON.stringify(x));
  const protectedTables = [
    "organizations", "legalEntities", "orgUnits", "employees",
    "employeePayProfiles", "userOrganizations", "payrollRuns",
    "governmentFilingValidations", "auditEvents", "outbox",
  ];
  async function snapshot(orgId) {
    const rows = {};
    for (const name of protectedTables) {
      const table = s[name];
      assert.ok(table?.id, "Protected table is missing an id: " + name);
      const field = name === "organizations" ? table.id : table.organizationId;
      assert.ok(field, "Protected table lacks tenant id: " + name);
      rows[name] = await db.select().from(table)
        .where(eq(field, orgId)).orderBy(asc(table.id));
    }
    return clone(rows);
  }
  async function seedFiling(owner, suffix) {
    const [run] = await db.insert(s.payrollRuns).values({
      organizationId: owner.org.id, legalEntityId: owner.entity.id,
      scopeOrgUnitId: owner.unit.id,
      periodLabel: owner.marker + " fictional guard " + suffix,
      periodStart: "2026-02-01", periodEnd: "2026-02-15",
      payDate: "2026-02-20", status: "Draft",
    }).returning();
    const [filing] = await db.insert(s.governmentFilingValidations).values({
      organizationId: owner.org.id, legalEntityId: owner.entity.id,
      payrollRunId: run.id, agency: "SSS", form: "R-3",
      periodLabel: run.periodLabel, fileName: owner.marker + "-guard.csv",
      fileSha256: createHash("sha256").update(owner.marker + ":" + suffix).digest("hex"),
      generatorVersion: "sss-r3-worksheet-v2", generatedBy: owner.owner.name,
    }).returning();
    return { ...owner, run, filing };
  }
  async function request(actor, {
    cookie = actor.cookie, id = actor.filing.id,
    organizationId = actor.org.id, origin = ORIGIN, fetchSite = "same-origin",
    outcome = "rejected",
  } = {}) {
    const response = await fetch(ORIGIN + "/api/compliance/filing-validations/" + id, {
      method: "PATCH", cache: "no-store", redirect: "manual",
      headers: {
        "content-type": "application/json", origin,
        "sec-fetch-site": fetchSite, ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({
        organizationId, outcome, submissionMethod: "manual_entry",
        note: "Fictional authorization denial - no agency communication.",
        agencyReference: "CI-FICTIONAL-NOT-SUBMITTED",
        submittedAt: "2026-02-28",
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* Denial oracle handles non-JSON. */ }
    return { status: response.status, text, json, headers: response.headers };
  }
  async function account(cookie) {
    const r = await fetch(ORIGIN + "/api/account", {
      method: "GET", cache: "no-store", redirect: "manual",
      headers: { cookie }, signal: AbortSignal.timeout(30_000),
    });
    return { status: r.status, json: await r.json() };
  }
  async function subordinate(actor, role) {
    const [user] = await db.insert(s.users).values({
      email: actor.marker.toLowerCase() + "-recovery-" + role + "@example.invalid",
      name: actor.marker + " " + role, passwordHash: "fictional-test-only",
      role: role === "employee" ? "employee" : "owner",
      ...(role === "employee" ? { employeeId: actor.worker.id } : {}),
      totpEnabled: true,
    }).returning();
    await db.insert(s.userOrganizations).values({
      organizationId: actor.org.id, userId: user.id,
      role, orgUnitId: actor.unit.id, active: true,
      ...(role === "employee" ? { workerEmployeeId: actor.worker.id } : {}),
    });
    const session = await fixtures.standaloneMakeSession(user.id);
    await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(s.sessions.id, session.id));
    return { ...session, user };
  }
  let deniedCount = 0;
  try {
    const version = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(version >= 160000 && version < 170000,
      "FILING_PATCH_REFUSED: only disposable PostgreSQL 16 accepted");
    assert.equal((await db.select().from(s.users).limit(1)).length, 0);
    assert.equal((await db.select().from(s.organizations).limit(1)).length, 0);
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = await seedFiling(await fixtures.seedEmployer("ATTA", nonce,
      fixtures.standaloneMakeSession), "one");
    const b = await seedFiling(await fixtures.seedEmployer("ATTB", nonce,
      fixtures.standaloneMakeSession), "two");
    for (let i = 0; i < 7; i++) {
      await seedFiling(await fixtures.seedEmployer("PAD" + i, nonce,
        fixtures.standaloneMakeSession), "padding-" + i);
    }
    const victim = await seedFiling(await fixtures.seedEmployer("VICTIM", nonce,
      fixtures.standaloneMakeSession), "victim");
    for (const field of ["org", "entity", "run", "filing", "worker"]) {
      assert.ok(victim[field].id > Math.max(a[field].id, b[field].id, 6),
        "Actual SQL victim must have higher " + field + " id > 6");
    }
    const actors = [a, b, victim];
    const personas = new Map();
    for (const actor of [a, b]) {
      personas.set(actor.org.id, {
        employee: await subordinate(actor, "employee"),
        manager: await subordinate(actor, "manager"),
        staleMfa: await fixtures.standaloneMakeSession(actor.owner.id),
      });
    }
    const baseline = new Map(await Promise.all(actors.map(async x =>
      [x.org.id, await snapshot(x.org.id)])));
    const allUnchanged = async label => {
      for (const actor of actors) {
        assert.deepEqual(await snapshot(actor.org.id), baseline.get(actor.org.id),
          label + ": denied PATCH modified " + actor.marker);
      }
    };
    const denied = async (response, status, label) => {
      assertBoundedDenial(response, status,
        [victim.marker, victim.filing.fileName, victim.run.periodLabel], label);
      await allUnchanged(label);
      deniedCount++;
      return response;
    };

    for (const actor of [a, b]) {
      const persona = personas.get(actor.org.id);
      assert.equal((await account(persona.employee.cookie)).json?.profile?.id,
        persona.employee.user.id, "Must be genuine employee session");
      assert.equal((await account(persona.manager.cookie)).json?.profile?.id,
        persona.manager.user.id, "Must be genuine manager session");
      assert.equal((await account(persona.staleMfa.cookie)).status, 200,
        "Missing MFA must not merely mean an expired or anonymous session");

      await denied(await request(actor, { cookie: persona.employee.cookie }),
        403, actor.label + " employee cannot record filing evidence");
      await denied(await request(actor, { cookie: persona.manager.cookie }),
        403, actor.label + " manager cannot record filing evidence");
      const mfa = await denied(await request(actor, { cookie: persona.staleMfa.cookie }),
        403, actor.label + " authenticated owner without recent MFA denied");
      assert.equal(mfa.json?.code, "MFA_REQUIRED", "Denial must be actual MFA protection");

      await denied(await request(actor, { id: victim.filing.id,
        organizationId: victim.org.id }), 403, actor.label + " forged victim employer");
      const foreign = await denied(await request(actor, {
        id: victim.filing.id }), 404, actor.label + " foreign record within own tenant");
      const nonexistent = await denied(await request(actor, {
        id: victim.filing.id + 1000000 }), 404, actor.label + " nonexistent record");
      assert.deepEqual(foreign.json, nonexistent.json,
        "Foreign and absent records must be indistinguishable");

      await denied(await request(actor, { cookie: null }),
        401, actor.label + " anonymous caller");
      await denied(await request(actor, {
        origin: "https://attacker.example.invalid", fetchSite: "cross-site",
      }), 403, actor.label + " cross-site caller");
      await denied(await request(actor, { id: "not-an-id" }),
        400, actor.label + " malformed filing id");

      // Real membership revocation must block an owner who remains signed in.
      const revoke = await db.update(s.userOrganizations).set({ active: false })
        .where(and(eq(s.userOrganizations.userId, actor.owner.id),
          eq(s.userOrganizations.organizationId, actor.org.id),
          eq(s.userOrganizations.active, true))).returning();
      assert.equal(revoke.length, 1, "Must revoke exactly one persisted owner grant");
      baseline.set(actor.org.id, await snapshot(actor.org.id));
      assert.equal((await account(actor.cookie)).status, 200,
        "Membership revocation must not be a logout side-effect");
      await denied(await request(actor), 403,
        actor.label + " revoked while authenticated");

      // No actor's denial may change any other org, including victim payroll.
      await allUnchanged(actor.label + " final negative controls");
    }
    assert.equal(deniedCount, 20, "Two owner-and-role groups each prove 10 denials");
    assert.equal((await snapshot(victim.org.id)).governmentFilingValidations[0].status,
      "generated");
    console.log("FILING_PATCH_METHOD_GUARD_PASS " + JSON.stringify({
      method: METHOD, independentEmployers: 2, realHigherIdVictim: true,
      boundedDenials: deniedCount, realEmployeeDenied: true,
      realManagerDenied: true, authenticatedMissingMfaDenied: true,
      revokedOwnerSessionStillAuthenticated: true,
      foreignAndAbsentIndistinguishable: true,
      noDeniedSqlOrAuditMutations: true, paymentProvidersCalled: false,
      governmentAgencyContacted: false,
      credits: 0, independentlyAccepted: false, productionCertified: false,
    }));
  } finally {
    await pool.end();
  }
}

if (mode === "guards") {
  await proveRoleMfaDenials();
} else {
  runReviewedMode(mode);
}
