// Fictional employer-scoped attendance claims; no authoritative punches are created.
export const fixtureOrder = {};
export function createRows({ assert, db }) {
  return [
    { key: "GET attendance/offline-claims",
    profile: "flagged-reads",
    flags: ["FACE_OFFLINE_PUNCH_UI_ENABLED"],
    seed: async e => {
      const { offlinePunchClaims } = await import("../../../../src/db/schema.ts");
      const [claim] = await db.insert(offlinePunchClaims).values({
        organizationId: e.org.id, employeeId: e.worker.id, submittedByUserId: e.owner.id,
        clientEventId: e.marker, claimedAt: new Date("2026-01-01T00:00:00Z"), actionType: "clock_in",
      }).returning();
      return claim;
    },
    prove: (response, ctx) => {
      assert.equal(response.json.organizationId, ctx.orgId);
      assert.ok(Array.isArray(response.json.claims));
      const claim = response.json.claims.find(item => item.id === ctx.seeded.id);
      assert.ok(claim, "own seeded claim must be present");
      assert.equal(claim.organizationId, ctx.orgId);
      assert.equal(claim.employeeId, ctx.workerId);
      assert.equal(claim.submittedByUserId, ctx.owner.id);
      assert.equal(claim.status, "pending_review");
      assert.ok(claim.employeeName.includes(ctx.marker));
    },
  }];
}
