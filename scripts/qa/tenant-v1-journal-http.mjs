/**
 * Separate API v1 journal export tenant-isolation acceptance.
 * Uses real PostgreSQL 16, real bearer-key auth and real production-mode HTTP.
 * Never calls a payment provider or approves/generates real payroll.
 *
 * Run ONLY within the dedicated disposable GitHub Actions workflow:
 *   node --import tsx scripts/qa/tenant-v1-journal-http.mjs
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  JOURNAL_WINDOW, fictionalJournalAmounts, proveJournalResponse,
  assertJournalDenial, assertJournalAuditIncrement, requireDisposableJournalEnv,
} from "./tenant-v1-journal-contract.mjs";

const BASE = "http://127.0.0.1:3000";

async function ready(proc, log) {
  for (let i = 0; i < 65; i++) {
    if (proc.exitCode !== null) throw new Error("Local Next exited before ready: " + log());
    try {
      const result = await fetch(BASE + "/login", { cache: "no-store", redirect: "manual" });
      if (result.ok) return;
    } catch { /* localhost is still booting */ }
    await delay(1000);
  }
  throw new Error("Disposable localhost server was not ready: " + log());
}

async function stop(proc) {
  if (!proc || proc.exitCode !== null) return;
  proc.kill("SIGTERM");
  await Promise.race([
    new Promise(resolve => proc.once("exit", resolve)),
    delay(4000),
  ]);
  if (proc.exitCode === null) proc.kill("SIGKILL");
}

function pathFor(extra = {}) {
  const q = new URLSearchParams({
    startDate: JOURNAL_WINDOW.startDate,
    endDate: JOURNAL_WINDOW.endDate, ...extra,
  });
  return "/api/v1/journal-entries?" + q.toString();
}

export async function verifyV1JournalTenantHttp() {
  requireDisposableJournalEnv(); // fail closed before even importing DB
  const [{ db, pool }, schema, { eq, and, asc },
    { seedEmployer, standaloneMakeSession, victimSnapshot }, { mintApiKey }] =
    await Promise.all([
      import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
      import("drizzle-orm"), import("./tenant-table-http.mjs"),
      import("../../src/lib/api-keys.ts"),
    ]);
  const { organizations, legalEntities, apiKeys, payrollRuns, auditEvents } = schema;

  const existing = await db.select({ id: organizations.id }).from(organizations).limit(1);
  assert.equal(existing.length, 0,
    "V1_JOURNAL_REFUSED: database must start with zero organizations");
  assert.equal((await db.select({ id: auditEvents.id }).from(auditEvents).limit(1)).length, 0,
    "V1_JOURNAL_REFUSED: disposable audit history must start empty");
  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  const a = await seedEmployer("ATTA", nonce, standaloneMakeSession);
  const b = await seedEmployer("ATTB", nonce, standaloneMakeSession);
  const victim = await seedEmployer("VICTIM", nonce, standaloneMakeSession);
  const employers = [a, b, victim];
  for (const field of ["org", "entity", "worker", "unit", "owner"]) {
    assert.ok(victim[field].id > a[field].id && victim[field].id > b[field].id,
      "Victim " + field + " must be a real higher-ID database row");
  }

  async function seed(e) {
    const amounts = fictionalJournalAmounts(e.rank);
    const periodLabel = e.marker + "-JOURNAL";
    const [released, draft, outside] = await db.insert(payrollRuns).values([
      {
        organizationId: e.org.id, legalEntityId: e.entity.id,
        scopeOrgUnitId: e.unit.id,
        periodLabel, periodStart: "2026-09-01", periodEnd: "2026-09-15",
        payDate: JOURNAL_WINDOW.payDate, status: "Released",
        grossPay: amounts.grossPay, netPay: amounts.netPay,
      },
      {
        organizationId: e.org.id, legalEntityId: e.entity.id,
        scopeOrgUnitId: e.unit.id,
        periodLabel: e.marker + "-DRAFT", periodStart: "2026-09-01",
        periodEnd: "2026-09-15", payDate: JOURNAL_WINDOW.payDate,
        status: "Draft", grossPay: "9900.00", netPay: "9800.00",
      },
      {
        organizationId: e.org.id, legalEntityId: e.entity.id,
        scopeOrgUnitId: e.unit.id,
        periodLabel: e.marker + "-OUTSIDE", periodStart: "2026-08-01",
        periodEnd: "2026-08-15", payDate: "2026-08-15",
        status: "Released", grossPay: "8700.00", netPay: "8600.00",
      },
    ]).returning();
    assert.ok(released.id > 0 && draft.id > released.id && outside.id > draft.id);
    for (const item of [released, draft, outside]) {
      assert.equal(item.organizationId, e.org.id);
      assert.equal(item.legalEntityId, e.entity.id);
    }
    const token = mintApiKey();
    const [key] = await db.insert(apiKeys).values({
      organizationId: e.org.id, name: "Fictional journal token",
      prefix: token.prefix, keyHash: token.keyHash, scopes: ["payroll:read"],
    }).returning();
    assert.equal(key.organizationId, e.org.id);
    assert.ok(key.id > 0 && token.key.startsWith("sk_live_"));
    return { ...e, runId: released.id, draftId: draft.id,
      outsideId: outside.id, periodLabel, keyId: key.id, token: token.key };
  }

  const [attackerA, attackerB, target] = await Promise.all(employers.map(seed));
  const all = [attackerA, attackerB, target];
  assert.ok(target.keyId > attackerA.keyId && target.keyId > attackerB.keyId,
    "Victim must have a real later bearer-key ID");
  assert.ok(target.runId > attackerA.runId && target.runId > attackerB.runId,
    "Victim released payroll ID must really exceed attacker IDs");

  const audit = e => db.select({
    id: auditEvents.id, organizationId: auditEvents.organizationId,
    actor: auditEvents.actor, action: auditEvents.action,
    resource: auditEvents.resource, metadata: auditEvents.metadata,
  }).from(auditEvents).where(and(
    eq(auditEvents.organizationId, e.org.id),
    eq(auditEvents.action, "API payroll accounting journal exported"),
  )).orderBy(asc(auditEvents.id));
  const runs = e => db.select().from(payrollRuns)
    .where(eq(payrollRuns.organizationId, e.org.id)).orderBy(asc(payrollRuns.id));
  const keyRows = e => db.select().from(apiKeys)
    .where(eq(apiKeys.organizationId, e.org.id)).orderBy(asc(apiKeys.id));

  const beforeVictim = await victimSnapshot(victim.org.id);
  const beforeVictimRuns = await runs(victim);
  const beforeVictimKeys = await keyRows(victim);
  const beforeRuns = await Promise.all([runs(a), runs(b)]);

  let server;
  try {
    server = spawn(process.execPath,
      ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3000"],
      { env: { ...process.env, DEMO_MODE: "false" }, stdio: ["ignore", "pipe", "pipe"] });
    let logs = "";
    const collect = data => { logs = (logs + String(data)).slice(-1800); };
    server.stdout.on("data", collect);
    server.stderr.on("data", collect);
    await ready(server, () => logs);

    async function get(path, key) {
      assert.ok(path.startsWith("/api/v1/journal-entries?"),
        "All integration requests must remain inside the journal route");
      const headers = key ? { authorization: "Bearer " + key } : {};
      const response = await fetch(BASE + path, {
        method: "GET", headers, redirect: "manual", cache: "no-store",
      });
      const text = await response.text();
      for (const e of all) assert.ok(!text.includes(e.token),
        "No bearer key may appear in an HTTP body");
      return { status: response.status, text, headers: response.headers };
    }
    const expected = (e, other) => ({
      rank: e.rank, runId: e.runId, entityId: e.entity.id,
      periodLabel: e.periodLabel,
      forbiddenMarkers: [
        target.marker, other.marker, e.marker + "-DRAFT", e.marker + "-OUTSIDE",
      ].filter(v => v !== e.marker),
      forbiddenTokens: all.map(row => row.token),
    });
    const counts = { positive: 0, negative: 0, ownOnly: 0 };
    const denied = async (path, key, status) => {
      const reply = await get(path, key);
      assertJournalDenial(reply, status, all.map(e => e.marker).concat(all.map(e => e.token)));
      counts.negative++;
      return reply;
    };
    const positive = async (e, other, path) => {
      const before = await audit(e);
      const reply = await get(path, e.token);
      proveJournalResponse(reply, expected(e, other));
      assertJournalAuditIncrement(before, await audit(e), {
        orgId: e.org.id, entityId: e.entity.id, keyId: e.keyId, count: 1,
      });
      counts.positive++;
      return reply;
    };

    // Two independent genuine own financial journals. No empty/default pass.
    const aResponse = await positive(attackerA, attackerB, pathFor());
    const bResponse = await positive(attackerB, attackerA, pathFor());
    assert.throws(() => proveJournalResponse(aResponse, expected(attackerB, attackerA)),
      "First owner's actual CSV must not satisfy the other owner's proof");
    assert.throws(() => proveJournalResponse(bResponse, expected(attackerA, attackerB)),
      "Second owner's actual CSV must not satisfy the first owner's proof");

    // Exact legal-entity filter can only name the key's own real legal employer.
    await positive(attackerA, attackerB,
      pathFor({ legalEntityId: String(attackerA.entity.id) }));
    await positive(attackerB, attackerA,
      pathFor({ legalEntityId: String(attackerB.entity.id) }));
    for (const [own, other] of [[attackerA, attackerB], [attackerB, attackerA]]) {
      const before = await audit(own);
      await denied(pathFor({ legalEntityId: String(target.entity.id) }), own.token, 403);
      await denied(pathFor({ legalEntityId: String(other.entity.id) }), own.token, 403);
      assert.deepEqual(await audit(own), before, "foreign entity probes must not export/audit");
    }

    // The request's apparent organizationId cannot override bearer-key ownership.
    await positive(attackerA, attackerB,
      pathFor({ organizationId: String(target.org.id), legalEntityId: String(attackerA.entity.id) }));
    counts.ownOnly++;

    // No key, unrecognized key and wrong scope must not export data or audit.
    const beforeA = await audit(attackerA);
    await denied(pathFor(), undefined, 401);
    await denied(pathFor(), "sk_live_" + randomUUID(), 401);
    const disallowedToken = mintApiKey();
    const [scopedKey] = await db.insert(apiKeys).values({
      organizationId: attackerA.org.id, name: "Synthetic wrong-scope token",
      prefix: disallowedToken.prefix, keyHash: disallowedToken.keyHash,
      scopes: ["employees:read"],
    }).returning();
    assert.equal(scopedKey.organizationId, attackerA.org.id);
    await denied(pathFor(), disallowedToken.key, 403);
    await denied(pathFor({ startDate: "2026-13-01" }), attackerA.token, 400);
    assert.deepEqual(await audit(attackerA), beforeA,
      "invalid authorization, scope and date attempts must never export or audit");

    // A previously single-employer token must refuse ambiguous multi-entity scope.
    const [secondEntity] = await db.insert(legalEntities).values({
      organizationId: attackerA.org.id,
      code: attackerA.marker.slice(0, 25) + "-2",
      legalName: attackerA.marker + " fictional second entity",
      displayName: attackerA.marker + " second entity",
      primaryEntity: false,
    }).returning();
    assert.ok(secondEntity.id > attackerA.entity.id);
    await denied(pathFor(), attackerA.token, 409);
    assert.deepEqual(await audit(attackerA), beforeA,
      "multi-entity blocked tokens must not export or audit");

    // Revocation is checked on every request, even with a previously used key.
    await db.update(apiKeys).set({ revokedAt: new Date() })
      .where(eq(apiKeys.id, attackerB.keyId));
    const beforeB = await audit(attackerB);
    await denied(pathFor(), attackerB.token, 401);
    assert.deepEqual(await audit(attackerB), beforeB,
      "revoked keys must not generate new audit/export data");

    // The sole authorized effects of the exercise are own audit inserts,
    // own key last-used / deliberately revoked marker, and A's extra
    // synthetic legal entity; released/draft/outside payroll rows never change.
    assert.deepEqual(await runs(a), beforeRuns[0]);
    assert.deepEqual(await runs(b), beforeRuns[1]);
    assert.deepEqual(await runs(victim), beforeVictimRuns);
    assert.deepEqual(await keyRows(victim), beforeVictimKeys,
      "real higher-ID victim API-key rows must remain completely untouched");
    assert.deepEqual(await victimSnapshot(victim.org.id), beforeVictim,
      "real victim organization, employee, entity, audit, and recovery rows unchanged");
    assert.deepEqual(await audit(victim), [], "the victim's accounting journal is never exported");
    assert.ok(counts.positive >= 5 && counts.negative >= 8);
    console.log(JSON.stringify({
      kind: "tenant-v1-payroll-journal-http", method: "GET v1/journal-entries",
      apiAuth: "real bearer token", postgres: "disposable 16", localhostHttp: true,
      attackers: 2, realHigherIdVictim: 1,
      positiveOwn: counts.positive, denied: counts.negative,
      forgedOrganizationStayedWithKey: counts.ownOnly === 1,
      victimPayrollAndTokensUnchanged: true, csvCentavosBalanced: true,
      moneyMoved: false, productionTested: false, coverageCredits: 0,
    }));
  } finally {
    await stop(server);
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-v1-journal-http.mjs")) {
  verifyV1JournalTenantHttp().then(() => process.exit(0), error => {
    console.error(error);
    process.exit(1);
  });
}
