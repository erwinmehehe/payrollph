// DL-02 family: enhanced Web Bundy real pending evidence and employee scope.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { workforcePunchSubmissions } from "../../../src/db/schema";

export const METHODS = Object.freeze([
  "GET /api/web-bundy/evidence",
  "POST /api/web-bundy/evidence",
]);

const makePunch = (e, overrides = {}) => ({
  organizationId: e.org.id,
  employeeId: e.worker.id,
  actionType: "clock_in",
  clientPunchId: randomUUID(),
  deviceId: randomUUID(),
  deviceOccurredAt: new Date().toISOString(),
  source: "online",
  ...overrides,
});
const record = async (ctx, id) => {
  const [row] = await ctx.db.select().from(workforcePunchSubmissions)
    .where(eq(workforcePunchSubmissions.id, id)).limit(1);
  return row;
};
const post = (ctx, e, payload) =>
  ctx.postForm("/api/web-bundy/evidence", e.essCookie, payload);

export async function seedOwn(ctx) {
  for (const e of ctx.all) {
    const payload = makePunch(e);
    const response = ctx.exact(await post(ctx, e, payload), 202,
      "DL-02 real own Web Bundy POST " + e.label);
    assert.equal(response.json?.ok, true);
    assert.equal(response.json?.status, "pending");
    assert.equal(response.json?.duplicate, false);
    const id = response.json?.id;
    assert.ok(Number.isSafeInteger(id) && id > 6, "own POST must create a real nontrivial PK");
    const row = await record(ctx, id);
    assert.ok(row, "POST must persist a real PostgreSQL punch");
    assert.equal(row.organizationId, e.org.id);
    assert.equal(row.employeeId, e.worker.id);
    assert.equal(row.clientPunchId, payload.clientPunchId);
    assert.equal(row.requestedByUserId, e.ess.id);
    assert.equal(row.status, "pending");
    ctx.noVictim(response, ctx.victim, "Own Web Bundy POST");
    e.punch = row;
  }
  const victim = ctx.victim.punch;
  assert.ok(victim.id > 6 && ctx.attackers.every(e => victim.id > e.punch.id),
    "victim real punch ID exceeds both real attacker punch IDs");
}

export async function verifyCrossEmployer(ctx) {
  for (const e of ctx.attackers) {
    // GET: a real saved punch (not an empty/default catalog) must be returned.
    const get = ctx.exact(await ctx.request("/api/web-bundy/evidence?organizationId=" + e.org.id,
      { cookie: e.essCookie }), 200, "DL-02 own nonempty Web Bundy GET");
    assert.equal(get.json?.enabled, true);
    assert.ok(get.json?.pending?.some(row => row.id === e.punch.id &&
      row.status === "pending" && row.actionType === "clock_in"));
    assert.ok(get.json.pending.every(row => row.id !== ctx.victim.punch.id));
    ctx.noVictim(get, ctx.victim, "Own Web Bundy GET");

    // GET forged employee selector is NOT honored: only the session's worker
    // is queried. Assert the unchanged own persisted result is still returned.
    const getForged = ctx.exact(await ctx.request(
      "/api/web-bundy/evidence?organizationId=" + e.org.id +
      "&employeeId=" + ctx.victim.worker.id, { cookie: e.essCookie }),
    200, "Web Bundy GET ignores forged employee selector");
    assert.ok(getForged.json?.pending?.some(row => row.id === e.punch.id));
    assert.ok(getForged.json.pending.every(row => row.id !== ctx.victim.punch.id));
    ctx.noVictim(getForged, ctx.victim, "Forged Web Bundy GET");

    // Real foreign employer and employee are both seeded and allowlisted;
    // this must reach the membership guard, never feature-disabled 404.
    const getForeign = ctx.exact(await ctx.request(
      "/api/web-bundy/evidence?organizationId=" + ctx.victim.org.id +
      "&employeeId=" + ctx.victim.worker.id, { cookie: e.essCookie }),
    403, "Web Bundy GET denies real victim employer");
    ctx.noVictim(getForeign, ctx.victim, "Victim Web Bundy GET");

    const foreign = ctx.exact(await post(ctx, e, makePunch(e, {
      organizationId: ctx.victim.org.id, employeeId: ctx.victim.worker.id,
    })), 403, "Web Bundy POST denies actual victim employer");
    ctx.noVictim(foreign, ctx.victim, "Victim Web Bundy POST");

    // Even when organizationId is legitimately own, the victim employee PK
    // cannot be used to reassign an uploaded punch to another worker.
    const forged = ctx.exact(await post(ctx, e, makePunch(e, {
      employeeId: ctx.victim.worker.id,
    })), 403, "Web Bundy POST denies real victim employee selector");
    ctx.noVictim(forged, ctx.victim, "Forged Web Bundy POST");
    assert.deepEqual(await record(ctx, e.punch.id), e.punch,
      "denied punches must not mutate the own persisted positive");
  }
}
