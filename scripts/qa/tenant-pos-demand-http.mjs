/**
 * Dedicated four-method WRK-01 Loyverse/Square source tenant proof.
 *
 * Real HTTP -> production-mode Next handlers -> disposable PG16.
 * All provider HTTP is intercepted by an exact-host synthetic preload.
 * A single merchant connection is pinned to ONE employer at a time in
 * production; therefore restart the local app for A, B and higher-ID victim.
 * No automatic manifest credit, and no staging/production/provider access.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { openSync, closeSync } from "node:fs";
import { resolve } from "node:path";
import {
  POS_PROVIDERS, POS_DEMAND_METHODS, requireDisposablePosDemand,
  assertPosDenial, assertOwnGet, assertOwnPost, assertNoForeignLeak,
  assertCompletePosDemandCounts,
} from "./tenant-pos-demand-contract.mjs";

const DAY = 86_400_000;
const plain = value => JSON.parse(JSON.stringify(value));
const dayAgo = n => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const TABLES = [
  "worksites", "workforceDemandImportBatches", "workforceDemandObservationRevisions",
  "workforceDemandForecastIssues", "workforceDemandForecastScores",
  "employees", "employeePayProfiles", "payrollRuns", "timePunches",
  "employeeScheduleAssignments", "userOrganizations", "legalEntities",
];
const pause = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));

async function startServer(actor) {
  const marker = actor.org.id;
  const storeId = "11111111-2222-4333-8444-" + String(marker).padStart(12, "0");
  const logFile = "/tmp/tenant-pos-demand-next-" + marker + ".log";
  const fd = openSync(logFile, "a", 0o600);
  const env = {
    ...process.env,
    NODE_OPTIONS: "--require=" + resolve("scripts/qa/tenant-pos-demand-provider-mock.cjs"),
    WFM_POS_MOCK_ONLY: "fictional-local-no-network",
    WFM_LOYVERSE_POS_ORGANIZATION_ID: String(actor.org.id),
    WFM_LOYVERSE_POS_WORKSITE_ID: String(actor.site.id),
    WFM_LOYVERSE_MERCHANT_CONSENT_RECORDED: "true",
    WFM_LOYVERSE_AUTH_MODE: "oauth_receipts_read",
    WFM_LOYVERSE_GRANTED_SCOPES: "RECEIPTS_READ STORES_READ",
    WFM_LOYVERSE_ACCESS_TOKEN: "ci-fictional-only-" + actor.org.id,
    WFM_LOYVERSE_STORE_ID: storeId,
    WFM_SQUARE_SANDBOX_ORGANIZATION_ID: String(actor.org.id),
    WFM_SQUARE_SANDBOX_WORKSITE_ID: String(actor.site.id),
    WFM_SQUARE_SANDBOX_CONSENT_ACKNOWLEDGED: "true",
    WFM_SQUARE_SANDBOX_ACCESS_TOKEN: "ci-fictional-only-" + actor.org.id,
    WFM_SQUARE_SANDBOX_LOCATION_ID: "ci_location_" + actor.org.id,
  };
  const child = spawn(process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3000"],
    { cwd: process.cwd(), env, stdio: ["ignore", fd, fd] });
  closeSync(fd);
  let ready = false;
  for (let attempt = 0; attempt < 75; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) break;
    try {
      const response = await fetch("http://127.0.0.1:3000/login", {
        signal: AbortSignal.timeout(1000), cache: "no-store",
      });
      if (response.status === 200) { ready = true; break; }
    } catch {}
    await pause(500);
  }
  if (!ready) {
    child.kill("SIGTERM");
    throw Error("POS_DEMAND_SERVER_NOT_READY: inspect bounded localhost server log " + logFile);
  }
  return child;
}
async function stopServer(child) {
  child.kill("SIGTERM");
  for (let i = 0; i < 40; i++) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await pause(150);
  }
  child.kill("SIGKILL");
  throw Error("POS_DEMAND_SERVER_DID_NOT_EXIT");
}

export async function provePosDemandFourMethods() {
  // Fail closed BEFORE importing any application module or touching PostgreSQL.
  const ids = requireDisposablePosDemand();
  const [database, s, orm, http, invariants] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
    import("./tenant-table-invariants.mjs"),
  ]);
  const { db, pool } = database;
  const { eq, asc } = orm;
  try {
    const version = await pool.query("SHOW server_version_num");
    assert.equal(Math.floor(Number(version.rows[0]?.server_version_num) / 10000), 16,
      "POS_DEMAND_REFUSED: actual fresh PostgreSQL 16 required");
    const [victim, a, b] = invariants.readAllowlistPreseed(
      process.env.TENANT_TABLE_ALLOWLIST_FIXTURE);
    const excluded = invariants.readPrivateAllowlistFixture(
      process.env.TENANT_TABLE_ALLOWLIST_FIXTURE).excluded;
    assert.deepEqual(ids, [a.org.id, b.org.id, victim.org.id]);
    const subjects = [a, b, victim, excluded];
    const attackers = [a, b];
    const workDate = dayAgo(20), baselineDate = dayAgo(40);
    const scannedTime = baselineDate + "T09:00:00+08:00";

    // Fixture inserts always A, B, victim and excluded. Never guessed SQL IDs.
    for (const actor of [a, b, victim, excluded]) {
      const [site] = await db.insert(s.worksites).values({
        organizationId: actor.org.id, orgUnitId: actor.unit.id,
        code: ("POS-" + actor.marker).slice(0, 32).toUpperCase(),
        name: actor.marker + " fictional PH POS demand site",
        timezone: "Asia/Manila", active: true,
      }).returning();
      actor.site = site;
      for (const [provider, desc] of Object.entries(POS_PROVIDERS)) {
        const [batch] = await db.insert(s.workforceDemandImportBatches).values({
          organizationId: actor.org.id, worksiteId: site.id,
          sourceKey: desc.source, metricKind: "transactions",
          intervalMinutes: 60, idempotencyKey: randomUUID(),
          requestSha256: digest({ actor: actor.org.id, provider, baselineDate }),
          rowCount: 1, createdByUserId: actor.owner.id,
        }).returning();
        const [row] = await db.insert(s.workforceDemandObservationRevisions).values({
          organizationId: actor.org.id, worksiteId: site.id,
          importBatchId: batch.id, sourceKey: desc.source, metricKind: "transactions",
          intervalMinutes: 60, intervalStart: new Date(scannedTime),
          revision: 1, observedCount: actor.rank + (provider === "square" ? 2 : 1),
          quality: "complete",
        }).returning();
        actor[provider] = { batch, row };
      }
    }
    assert.ok(victim.org.id > Math.max(a.org.id, b.org.id));
    assert.ok(victim.site.id > Math.max(a.site.id, b.site.id));
    for (const provider of Object.keys(POS_PROVIDERS)) {
      assert.ok(victim[provider].batch.id >
        Math.max(a[provider].batch.id, b[provider].batch.id));
      assert.ok(victim[provider].row.id >
        Math.max(a[provider].row.id, b[provider].row.id));
    }

    async function snapshot(orgId) {
      const out = { organizations: await db.select().from(s.organizations)
        .where(eq(s.organizations.id, orgId)).orderBy(asc(s.organizations.id)) };
      for (const name of TABLES) {
        const table = s[name];
        assert.ok(table?.id && table.organizationId, "missing real SQL proof table: " + name);
        out[name] = await db.select().from(table)
          .where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
      }
      out.audit = invariants.auditBusinessSnapshot(await db.select()
        .from(s.auditEvents).where(eq(s.auditEvents.organizationId, orgId))
        .orderBy(asc(s.auditEvents.id)));
      return plain(out);
    }
    const freeze = async () => new Map(await Promise.all(subjects.map(async e =>
      [e.org.id, await snapshot(e.org.id)])));
    async function unchanged(before, label, allowActorId = null) {
      for (const actor of subjects) {
        if (actor.org.id === allowActorId) continue;
        assert.deepEqual(await snapshot(actor.org.id), before.get(actor.org.id),
          label + ": employer SQL, payroll and business audit changed for " + actor.marker);
      }
    }
    const request = http.standaloneRequest;
    const query = (actor, provider, orgId = actor.org.id, siteId = actor.site.id) =>
      POS_PROVIDERS[provider].path + "?organizationId=" + orgId +
      "&worksiteId=" + siteId + "&intervalMinutes=60";
    const payload = (actor, orgId = actor.org.id, siteId = actor.site.id, dryRun = false) =>
      ({ organizationId: orgId, worksiteId: siteId, workDate,
        intervalMinutes: 60, dryRun, acknowledged: true });
    const otherMarkers = actor => subjects.filter(e => e !== actor).map(e => e.marker);
    async function denied(path, method, actor, body, status, label) {
      const before = await freeze();
      const result = await request(path, { method, cookie: actor?.cookie, body });
      assertPosDenial(result, status, subjects.map(x => x.marker));
      await unchanged(before, label);
    }
    const counts = Object.fromEntries(
      Object.keys((await import("./tenant-pos-demand-contract.mjs"))
        .REQUIRED_POS_DEMAND_COUNTS).map(key => [key, 0]));
    const firstActorGets = new Map();
    for (const actor of [a, b, victim]) {
      const server = await startServer(actor);
      try {
        assert.equal((await request("/api/account", { cookie: actor.cookie })).status, 200,
          "genuinely signed-in fictional employer owner session");
        for (const provider of Object.keys(POS_PROVIDERS)) {
          const desc = POS_PROVIDERS[provider];
          const path = desc.path;
          const ownedQuery = query(actor, provider);
          const beforeGet = await freeze();
          const own = await request(ownedQuery, { cookie: actor.cookie });
          assertOwnGet(own, actor, provider, actor.site);
          assertNoForeignLeak(own, otherMarkers(actor));
          await unchanged(beforeGet, provider + " own GET");
          counts.ownGet++;

          if (actor === a) firstActorGets.set(provider, own);
          if (actor === b) {
            assert.throws(() => assertOwnGet(firstActorGets.get(provider),
              actor, provider, actor.site));
            counts.responseSwapRejected++;
          }
          if (attackers.includes(actor)) {
            await denied(query(victim, provider), "GET", actor, undefined, 403,
              provider + " real high-ID victim GET"); counts.foreignEmployerGet403++;
            await denied(path + "?organizationId=" + actor.org.id +
              "&worksiteId=" + victim.site.id + "&intervalMinutes=60",
              "GET", actor, undefined, 403,
              provider + " stolen victim worksite GET"); counts.stolenWorksiteGet403++;
            await denied(path, "POST", actor, payload(victim), 403,
              provider + " real high-ID victim POST"); counts.foreignEmployerPost403++;
            await denied(path, "POST", actor,
              payload(actor, actor.org.id, victim.site.id), 403,
              provider + " stolen victim worksite POST"); counts.stolenWorksitePost403++;
            await denied(ownedQuery, "GET", null, undefined, 401,
              provider + " anonymous GET"); counts.anonymousGet401++;
            await denied(path, "POST", null, payload(actor), 401,
              provider + " anonymous POST"); counts.anonymousPost401++;
            await denied(path + "?organizationId=" + actor.org.id +
              "&worksiteId=" + actor.site.id + "&intervalMinutes=10",
              "GET", actor, undefined, 400,
              provider + " invalid interval GET"); counts.invalidGet400++;
            await denied(path, "POST", actor,
              { ...payload(actor), sourceKey: "injected-victim-source" }, 400,
              provider + " unknown source selector POST"); counts.invalidPost400++;
            await denied(query(excluded, provider), "GET", actor, undefined, 403,
              provider + " unrelated disabled employer GET"); counts.excludedEmployerGet403++;
            await denied(path, "POST", actor, payload(excluded), 403,
              provider + " unrelated disabled employer POST"); counts.excludedEmployerPost403++;
          }

          const beforeDry = await freeze();
          const dry = await request(path,
            { method: "POST", cookie: actor.cookie, body: payload(actor, undefined, undefined, true) });
          assertOwnPost(dry, provider, true);
          if (provider === "loyverse") {
            assert.equal(dry.json.scope.organizationId, actor.org.id);
            assert.equal(dry.json.scope.worksiteId, actor.site.id);
          }
          assertNoForeignLeak(dry, otherMarkers(actor));
          await unchanged(beforeDry, provider + " dry-run must write nothing");
          counts.ownDryRun++;

          const beforeWrite = await freeze();
          const stored = await request(path,
            { method: "POST", cookie: actor.cookie, body: payload(actor) });
          assertOwnPost(stored, provider, false);
          assertNoForeignLeak(stored, otherMarkers(actor));
          await unchanged(beforeWrite, provider + " successful POST", actor.org.id);
          const after = await snapshot(actor.org.id);
          const old = beforeWrite.get(actor.org.id);
          for (const key of ["organizations", ...TABLES]
            .filter(x => !["workforceDemandImportBatches", "workforceDemandObservationRevisions"].includes(x))) {
            assert.deepEqual(after[key], old[key], provider + " cannot mutate " + key);
          }
          const delta = (key) => after[key].filter(row =>
            !old[key].some(prev => prev.id === row.id));
          const batches = delta("workforceDemandImportBatches");
          const rows = delta("workforceDemandObservationRevisions");
          const audits = delta("audit");
          assert.equal(batches.length, 1, "exactly one real SQL source import required");
          assert.equal(rows.length, 24, "one complete PH day of 60-minute synthetic intervals");
          const batch = batches[0];
          assert.equal(batch.organizationId, actor.org.id);
          assert.equal(batch.worksiteId, actor.site.id);
          assert.equal(batch.sourceKey, desc.source);
          assert.equal(batch.createdByUserId, actor.owner.id);
          assert.equal(batch.rowCount, 24);
          assert.equal(stored.json[provider === "loyverse" ? "importBatchId" : "batchId"], batch.id);
          for (const row of rows) {
            assert.equal(row.organizationId, actor.org.id);
            assert.equal(row.worksiteId, actor.site.id);
            assert.equal(row.importBatchId, batch.id);
            assert.equal(row.sourceKey, desc.source);
            assert.equal(row.intervalMinutes, 60);
            assert.equal(row.revision, 1);
            assert.equal(row.quality, "complete");
          }
          assert.equal(rows.reduce((sum, row) => sum + row.observedCount, 0), 1);
          assert.ok(audits.some(audit => audit.action ===
            "WFM aggregate operational demand imported" &&
            audit.organizationId === actor.org.id &&
            audit.actor === actor.owner.name &&
            audit.metadata?.importBatchId === batch.id));
          assert.ok(audits.some(audit => provider === "loyverse"
            ? audit.action === "WFM Loyverse POS historical source scan succeeded"
            : audit.action === "WFM Square sandbox source checked"));
          counts.ownPersistedPost++;

          const afterGet = await request(ownedQuery, { cookie: actor.cookie });
          assertOwnGet(afterGet, actor, provider, actor.site, 24);
          assertNoForeignLeak(afterGet, otherMarkers(actor));
          counts.ownReadAfterPost++;
        }
      } finally {
        await stopServer(server);
      }
    }
    assertCompletePosDemandCounts(counts);
    assert.deepEqual(POS_DEMAND_METHODS, [
      "GET workforce/demand-observations/loyverse",
      "POST workforce/demand-observations/loyverse",
      "GET workforce/demand-observations/square-sandbox",
      "POST workforce/demand-observations/square-sandbox",
    ]);
    console.log(JSON.stringify({
      kind: "tenant-pos-demand-four-method-real-http",
      methodKeys: POS_DEMAND_METHODS, counts, postgres: 16,
      genuineTwoAttackerPositives: true, realHigherIdVictim: true,
      forbiddenRealProviderCalls: true, testOnlyMock: true,
      deploymentAuthorized: false, independentReview: "PENDING",
      newManifestCredits: 0,
    }));
  } finally {
    await pool.end();
  }
}
if (process.argv[1]?.replaceAll("\\", "/")
  .endsWith("/tenant-pos-demand-http.mjs")) {
  provePosDemandFourMethods().then(() => process.exit(0), err => {
    console.error(err); process.exit(1);
  });
}
