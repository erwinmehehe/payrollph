/**
 * Disposable-only PG16 HTTP proof candidate for POST salary-corrections/preview.
 * 2 independent owners, sibling legal employers without grants, real higher-ID
 * victim tenant and immutable SQL. No financial writes, providers or live data.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

export function requireDisposableSalaryPreview(env = process.env) {
  const required = {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    MULTI_ENTITY_ENABLED: "true",
    HCM_SALARY_CORRECTION_PREVIEW_ENABLED: "true",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false", DEMO_MODE: "false",
  };
  for (const [name, value] of Object.entries(required)) {
    assert.equal(env[name], value, "SALARY_PREVIEW_REFUSED: " + name);
  }
  for (const name of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
    "STRIPE_SECRET_KEY", "POSTMARK_SERVER_TOKEN", "RESEND_API_KEY"]) {
    assert.ok(!env[name], "SALARY_PREVIEW_REFUSED: external provider secret " + name);
  }
}

export function proveOwnedSalaryPreview(result, owner) {
  assert.equal(result.status, 200, "authorized own entity must return real 200");
  assert.equal(result.json?.status, "assessment_only");
  assert.equal(result.json?.tenantId, owner.org.id);
  assert.equal(result.json?.subjectEmployeeId, owner.worker.id);
  assert.equal(result.json?.legalEntityId, owner.entity.id);
  assert.equal(result.json?.recentRevisions?.length, 1,
    "nonempty persisted salary revision required for own positive");
  assert.equal(result.json?.recentRevisions?.[0]?.id, owner.revision.id);
  assert.equal(result.json?.assessment?.evidence, "revision_as_of_date");
  assert.equal(result.json?.assessment?.rateDeltaPerBasisUnit, owner.expectedDelta);
  assert.equal(result.json?.assessment?.payrollAmountDelta, null);
  assert.equal(result.json?.preview?.completePayableAmountKnown, false);
  assert.equal(result.json?.notice?.includes("Released payroll remains immutable."), true);
  assert.ok(result.headers.get("cache-control")?.includes("no-store"));
  assert.doesNotMatch(result.text, /previousRateAmount|newRateAmount|bankAccount/);
}

export function sameEmployerSnapshotUnchanged(before, after, message) {
  assert.deepEqual(after, before, message + " must not alter any salary, people, grant, payroll or audit row");
}

async function main() {
  requireDisposableSalaryPreview(); // MUST run before importing DB or runtime modules
  const [{ db, pool }, s, { eq, asc, and }, http] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const base = "http://127.0.0.1:3000";
  let nextServer = null;
  try {
    for (const [name, table] of [
      ["employers", s.organizations], ["workers", s.employees],
      ["pay revisions", s.employeePayRevisions], ["audits", s.auditEvents],
    ]) assert.equal((await db.select().from(table).limit(1)).length, 0,
      "SALARY_PREVIEW_REFUSED: fresh isolated " + name + " table required");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const actors = [];
    for (const label of ["ATTA", "ATTB", "VICTIM"]) {
      const e = await http.seedEmployer(label, nonce, http.standaloneMakeSession);
      await db.insert(s.userLegalEntityGrants).values({
        organizationId: e.org.id, userId: e.owner.id, legalEntityId: e.entity.id,
      });
      const [siblingEntity] = await db.insert(s.legalEntities).values({
        organizationId: e.org.id, code: e.marker.slice(0, 26) + "-S",
        legalName: e.marker + " ungranted legal employer",
        displayName: e.marker + " ungranted",
      }).returning();
      const [siblingUnit] = await db.insert(s.orgUnits).values({
        organizationId: e.org.id, legalEntityId: siblingEntity.id,
        code: e.marker.slice(0, 26) + "-S", name: e.marker + " ungranted department",
        type: "department",
      }).returning();
      const [siblingWorker] = await db.insert(s.employees).values({
        organizationId: e.org.id, legalEntityId: siblingEntity.id, orgUnitId: siblingUnit.id,
        employeeNo: e.marker + "-SIB", firstName: "Fictional",
        lastName: e.marker + " ungranted worker",
        title: "Fictional", avatarInitials: "TT",
        basicRate: "41000.00", startDate: "2026-01-05",
      }).returning();
      await db.insert(s.employeePayProfiles).values({
        organizationId: e.org.id, employeeId: siblingWorker.id, payBasis: "monthly",
        rateAmount: "41000.00", standardWorkDaysPerMonth: "22",
        standardHoursPerDay: "8",
      });
      const [revision] = await db.insert(s.employeePayRevisions).values({
        organizationId: e.org.id, employeeId: e.worker.id,
        effectiveDate: "2026-07-01", previousPayBasis: "monthly",
        previousRateAmount: "18000.00", previousStandardWorkDaysPerMonth: "22",
        previousStandardHoursPerDay: "8", newPayBasis: "monthly",
        newRateAmount: "20000.00", newStandardWorkDaysPerMonth: "22",
        newStandardHoursPerDay: "8", reason: "Disposable salary source fixture",
        createdBy: e.owner.name,
      }).returning();
      await db.insert(s.employeePayRevisions).values({
        organizationId: e.org.id, employeeId: siblingWorker.id,
        effectiveDate: "2026-07-01", previousPayBasis: "monthly",
        previousRateAmount: "39000.00", previousStandardWorkDaysPerMonth: "22",
        previousStandardHoursPerDay: "8", newPayBasis: "monthly",
        newRateAmount: "41000.00", newStandardWorkDaysPerMonth: "22",
        newStandardHoursPerDay: "8", reason: "Real ungranted sibling fixture",
        createdBy: e.owner.name,
      });
      Object.assign(e, {
        siblingEntity, siblingWorker, revision,
        expectedDelta: (e.rank * 2000).toFixed(2),
        proposedRateAmount: (20000 + e.rank * 2000).toFixed(2),
      });
      actors.push(e);
    }
    const [a, b, victim] = actors;
    for (const attacker of [a, b]) {
      assert.ok(victim.org.id > attacker.org.id &&
        victim.worker.id > attacker.siblingWorker.id &&
        victim.entity.id > attacker.siblingEntity.id,
        "victim is a real higher-ID persisted employer and worker");
    }
    const snapshot = async (orgId) => {
      const own = table => db.select().from(table)
        .where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
      const [workers, profiles, revisions, payroll, grants, audits] = await Promise.all([
        own(s.employees), own(s.employeePayProfiles),
        own(s.employeePayRevisions), own(s.payrollRuns),
        own(s.userLegalEntityGrants), own(s.auditEvents),
      ]);
      return { workers, profiles, revisions, payroll, grants, audits };
    };
    const snapshots = async () => Promise.all(actors.map(x => snapshot(x.org.id)));

    let log = "";
    nextServer = spawn(process.execPath,
      ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3000"],
      { stdio: ["ignore", "pipe", "pipe"] });
    const collect = chunk => { log = (log + String(chunk)).slice(-1800); };
    nextServer.stdout.on("data", collect);
    nextServer.stderr.on("data", collect);
    let started = false;
    for (let attempt = 0; attempt < 65; attempt++) {
      if (nextServer.exitCode !== null) throw new Error("Next failed: " + log);
      try {
        const result = await fetch(base + "/login");
        if (result.ok) { started = true; break; }
      } catch {}
      await sleep(1000);
    }
    assert.ok(started, "Next localhost server unavailable: " + log);

    const path = "/api/hcm/salary-corrections/preview";
    const bodyFor = (source, employeeId = source.worker.id,
      legalEntityId = source.entity.id) => ({
      organizationId: source.org.id, employeeId, legalEntityId,
      effectiveDate: "2026-09-15", proposedPayBasis: "monthly",
      proposedRateAmount: source.proposedRateAmount,
    });
    const call = async (actor, body, { query = "", extraHeaders = {} } = {}) => {
      const result = await fetch(base + path + query, {
        method: "POST", redirect: "manual", cache: "no-store",
        headers: {
          cookie: actor.cookie, origin: base, "sec-fetch-site": "same-origin",
          "content-type": "application/json", ...extraHeaders,
        }, body: JSON.stringify(body),
      });
      const text = await result.text();
      let json;
      try { json = JSON.parse(text); } catch { json = null; }
      return { status: result.status, text, json, headers: result.headers };
    };
    const before = await snapshots();
    const ownA = await call(a, bodyFor(a));
    proveOwnedSalaryPreview(ownA, a);
    const ownB = await call(b, bodyFor(b));
    proveOwnedSalaryPreview(ownB, b);
    assert.notEqual(ownA.json.assessment.rateDeltaPerBasisUnit,
      ownB.json.assessment.rateDeltaPerBasisUnit,
      "two attackers must show distinct persisted source evidence");
    assert.throws(() => proveOwnedSalaryPreview(ownA, b),
      "attacker A owned success must not satisfy B's own positive");
    assert.deepEqual(await snapshots(), before,
      "positive salary previews are read-only for all employers");

    let denied = 0;
    for (const actor of [a, b]) {
      const cases = [
        {name: "ungranted sibling legal employer", body: bodyFor(actor, actor.siblingWorker.id, actor.siblingEntity.id), status: 403},
        {name: "ungranted sibling selector on own worker", body: bodyFor(actor, actor.worker.id, actor.siblingEntity.id), status: 403},
        {name: "higher-ID real foreign employer", body: bodyFor(victim), status: 403},
        {name: "foreign worker object under owned employer", body: bodyFor(actor, victim.worker.id), status: 404},
        {name: "conflicting entity header", body: bodyFor(actor), extraHeaders: {"x-legal-entity-id": String(actor.siblingEntity.id)}, status: 403},
        {name: "duplicate query entity selectors", body: bodyFor(actor), query: "?legalEntityId=" + actor.entity.id + "&legalEntityId=" + actor.entity.id, status: 403},
        {name: "noncanonical body selector", body: {...bodyFor(actor), legalEntityId: "0" + actor.entity.id}, status: 403},
        {name: "group selector for owner", body: bodyFor(actor), extraHeaders: {"x-legal-entity-id": "all"}, status: 403},
      ];
      for (const check of cases) {
        const response = await call(actor, check.body, {
          query: check.query, extraHeaders: check.extraHeaders,
        });
        assert.equal(response.status, check.status,
          actor.label + " " + check.name + ": expected " + check.status + " got " +
          response.status + " " + response.text.slice(0, 170));
        assert.ok(!response.text.includes(victim.marker));
        assert.ok(!response.text.includes(actor.siblingWorker.employeeNo));
        assert.ok(!response.text.includes(actor.siblingWorker.id + '"recentRevisions"'));
        denied++;
        assert.deepEqual(await snapshots(), before,
          "denied " + check.name + " must preserve all employers' SQL");
      }
    }
    assert.equal(denied, 16);

    // The same authenticated session must lose access when its entity grant is
    // revoked, even though its tenant-wide owner membership remains active.
    await db.delete(s.userLegalEntityGrants).where(and(
      eq(s.userLegalEntityGrants.organizationId, a.org.id),
      eq(s.userLegalEntityGrants.userId, a.owner.id),
      eq(s.userLegalEntityGrants.legalEntityId, a.entity.id),
    ));
    const revokedBefore = await snapshots();
    const revoked = await call(a, bodyFor(a));
    assert.equal(revoked.status, 403, "revoked entity grant must invalidate salary preview immediately");
    assert.deepEqual(await snapshots(), revokedBefore,
      "revoked same-session request must not change any employer source");
    // The other independent signed-in owner is still granted its own employer.
    proveOwnedSalaryPreview(await call(b, bodyFor(b)), b);
    assert.deepEqual(await snapshots(), revokedBefore);

    console.log(JSON.stringify({
      kind: "salary-correction-preview-legal-entity-pg16",
      separateOwnerAttackers: 2, higherIdVictim: true,
      ownRevisionBacked200: 2, ungrantedSiblingDenied: 4,
      realForeignTenantDenied: 2, crossWorkerObjectDenied: 2,
      selectorForgeryDenied: 6, totalNegativeDenials: denied,
      revokedSameSessionDenied: true, persistedSourcesUnchanged: true,
      moneyChanges: 0, outsideProviders: 0,
      methodStatus: "GAP", newCoverageCredits: 0,
    }));
  } finally {
    if (nextServer && nextServer.exitCode === null) {
      nextServer.kill("SIGTERM");
      await Promise.race([new Promise(resolve => nextServer.once("exit", resolve)), sleep(3500)]);
      if (nextServer.exitCode === null) nextServer.kill("SIGKILL");
    }
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-hcm-salary-correction-preview-http.mjs")) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
