/** DL-01 year-end prior evidence GET/POST, including independent checker. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { victimSnapshot, foreignDenied } from "../tenant-dl01-closure-shared.mjs";

export const METHODS = Object.freeze([
  "GET /api/year-end/prior-evidence",
  "POST /api/year-end/prior-evidence",
]);
const path = (org, worker) => "/api/year-end/prior-evidence?organizationId=" +
  org + "&employeeId=" + worker + "&taxYear=2025";
const evidence = (marker) => ({
  status: "none-confirmed", employerName: "", employerTin: "",
  periodFrom: "", periodTo: "",
  taxableIncome: "0.00", taxWithheld: "0.00", exemptBenefits: "0.00",
  sourceReference: "DL01-FICTIONAL-" + marker,
  sourceSha256: createHash("sha256").update(marker).digest("hex"),
  peraCredit: "0.00", peraReference: "", peraSha256: "",
});

export async function verify(ctx) {
  const victimBefore = await victimSnapshot(ctx.victim);
  for (const e of ctx.attackers) {
    const ownPath = path(e.org.id, e.worker.id);
    const ownPost = ctx.exact(await ctx.request(ownPath, {
      method: "POST", cookie: e.operator.cookie,
      body: { action: "save", expectedDigest: "", evidence: evidence(e.marker) },
    }), 200, "DL-01 prior POST own saved evidence");
    assert.deepEqual(ownPost.json, { record: { saved: true } });
    const [stored] = await ctx.db.select().from(ctx.s.yearEndPriorEvidence)
      .where(eq(ctx.s.yearEndPriorEvidence.organizationId, e.org.id)).limit(1);
    assert.ok(stored, "prior POST must persist an encrypted row");
    assert.equal(stored.employeeId, e.worker.id);
    assert.match(stored.encryptedEvidence, /^enc:govid:v1:/);
    assert.match(stored.sourceDigest, /^[a-f0-9]{64}$/);
    assert.equal(stored.makerUserId, e.operator.user.id);

    const ownGet = ctx.exact(await ctx.request(ownPath, {
      cookie: e.operator.cookie,
    }), 200, "DL-01 prior GET nonempty own evidence");
    assert.equal(ownGet.json?.record?.digest, stored.sourceDigest);
    assert.equal(ownGet.json?.record?.evidence?.sourceReference,
      "DL01-FICTIONAL-" + e.marker);
    assert.equal(ownGet.json?.record?.approved, false);
    assert.ok(!ownGet.text.includes(ctx.victim.marker));
    const approve = ctx.exact(await ctx.request(ownPath, {
      method: "POST", cookie: e.checker.cookie,
      body: { action: "approve", expectedDigest: stored.sourceDigest },
    }), 200, "DL-01 prior POST independent checker approves");
    assert.equal(approve.json?.record?.saved, true);
    const [checked] = await ctx.db.select().from(ctx.s.yearEndPriorEvidence)
      .where(eq(ctx.s.yearEndPriorEvidence.id, stored.id)).limit(1);
    assert.equal(checked.checkerUserId, e.checker.user.id);
    assert.ok(checked.approvedAt);
    const approvedRead = ctx.exact(await ctx.request(ownPath, {
      cookie: e.operator.cookie,
    }), 200, "DL-01 own evidence stays readable when approved");
    assert.equal(approvedRead.json?.record?.approved, true);

    // Both foreign employer and real foreign worker are PERSISTED. The latter
    // reaches the employee scope guard (409), not a nonexistent-ID 404.
    for (const method of ["GET", "POST"]) {
      const foreign = path(ctx.victim.org.id, ctx.victim.worker.id);
      await foreignDenied(ctx, method, foreign, e,
        method === "POST" ? { action: "save", expectedDigest: "", evidence: evidence("FORGED") } : undefined,
        403, "DL-01 prior " + method + " denies actual victim employer");
      const forged = ctx.exact(await ctx.request(
        path(e.org.id, ctx.victim.worker.id), {
          method, cookie: e.operator.cookie,
          body: method === "POST" ?
            { action: "save", expectedDigest: "", evidence: evidence("FORGED") } : undefined,
        }), 409, "DL-01 prior " + method + " rejects victim worker under own employer");
      assert.equal(forged.json?.code, "PRIOR_EMPLOYEE_NOT_FOUND");
      ctx.noVictim(forged, ctx.victim, "DL-01 forged prior evidence worker");
    }
    assert.deepEqual(await victimSnapshot(ctx.victim), victimBefore,
      "DL-01 prior GET/POST must leave victim evidence, employees and audit unchanged");
  }
}
