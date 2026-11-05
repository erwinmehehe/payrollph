/**
 * POST hcm/effective-changes: separate HCM family proof, isolated fictional PG16, real HTTP against a production build.
 * Nine employers (two attackers, six fillers, a higher-ID victim). Each attacker proves every target dimension and movement
 * type as an own pending change (business process and audit written together, nothing applied), and that foreign
 * organization, worker, org unit, supervisory unit, cost center, manager, legal employer and position references are refused
 * with no write in any employer. No provider calls, payroll runs or migrations; no method credit on this proof PR.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireDisposableHcmEffectiveChangePost } from "./tenant-hcm-effective-change-post-contract.mjs";

const labels = ["ATTA", "ATTB", "FILL0", "FILL1", "FILL2", "FILL3", "FILL4", "FILL5", "VICTIM"];
const plain = value => JSON.parse(JSON.stringify(value));

export async function verifyHcmEffectiveChangePostHttp() {
  requireDisposableHcmEffectiveChangePost(); // Guard MUST precede any app, database or table imports.
  const [{ db, pool }, s, { asc, eq }, http, invariants, actions] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
    import("./tenant-table-invariants.mjs"),
    import("./tenant-table-rows/helpers/hcm-effective-change-actions.mjs"),
  ]);
  const { seedEmployer, addWorker, standaloneMakeSession, standaloneRequest, standaloneExpectStatus } = http;
  const { auditBusinessSnapshot } = invariants;
  try {
    for (const [name, table] of [["employers", s.organizations], ["effective changes", s.workerEffectiveChanges],
      ["business processes", s.hcmBusinessProcessInstances], ["audit events", s.auditEvents]]) {
      assert.equal((await db.select().from(table).limit(1)).length, 0, "HCM_EFFECTIVE_CHANGE_REFUSED: nonempty " + name + " on disposable PG16");
    }
    const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
    const people = [];
    for (const label of labels) people.push(await seedEmployer(label, nonce, standaloneMakeSession));
    const [a, b, ...rest] = people;
    const victim = rest.at(-1);
    assert.ok(victim.org.id > 6 && victim.org.id > a.org.id && victim.org.id > b.org.id, "victim employer must have the highest id");
    assert.ok(victim.worker.id > 6 && victim.worker.id > a.worker.id && victim.worker.id > b.worker.id);
    assert.notEqual(a.cookie, b.cookie, "independent signed-in attackers");

    // Every employer, victim and fillers included, gets the same fictional targets and workers.
    for (const e of people) {
      e.main = await addWorker(e, "N");
      [e.destination] = await db.insert(s.orgUnits).values({ organizationId: e.org.id, legalEntityId: e.entity.id, type: "department",
        code: e.marker + "-MOVE", name: e.marker + " destination" }).returning();
      e.extras = await actions.seedActionTargets({ db, addWorker }, e);
    }
    assert.ok(victim.extras.supervisoryId > a.extras.supervisoryId && victim.extras.vacantId > b.extras.vacantId, "victim targets are the highest ids");

    const snapshotEmployer = async e => {
      const read = table => db.select().from(table).where(eq(table.organizationId, e.org.id)).orderBy(asc(table.id));
      return plain({ changes: await read(s.workerEffectiveChanges), processes: await read(s.hcmBusinessProcessInstances), workers: await read(s.employees),
        positions: await read(s.positions), assignments: await read(s.positionAssignments), units: await read(s.orgUnits), costCenters: await read(s.costCenters),
        entities: await read(s.legalEntities), audits: auditBusinessSnapshot(await read(s.auditEvents)) });
    };
    const snapshots = () => Promise.all(people.map(snapshotEmployer));

    const results = [];
    for (let i = 0; i < 2; i++) {
      const e = people[i], before = await snapshots();
      const c = { orgId: e.org.id, org: e.org, owner: e.owner, marker: e.marker, entity: e.entity, unit: e.unit, workerId: e.worker.id,
        seeded: { id: e.main.id, targetUnitId: e.destination.id, extras: e.extras }, victim: { org: victim.org, marker: victim.marker, entity: victim.entity },
        victimSeeded: { id: victim.main.id, targetUnitId: victim.destination.id, extras: victim.extras } };
      const proof = await actions.effectiveChangeActions({ assert, asc, auditBusinessSnapshot, db, eq }, c,
        { request: standaloneRequest, expectStatus: standaloneExpectStatus, cookie: e.cookie });
      const after = await snapshots();
      // Only this attacker's own employer may differ; every other employer (the other attacker, fillers, victim) is byte-identical.
      for (let j = 0; j < people.length; j++) if (j !== i) assert.deepEqual(after[j], before[j], labels[j] + " is untouched by " + labels[i]);
      assert.notDeepEqual(after[i], before[i], labels[i] + " own changes were persisted");
      assert.equal(after[i].changes.length, before[i].changes.length + 8, "eight own pending changes per attacker");
      assert.equal(after[i].processes.length, before[i].processes.length + 8, "eight own business processes per attacker");
      results.push(proof);
    }
    console.log(JSON.stringify({
      method: "POST /api/hcm/effective-changes",
      fictionalEmployers: 9, independentAttackerEmployers: 2, highIdVictim: true,
      ownPendingChangesPerAttacker: 8, actions: results[0].actions,
      allEmployerSnapshotsCompared: true, victimImmutable: true,
      payrollOrProviderWrites: false, productionTested: false,
      coverageCreditsAdded: 0, independentReviewPending: true,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-hcm-effective-change-post-http.mjs")) {
  verifyHcmEffectiveChangePostHttp().catch(error => {
    console.error(error instanceof Error ? error.message : "HCM effective change POST proof failed");
    process.exitCode = 1;
  });
}
