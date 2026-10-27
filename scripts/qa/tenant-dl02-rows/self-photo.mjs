// DL-02 family: session-bound employee photo upload, never an employer-selected upload.
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { essEmployeePhotos } from "../../../src/lib/ess-profile-schema";
import { userOrganizations } from "../../../src/db/schema";

export const METHODS = Object.freeze(["POST /api/self/photo"]);
const form = (ctx, e, selectors = {}) =>
  ctx.postForm("/api/self/photo", e.essCookie, selectors,
    { field: "photo", bytes: ctx.PNG, mime: "image/png", name: "fictional-photo.png" });
const photoRow = async (ctx, e) => {
  const [row] = await ctx.db.select().from(essEmployeePhotos).where(and(
    eq(essEmployeePhotos.organizationId, e.org.id),
    eq(essEmployeePhotos.employeeId, e.worker.id),
  )).limit(1);
  return row;
};

export async function seedOwn(ctx) {
  // The legitimate attacker B and C successes execute BEFORE the victim succeeds.
  for (const e of ctx.all) {
    const response = ctx.exact(await form(ctx, e), 200, "DL-02 photo legitimate own POST " + e.label);
    assert.equal(response.json?.ok, true);
    const row = await photoRow(ctx, e);
    assert.ok(row && row.employeeId === e.worker.id && row.organizationId === e.org.id);
    assert.equal(row.byteSize, ctx.PNG.length);
    assert.equal(row.contentSha256, ctx.sha256(ctx.PNG));
    assert.match(row.sealedPhoto, /^enc:essphoto:v1:/, "photo is encrypted at rest");
    ctx.noVictim(response, ctx.victim, "Own employee photo");
    e.photo = row;
  }
  assert.ok(ctx.victim.worker.id > Math.max(...ctx.attackers.map(e => e.worker.id)));
}

export async function verifyCrossEmployer(ctx) {
  for (const e of ctx.attackers) {
    // This endpoint intentionally ignores forged form selectors; identity comes
    // only from the signed-in employee session. Prove that the own row is written.
    const forged = ctx.exact(await form(ctx, e, {
      organizationId: ctx.victim.org.id, employeeId: ctx.victim.worker.id,
    }), 200, "Forged photo selectors must not redirect the own upload");
    assert.equal(forged.json?.ok, true);
    ctx.noVictim(forged, ctx.victim, "Forged photo selectors");
    const persisted = await photoRow(ctx, e);
    assert.equal(persisted?.employeeId, e.worker.id);
    assert.equal(persisted?.organizationId, e.org.id);
    assert.equal(persisted?.contentSha256, ctx.sha256(ctx.PNG));
    assert.match(persisted.sealedPhoto, /^enc:essphoto:v1:/);

    // Route-specific real denial for a selector-free self-service endpoint:
    // the SAME authenticated employee loses the actual active-employer
    // membership, then its POST is denied 403 (not a fabricated victim 404).
    await ctx.db.update(userOrganizations).set({ active: false }).where(and(
      eq(userOrganizations.userId, e.ess.id),
      eq(userOrganizations.organizationId, e.org.id),
    ));
    const denied = ctx.exact(await form(ctx, e, {
      organizationId: ctx.victim.org.id, employeeId: ctx.victim.worker.id,
    }), 403, "Revoked linked employee photo POST denied");
    ctx.noVictim(denied, ctx.victim, "Revoked employee photo");
    assert.equal((await photoRow(ctx, e))?.contentSha256, ctx.sha256(ctx.PNG),
      "denied photo upload does not change the own photo");
  }
}
