// DL-02 family: source-reported aggregate demand, fictional site and revision.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  workforceDemandImportBatches, workforceDemandObservationRevisions,
} from "../../../src/db/schema";

export const METHODS = Object.freeze([
  "POST /api/workforce/demand-observations/import",
]);
const yesterdayNoonPH = () =>
  new Date(Date.now() - 86_400_000 + 8 * 3_600_000).toISOString().slice(0, 10) +
  "T12:00:00+08:00";
const makeImport = (e, overrides = {}) => ({
  organizationId: e.org.id,
  worksiteId: e.site.id,
  sourceKey: "dl02_" + e.label.toLowerCase(),
  metricKind: "transactions",
  intervalMinutes: 60,
  idempotencyKey: "dl02_" + randomUUID(),
  acknowledged: true,
  rows: [{
    intervalStart: yesterdayNoonPH(),
    observedCount: e.label === "ATTA" ? 13 : e.label === "ATTB" ? 23 : 37,
    quality: "complete", revision: 1,
  }],
  ...overrides,
});
const saved = async (ctx, id) => {
  const [row] = await ctx.db.select().from(workforceDemandImportBatches)
    .where(eq(workforceDemandImportBatches.id, id)).limit(1);
  return row;
};

export async function seedOwn(ctx) {
  for (const e of ctx.all) {
    const body = makeImport(e);
    const result = ctx.exact(await ctx.request(
      "/api/workforce/demand-observations/import",
      { method: "POST", cookie: e.cookie, body }), 201,
    "DL-02 legitimate owned demand import " + e.label);
    assert.equal(result.json?.rowCount, 1);
    assert.equal(result.json?.replayed, false);
    assert.match(result.json?.sha256 ?? "", /^[a-f0-9]{64}$/);
    const batchId = result.json?.batchId;
    assert.ok(Number.isSafeInteger(batchId) && batchId > 6,
      "real demand POST must persist a nontrivial batch PK");
    const row = await saved(ctx, batchId);
    assert.ok(row && row.organizationId === e.org.id && row.worksiteId === e.site.id);
    assert.equal(row.createdByUserId, e.owner.id);
    assert.equal(row.requestSha256, result.json.sha256);
    assert.equal(row.rowCount, 1);
    const revisions = await ctx.db.select().from(workforceDemandObservationRevisions)
      .where(and(eq(workforceDemandObservationRevisions.organizationId, e.org.id),
        eq(workforceDemandObservationRevisions.importBatchId, batchId)));
    assert.equal(revisions.length, 1);
    assert.equal(revisions[0].observedCount, body.rows[0].observedCount);
    assert.equal(revisions[0].worksiteId, e.site.id);
    assert.equal(revisions[0].revision, 1);
    ctx.noVictim(result, ctx.victim, "Owned demand import");
    e.demand = { batchId, row, revisions };
  }
  assert.ok(ctx.victim.demand.batchId > 6 &&
    ctx.attackers.every(e => ctx.victim.demand.batchId > e.demand.batchId),
    "real victim import batch must be higher than both persisted attacker imports");
}

export async function verifyCrossEmployer(ctx) {
  for (const e of ctx.attackers) {
    // Foreign employer and site are actually allowed for their own principal;
    // the attacker must get 403 due to membership, not a disabled pilot 404.
    const foreign = ctx.exact(await ctx.request(
      "/api/workforce/demand-observations/import",
      { method: "POST", cookie: e.cookie,
        body: makeImport(e, {
          organizationId: ctx.victim.org.id,
          worksiteId: ctx.victim.site.id,
        }) }), 403, "Real victim-employer demand import must be denied");
    ctx.noVictim(foreign, ctx.victim, "Foreign demand import");

    // Supplying a persisted victim worksite under an OWN employer may not
    // create either an own row or an unauthorized victim observation.
    const forged = ctx.exact(await ctx.request(
      "/api/workforce/demand-observations/import",
      { method: "POST", cookie: e.cookie,
        body: makeImport(e, { worksiteId: ctx.victim.site.id }) }),
    403, "Victim worksite selector denied under own employer");
    ctx.noVictim(forged, ctx.victim, "Forged demand worksite");
    assert.deepEqual(await saved(ctx, e.demand.batchId), e.demand.row,
      "denied imports must not modify the persisted own positive batch");
    const after = await ctx.db.select().from(workforceDemandObservationRevisions)
      .where(and(eq(workforceDemandObservationRevisions.organizationId, e.org.id),
        eq(workforceDemandObservationRevisions.importBatchId, e.demand.batchId)));
    assert.deepEqual(after, e.demand.revisions,
      "denied imports must not change the real own source revisions");
  }
}
