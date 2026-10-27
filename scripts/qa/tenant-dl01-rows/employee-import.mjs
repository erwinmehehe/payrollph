/** DL-01 employee CSV POST: real create-only rows + real victim employer denial. */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { victimSnapshot } from "../tenant-dl01-closure-shared.mjs";

export const METHODS = Object.freeze(["POST /api/employees/import"]);
const csv = e => "Employee No,First Name,Last Name,Start Date,Monthly Basic,Region,Title\n" +
  "DL01IMPORT-" + e.label + ",Fictional," + e.label + ",2026-02-01,24000.00,NCR,Test Worker\n";
const body = e => ({
  organizationId: e.org.id, csv: csv(e),
  fileName: "CI-no-real-employees-" + e.label + ".csv", dryRun: false,
});
const batches = (ctx, org) => ctx.db.select().from(ctx.s.importBatches)
  .where(eq(ctx.s.importBatches.organizationId, org));
const workers = (ctx, org) => ctx.db.select().from(ctx.s.employees)
  .where(eq(ctx.s.employees.organizationId, org));

export async function prepare(ctx) {
  for (const e of ctx.all) {
    const result = ctx.exact(await ctx.request("/api/employees/import", {
      method: "POST", cookie: e.operator.cookie, body: body(e),
    }), 200, "DL-01 real own CSV POST creates one employee " + e.label);
    assert.equal(result.json?.createdCount, 1);
    assert.equal(result.json?.updatedCount, 0);
    assert.equal(result.json?.dryRun, false);
    assert.ok(Number.isSafeInteger(result.json?.batchId));
    const created = (await workers(ctx, e.org.id))
      .find(row => row.employeeNo === "DL01IMPORT-" + e.label);
    assert.ok(created && created.organizationId === e.org.id);
    assert.equal(created.firstName, "Fictional");
    assert.equal(created.basicRate, "24000.00");
    const rows = await batches(ctx, e.org.id);
    assert.ok(rows.some(row => row.id === result.json.batchId &&
      row.createdCount === 1 && row.status === "completed"));
    const profiles = await ctx.db.select().from(ctx.s.employeePayProfiles)
      .where(eq(ctx.s.employeePayProfiles.employeeId, created.id));
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].organizationId, e.org.id);
    const audit = await ctx.db.select().from(ctx.s.auditEvents)
      .where(eq(ctx.s.auditEvents.organizationId, e.org.id));
    assert.ok(audit.some(row => row.action === "Employee import completed (create-only)" &&
      Number(row.metadata?.batchId) === result.json.batchId));
    e.imported = { batchId: result.json.batchId, worker: created };
    ctx.noVictim(result, ctx.victim, "DL-01 own import");
  }
  assert.ok(ctx.victim.imported.batchId > 6 &&
    ctx.attackers.every(e => ctx.victim.imported.batchId > e.imported.batchId),
    "Real persisted victim import-batch ID must be greater than both attacker IDs");
}

export async function verify(ctx) {
  const victimBefore = await victimSnapshot(ctx.victim);
  for (const e of ctx.attackers) {
    const priorOwnWorkers = await workers(ctx, e.org.id);
    const priorOwnBatches = await batches(ctx, e.org.id);
    // organizationId is the ONLY accepted tenant selector in CSV import.
    // A spoofed victim employer in an otherwise syntactically valid CSV must
    // fail at authenticated organization scope, before billing/parsing/writes.
    const foreign = ctx.exact(await ctx.request("/api/employees/import", {
      method: "POST", cookie: e.operator.cookie,
      body: { ...body(e), organizationId: ctx.victim.org.id,
        employeeId: ctx.victim.worker.id },
    }), 403, "DL-01 import rejects forged real victim organization");
    ctx.noVictim(foreign, ctx.victim, "DL-01 victim import denial");
    const forged = ctx.exact(await ctx.request("/api/employees/import", {
      method: "POST", cookie: e.operator.cookie,
      body: { ...body(e), organizationId: ctx.victim.org.id,
        fileName: ctx.victim.marker + "-forged.csv", workerId: ctx.victim.worker.id },
    }), 403, "DL-01 forged-import employer selector denied");
    ctx.noVictim(forged, ctx.victim, "DL-01 forged import selector");
    assert.deepEqual(await workers(ctx, e.org.id), priorOwnWorkers,
      "Denied import must not modify legitimate own workers");
    assert.deepEqual(await batches(ctx, e.org.id), priorOwnBatches,
      "Denied import must not write an own import batch");
    assert.deepEqual(await victimSnapshot(ctx.victim), victimBefore,
      "DL-01 import cannot mutate victim employees, pay profiles, batches or audit");
  }
}
