/**
 * Proposed, zero-credit tenant isolation acceptance for PUT /api/benefits.
 * Real localhost HTTP + fresh disposable PostgreSQL 16, no provider calls.
 * The protection gate MUST run before dynamic DB/application imports.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  requireDisposableBenefitCatalog, assertCatalogResponse,
  assertOwnedDefaultPlans, assertCatalogUnchanged, assertNoForeignMarker,
} from "./tenant-benefit-catalog-put-contract.mjs";

async function waitForServer(server, logs) {
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw Error("Local Next stopped: " + logs());
    try {
      const response = await fetch("http://127.0.0.1:3000/login", {
        redirect: "manual", cache: "no-store",
      });
      if (response.status === 200) return;
    } catch { /* local server startup */ }
    await delay(1000);
  }
  throw Error("Local Next did not start: " + logs());
}
async function stopServer(server) {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([new Promise(resolve => server.once("exit", resolve)), delay(3500)]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

export async function proveTenantBenefitCatalogPut() {
  // Before any code importing database, schema or Next runtime.
  requireDisposableBenefitCatalog();
  const [{ db, pool }, s, orm, http] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("drizzle-orm"), import("./tenant-table-http.mjs"),
  ]);
  const { eq, asc, and, isNull } = orm;
  const { seedEmployer, standaloneMakeSession, standaloneRequest } = http;
  for (const table of [s.organizations, s.benefitPlans, s.benefitEnrollments,
    s.userOrganizations, s.auditEvents, s.outbox, s.payrollRuns]) {
    assert.equal((await db.select().from(table).limit(1)).length, 0,
      "BENEFIT_CATALOG_PROOF_REFUSED: disposable database must be empty");
  }

  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const a = await seedEmployer("ATTA", nonce, standaloneMakeSession);
  const b = await seedEmployer("ATTB", nonce, standaloneMakeSession);
  const v = await seedEmployer("VICTIM", nonce, standaloneMakeSession);
  const employers = [a, b, v];
  for (const lower of [a, b]) {
    assert.ok(v.org.id > lower.org.id && v.worker.id > lower.worker.id,
      "victim must be an actual populated higher-SQL-ID employer");
  }
  const snapshot = async orgId => {
    const own = async table => db.select().from(table)
      .where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
    const [plans, enrolments, members, workers, payroll, audits, outbox] = await Promise.all([
      own(s.benefitPlans), own(s.benefitEnrollments),
      own(s.userOrganizations), own(s.employees),
      own(s.payrollRuns), own(s.auditEvents), own(s.outbox),
    ]);
    return { plans, enrolments, members, workers, payroll, audits, outbox };
  };
  const globalPlans = () => db.select().from(s.benefitPlans)
    .where(isNull(s.benefitPlans.organizationId)).orderBy(asc(s.benefitPlans.id));
  const snapshotAll = async () => Promise.all(employers.map(e => snapshot(e.org.id)));
  const checkAllUnchanged = async (before, label) => {
    const after = await snapshotAll();
    for (let i = 0; i < employers.length; i++) {
      assertCatalogUnchanged(before[i], after[i], label + " " + employers[i].label);
    }
  };

  let server, logs = "";
  try {
    server = spawn(process.execPath, [
      "node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3000",
    ], { stdio: ["ignore", "pipe", "pipe"] });
    const capture = data => { logs = (logs + String(data)).slice(-1600); };
    server.stdout.on("data", capture);
    server.stderr.on("data", capture);
    await waitForServer(server, () => logs);

    const put = (actor, organizationId) => standaloneRequest("/api/benefits", {
      method: "PUT", cookie: actor?.cookie,
      body: { organizationId },
    });
    const get = (actor, organizationId) => standaloneRequest(
      "/api/benefits?organizationId=" + organizationId, { cookie: actor.cookie },
    );
    const originalGlobal = await globalPlans();
    assert.equal(originalGlobal.length, 0);

    async function checkPositive(actor, label) {
      const before = await snapshotAll();
      const response = await put(actor, actor.org.id);
      assertCatalogResponse(response, true, label + " first own PUT");
      const after = await snapshotAll();
      const i = employers.indexOf(actor);
      assertOwnedDefaultPlans(after[i].plans, actor.org.id);
      assert.equal(after[i].audits.length, before[i].audits.length + 1,
        label + ": one actor-bound catalogue audit must commit with five plans");
      const event = after[i].audits.at(-1);
      assert.equal(event.action, "Employer benefit catalogue seeded");
      assert.equal(event.organizationId, actor.org.id);
      assert.equal(event.actor, actor.owner.name);
      assert.equal(event.metadata.actorUserId, actor.owner.id);
      assert.equal(event.metadata.seedCount, 5);
      for (const key of ["enrolments", "members", "workers", "payroll", "outbox"]) {
        assertCatalogUnchanged(before[i][key], after[i][key], label + ": " + key);
      }
      for (let j = 0; j < employers.length; j++) if (i !== j) {
        assertCatalogUnchanged(before[j], after[j], label + " vs " + employers[j].label);
      }
      assertCatalogUnchanged(originalGlobal, await globalPlans(), label + ": global plan table");
      return after[i];
    }

    const aSeed = await checkPositive(a, "ATTA");
    assertCatalogResponse(await put(a, a.org.id), false, "ATTA replay");
    assertCatalogUnchanged(aSeed, await snapshot(a.org.id), "ATTA replay state");

    // Independently prove the new SQL advisory lock serializes first-ever
    // same-employer concurrent requests, not merely replay of existing plans.
    const beforeConcurrent = await snapshotAll();
    const [bFirst, bSecond] = await Promise.all([put(b, b.org.id), put(b, b.org.id)]);
    assert.deepEqual([bFirst.status, bSecond.status], [200, 200]);
    assert.deepEqual([bFirst.json?.seeded, bSecond.json?.seeded].sort(), [false, true],
      "only one concurrent first seed may create the five defaults");
    assertCatalogResponse(bFirst, bFirst.json.seeded, "ATTB concurrent first");
    assertCatalogResponse(bSecond, bSecond.json.seeded, "ATTB concurrent second");
    const bAfter = await snapshotAll();
    assertOwnedDefaultPlans(bAfter[1].plans, b.org.id);
    assert.equal(bAfter[1].audits.length, beforeConcurrent[1].audits.length + 1,
      "concurrent first PUT creates exactly one audit");
    for (const i of [0, 2]) assertCatalogUnchanged(beforeConcurrent[i], bAfter[i],
      "concurrent B PUT must not change " + employers[i].label);
    assertCatalogUnchanged(originalGlobal, await globalPlans(),
      "concurrent B PUT may not mutate global benefit templates");

    const vAfter = await checkPositive(v, "VICTIM");
    assert.ok(vAfter.plans.every(row => row.id > Math.max(
      ...bAfter[0].plans.map(p => p.id), ...bAfter[1].plans.map(p => p.id))),
      "victim owns actual populated higher-SQL-ID plans");

    for (const owner of employers) {
      const ownGet = await get(owner, owner.org.id);
      assert.equal(ownGet.status, 200, "own GET must remain available");
      const ownPlans = ownGet.json?.plans ?? [];
      const persisted = (await snapshot(owner.org.id)).plans;
      assert.equal(ownPlans.length, persisted.length, "GET returns populated exact employer plans");
      assert.ok(ownPlans.every(plan => plan.organizationId === owner.org.id));
      for (const other of employers.filter(x => x !== owner)) {
        assertNoForeignMarker(ownGet, other.marker);
        const foreignPlanIds = new Set((await snapshot(other.org.id)).plans.map(row => row.id));
        assert.ok(!ownPlans.some(plan => foreignPlanIds.has(plan.id)),
          "GET must never expose another employer's persisted private plan");
      }
    }

    // Neither independent attacker may seed the populated higher-ID employer.
    for (const attacker of [a, b]) {
      const before = await snapshotAll();
      const deny = await put(attacker, v.org.id);
      assert.equal(deny.status, 403, attacker.label + ": real victim employer PUT denied");
      assertNoForeignMarker(deny, v.marker);
      await checkAllUnchanged(before, attacker.label + " forged victim selector");
    }

    // Noncanonical selectors, untrusted types, and anonymous requests have no
    // organization-altering effect even when they would coerce to a valid ID.
    for (const invalid of [null, true, [a.org.id], {}, -1, 0,
      String(a.org.id).padStart(2, "0"), "1e2", " 1"]) {
      const before = await snapshotAll();
      const response = await put(a, invalid);
      assert.equal(response.status, 400, "reject noncanonical organizationId " + JSON.stringify(invalid));
      await checkAllUnchanged(before, "malformed employer selector");
    }
    const beforeAnonymous = await snapshotAll();
    assert.equal((await put(null, v.org.id)).status, 401, "anonymous PUT denied");
    await checkAllUnchanged(beforeAnonymous, "anonymous mutation denied");

    const [limitedUser] = await db.insert(s.users).values({
      email: "catalog-unit-" + nonce + "@example.invalid",
      name: "Fictional unit-scoped admin", passwordHash: "unused-synthetic",
      role: "admin", totpEnabled: true,
    }).returning();
    await db.insert(s.userOrganizations).values({
      userId: limitedUser.id, organizationId: a.org.id, role: "admin",
      orgUnitId: a.unit.id, active: true,
    });
    const limitedSession = await standaloneMakeSession(limitedUser.id);
    await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(s.sessions.id, limitedSession.id));
    const limited = { cookie: limitedSession.cookie };
    const beforeUnit = await snapshotAll();
    const unitDenied = await put(limited, a.org.id);
    assert.equal(unitDenied.status, 403, "unit-scoped admin cannot seed company-wide catalogue");
    await checkAllUnchanged(beforeUnit, "unit-scoped admin denial");

    // Revoking an active grant must deny the SAME still-authenticated session,
    // even if another employer membership remains active on the same user.
    await db.insert(s.userOrganizations).values({
      userId: a.owner.id, organizationId: b.org.id,
      role: "owner", active: true,
    });
    await db.update(s.userOrganizations).set({ active: false }).where(and(
      eq(s.userOrganizations.userId, a.owner.id),
      eq(s.userOrganizations.organizationId, a.org.id),
    ));
    assert.equal((await standaloneRequest("/api/account", { cookie: a.cookie })).status, 200,
      "revoked member's session is still authenticated");
    const beforeRevoked = await snapshotAll();
    assert.equal((await put(a, a.org.id)).status, 403, "revoked A membership denies same-session PUT");
    await checkAllUnchanged(beforeRevoked, "revoked same-session denied");

    // Existing system-wide legacy templates remain readable but cannot be
    // inserted or overwritten by tenant-level PUT. Their presence suppresses
    // duplicate defaults only for a tenant seeing them, not other tenant plans.
    const [legacy] = await db.insert(s.benefitPlans).values({
      organizationId: null, name: "Fictional legacy global plan " + nonce,
      category: "insurance", employeeShare: "0.00", employerShare: "0.00",
    }).returning();
    const legacyTenant = await seedEmployer("LEGACY", nonce, standaloneMakeSession);
    const globalBefore = await globalPlans();
    const othersBefore = await snapshotAll();
    const legacyReply = await put(legacyTenant, legacyTenant.org.id);
    assertCatalogResponse(legacyReply, false, "legacy globally visible template preserves old data");
    const legacyState = await snapshot(legacyTenant.org.id);
    assert.equal(legacyState.plans.length, 0,
      "legacy globally configured template remains read-only; no tenant duplicate");
    const legacyGet = await get(legacyTenant, legacyTenant.org.id);
    assert.equal(legacyGet.status, 200);
    assert.ok(legacyGet.json?.plans.some(row => row.id === legacy.id && row.organizationId === null));
    assertCatalogUnchanged(globalBefore, await globalPlans(), "global templates never changed");
    await checkAllUnchanged(othersBefore, "legacy template never changes existing employers");

    console.log(JSON.stringify({
      kind: "benefit-catalog-put-tenant-source-isolation",
      tenantCount: 3, independentLowerIdAttackers: 2,
      victimHasHigherPersistedEmployerAndPlanIds: true,
      ownHttpSuccessAndPersistedSeed: true,
      concurrentFirstSeedExactlyOnce: true,
      foreignEmployerDenied: true,
      forgedTypesDenied: true,
      sameSessionRevocationDenied: true,
      unitScopeDenied: true,
      globalWritesProhibited: true,
      legacyGlobalReadPreserved: true,
      victimAndOtherEmployerDbUnchangedOnDenials: true,
      credits: 0, independentlyAccepted: false,
    }));
  } finally {
    await stopServer(server);
    await pool.end();
  }
}
if (process.argv[1]?.replaceAll("\\", "/")
  .endsWith("/tenant-benefit-catalog-put-http.mjs")) {
  proveTenantBenefitCatalogPut().catch(error => {
    console.error(error instanceof Error ? error.stack : "Benefit catalog tenant proof failed");
    process.exitCode = 1;
  });
}
