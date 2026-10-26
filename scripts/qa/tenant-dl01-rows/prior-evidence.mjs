/** DL-01 year-end prior evidence GET/POST, independent checker and encrypted DB. */
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
const evidence = marker => ({
  status: "none-confirmed", employerName: "", employerTin: "",
  periodFrom: "", periodTo: "",
  taxableIncome: "0.00", taxWithheld: "0.00", exemptBenefits: "0.00",
  sourceReference: "DL01-FICTIONAL-" + marker,
  sourceSha256: createHash("sha256").update(marker).digest("hex"),
  peraCredit: "0.00", peraReference: "", peraSha256: "",
});

export async function prepare(ctx) {
  // Same actual method for all three employers; victim source row inserted
  // after both attacker rows so it is a real higher-ID prior-evidence object.
  for (const e of ctx.all) {
    const result = ctx.exact(await ctx.request(path(e.org.id, e.worker.id), {
      method: "POST", cookie: e.operator.cookie,
      body: { action: "save", expectedDigest: "", evidence: evidence(e.marker) },
    }), 200, "DL-01 legitimate prior POST save " + e.label);
    assert.equal(result.json?.record?.saved, true);
    const [record] = await ctx.db.select().from(ctx.s.yearEndPriorEvidence)
      .where(eq(ctx.s.yearEndPriorEvidence.organizationId, e.org.id)).limit(1);
    assert.ok(record, "Prior evidence own POST must persist a real row");
    assert.equal(record.employeeId, e.worker.id);
    assert.equal(record.makerUserId, e.operator.user.id);
    assert.match(record.sourceDigest, /^[a-f0-9]{64}$/);
    assert.match(record.encryptedEvidence, /^enc:govid:v1:/);
    e.prior = record;
    ctx.noVictim(result, ctx.victim, "DL-01 own prior evidence POST");
  }
  assert.ok(ctx.victim.prior.id > 6 &&
    ctx.attackers.every(e => ctx.victim.prior.id > e.prior.id),
    "Victim-only encrypted prior evidence must have a REAL higher DB ID");
}

export async function verify(ctx) {
  const victimBefore = await victimSnapshot(ctx.victim);
  for (const e of ctx.attackers) {
    const ownPath = path(e.org.id, e.worker.id);
    const ownGet = ctx.exact(await ctx.request(ownPath, {
      cookie: e.operator.cookie,
    }), 200, "DL-01 prior GET reads actual own evidence");
    assert.equal(ownGet.json?.record?.digest, e.prior.sourceDigest);
    assert.equal(ownGet.json?.record?.evidence?.sourceReference,
      "DL01-FICTIONAL-" + e.marker);
    assert.equal(ownGet.json?.record?.approved, false);
    ctx.noVictim(ownGet, ctx.victim, "DL-01 own prior GET");

    const approve = ctx.exact(await ctx.request(ownPath, {
      method: "POST", cookie: e.checker.cookie,
      body: { action: "approve", expectedDigest: e.prior.sourceDigest },
    }), 200, "DL-01 independent checker POST approval");
    assert.equal(approve.json?.record?.saved, true);
    const [checked] = await ctx.db.select().from(ctx.s.yearEndPriorEvidence)
      .where(eq(ctx.s.yearEndPriorEvidence.id, e.prior.id)).limit(1);
    assert.equal(checked.checkerUserId, e.checker.user.id);
    assert.ok(checked.approvedAt);
    const approved = ctx.exact(await ctx.request(ownPath, {
      cookie: e.operator.cookie,
    }), 200, "DL-01 GET approved real own evidence");
    assert.equal(approved.json?.record?.approved, true);

    for (const method of ["GET", "POST"]) {
      // Victim tenant is seeded and enabled; 403 is from actual workspace scope.
      await foreignDenied(ctx, method,
        path(ctx.victim.org.id, ctx.victim.worker.id), e,
        method === "POST" ? { action: "save", expectedDigest: "", evidence: evidence("FORGED") } : undefined,
        403, "DL-01 prior " + method + " denies real victim employer");
      // Same attacker tries to pass the persisted victim worker under its own
      // authorized organization. Must reject rather than decrypt/update it.
      const forged = ctx.exact(await ctx.request(
        path(e.org.id, ctx.victim.worker.id), {
          method, cookie: e.operator.cookie,
          body: method === "POST" ?
            { action: "save", expectedDigest: "", evidence: evidence("FORGED") } : undefined,
        }), 409, "DL-01 prior " + method + " denies victim-worker reference");
      assert.equal(forged.json?.code, "PRIOR_EMPLOYEE_NOT_FOUND");
      ctx.noVictim(forged, ctx.victim, "DL-01 prior forged selector");
    }
    assert.deepEqual(await victimSnapshot(ctx.victim), victimBefore,
      "DL-01 prior GET/POST must not mutate victim encrypted data or audit");
  }
}
