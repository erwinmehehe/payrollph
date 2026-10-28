/**
 * Fictional PostgreSQL 16 + production-mode localhost HTTP evidence candidate.
 * GET /api/self/probation-reviews and POST /api/self/probation-reviews only.
 *
 * NEVER connects to a live tenant, moves money, awards coverage credits or
 * changes a production flag. The environment gate runs before DB imports.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ENDPOINT, requireDisposableProbation, assertNoPrivateMarkers,
  assertOwnReview, assertOwnAcknowledgment, assertPrivateDenial,
  assertUnchanged, assertOnlyOwnWrite,
} from "./tenant-self-probation-contract.mjs";

export async function proveProbationIsolation() {
  requireDisposableProbation();
  const [{ db, pool }, s, t, { eq, asc }, { auditBusinessSnapshot }] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("./tenant-table-http.mjs"),
    import("drizzle-orm"),
    import("./tenant-table-invariants.mjs"),
  ]);
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const orgRows = (table, orgId) => db.select().from(table)
    .where(eq(table.organizationId, orgId)).orderBy(asc(table.id));

  async function snapshot(orgId) {
    const [employees, memberships, terms, reviews, acks, events, audit, payroll] = await Promise.all([
      orgRows(s.employees, orgId), orgRows(s.userOrganizations, orgId),
      orgRows(s.hcmEmploymentTerms, orgId), orgRows(s.hcmProbationReviews, orgId),
      orgRows(s.hcmProbationReviewAcknowledgments, orgId),
      orgRows(s.hcmProbationReviewEvents, orgId), orgRows(s.auditEvents, orgId),
      orgRows(s.payrollRuns, orgId),
    ]);
    return { employees, memberships, terms, reviews, acks, events,
      audit: auditBusinessSnapshot(audit), payroll };
  }

  async function createLogin(org, worker, marker) {
    const name = marker + " fictional ESS worker";
    const [user] = await db.insert(s.users).values({
      name, email: marker.toLowerCase() + "@example.invalid",
      role: "employee", employeeId: worker.id,
      passwordHash: "fictional-ci-only-not-a-real-password",
      active: true, totpEnabled: true,
    }).returning();
    const [member] = await db.insert(s.userOrganizations).values({
      userId: user.id, organizationId: org.id, role: "employee",
      workerEmployeeId: worker.id, active: true,
    }).returning();
    const session = await t.standaloneMakeSession(user.id);
    await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(s.sessions.id, session.id));
    return { userId: user.id, name, memberId: member.id, cookie: session.cookie };
  }

  async function createSubmittedReview(employer, worker, suffix) {
    const marker = employer.marker + suffix;
    const [term] = await db.insert(s.hcmEmploymentTerms).values({
      organizationId: employer.org.id, employeeId: worker.id,
      employmentType: "Probationary", termKind: "probationary",
      effectiveFrom: "2026-01-05", status: "active",
      reason: marker + " fictional employment term",
      requestedByUserId: employer.owner.id, requestedBy: employer.owner.name,
    }).returning();
    const [review] = await db.insert(s.hcmProbationReviews).values({
      organizationId: employer.org.id, employeeId: worker.id,
      employmentTermId: term.id, status: "submitted",
      recommendation: "needs_hr_review",
      overallRating: 3, roleExpectationsRating: 3,
      workQualityRating: 4, reliabilityRating: 3,
      conductCollaborationRating: 4,
      summary: marker + " PRIVATE submitted probation review",
      strengths: marker + " PRIVATE review strengths",
      developmentAreas: marker + " PRIVATE review development notes",
      reviewerUserId: employer.owner.id, reviewerName: employer.owner.name,
      submittedAt: new Date(),
    }).returning();
    assert.equal(review.organizationId, employer.org.id);
    assert.equal(review.employeeId, worker.id);
    assert.equal(review.employmentTermId, term.id);
    return { term, review };
  }

  async function seedEmployer(label) {
    const e = await t.seedEmployer(label, nonce, t.standaloneMakeSession);
    const self = await createLogin(e.org, e.worker, e.marker + "-SELF");
    const { term, review } = await createSubmittedReview(e, e.worker, "");
    const peerWorker = await t.addWorker(e, "PEER", { payProfile: false });
    const peerSelf = await createLogin(e.org, peerWorker, e.marker + "-PEER-SELF");
    const peerReview = await createSubmittedReview(e, peerWorker, "-PEER");
    return { ...e, self, term, review,
      peer: { worker: peerWorker, self: peerSelf, ...peerReview } };
  }

  async function forgeVictimLink(attacker, victim) {
    const [forged] = await db.insert(s.users).values({
      email: attacker.marker.toLowerCase() + "-forged@example.invalid",
      name: attacker.marker + " forged victim link",
      role: "employee", employeeId: victim.worker.id,
      passwordHash: "fictional-never-login",
      active: true, totpEnabled: true,
    }).returning();
    // Membership in A/B ONLY. A copied users.employeeId is not authorization
    // to read the real higher-ID victim's actual submitted HR review.
    await db.insert(s.userOrganizations).values({
      userId: forged.id, organizationId: attacker.org.id, role: "employee",
      active: true,
    });
    const session = await t.standaloneMakeSession(forged.id);
    await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(s.sessions.id, session.id));
    return session.cookie;
  }

  try {
    assert.equal((await db.select({ id: s.organizations.id })
      .from(s.organizations).limit(1)).length, 0,
    "PROBATION_TENANT_REFUSED: only a truly empty disposable PostgreSQL database is allowed");

    // A and B (including each peer) are genuinely persisted before the
    // higher-ID victim. No invented resource IDs, reused cookies or mock fetch.
    const a = await seedEmployer("ATTA");
    const b = await seedEmployer("ATTB");
    const victim = await seedEmployer("VICTIM");
    const attackers = [a, b];
    for (const attacker of attackers) {
      assert.ok(victim.org.id > attacker.org.id);
      assert.ok(victim.worker.id > attacker.peer.worker.id);
      assert.ok(victim.term.id > attacker.peer.term.id);
      assert.ok(victim.review.id > attacker.peer.review.id);
      assert.notEqual(attacker.self.cookie, victim.self.cookie);
      assert.notEqual(attacker.self.cookie, attacker.peer.self.cookie);
    }
    assert.notEqual(a.self.cookie, b.self.cookie);

    const forgedCookies = await Promise.all(attackers.map(x => forgeVictimLink(x, victim)));
    const protectedVictim = await snapshot(victim.org.id);
    const coreVictim = await t.victimSnapshot(victim.org.id);
    assert.equal(protectedVictim.reviews.length, 2);
    assert.equal(protectedVictim.acks.length, 0);
    assert.equal(protectedVictim.payroll.length, 0);

    async function read(actor, path = ENDPOINT, cookie = actor.self.cookie, withAck = false) {
      const response = await t.standaloneRequest(path, { cookie });
      assertOwnReview(response, actor,
        [victim.marker === actor.marker ? "" : victim.marker, actor.marker + "-PEER PRIVATE"],
        withAck);
      return response;
    }
    async function unchangedVictim(label) {
      assertUnchanged(protectedVictim, await snapshot(victim.org.id), label + ": victim HR source");
      assertUnchanged(coreVictim, await t.victimSnapshot(victim.org.id),
        label + ": victim core, payroll and audit source");
    }

    await read(victim, ENDPOINT, victim.self.cookie);
    for (const actor of attackers) {
      await read(actor);
      const peerResult = await t.standaloneRequest(ENDPOINT,
        { cookie: actor.peer.self.cookie });
      assert.equal(peerResult.status, 200);
      assert.equal(peerResult.json.reviews.length, 1);
      assert.equal(peerResult.json.reviews[0].review.id, actor.peer.review.id);
      assertNoPrivateMarkers(peerResult, [actor.marker + " PRIVATE", victim.marker]);
      // Forged query selectors must not redirect this session-derived GET.
      await read(actor, ENDPOINT + "?organizationId=" + victim.org.id +
        "&employeeId=" + victim.worker.id + "&reviewId=" + victim.review.id);
      await unchangedVictim(actor.label + " own and forged selector GET");
    }

    // Two genuinely independent POST positives. Their exact new DB rows,
    // event source, actor identity and audit must match the HTTP receipt.
    for (const actor of attackers) {
      const before = await snapshot(actor.org.id);
      const other = actor === a ? b : a;
      const otherBefore = await snapshot(other.org.id);
      const body = { reviewId: actor.review.id,
        employeeComment: actor.marker + " acknowledged this fictional review" };
      const response = await t.standaloneRequest(ENDPOINT, {
        method: "POST", cookie: actor.self.cookie, body,
      });
      const posted = assertOwnAcknowledgment(response, actor);
      assertNoPrivateMarkers(response, [victim.marker, actor.marker + "-PEER PRIVATE"]);
      assertOnlyOwnWrite(before, await snapshot(actor.org.id), actor, posted);
      assertUnchanged(otherBefore, await snapshot(other.org.id),
        "own acknowledgment cannot mutate another attacker employer");
      await unchangedVictim("own POST " + actor.label);
      await read(actor, ENDPOINT, actor.self.cookie, true);
    }

    const stable = new Map(await Promise.all([a, b, victim].map(
      async actor => [actor.org.id, await snapshot(actor.org.id)])));
    const stableCore = await t.victimSnapshot(victim.org.id);
    async function checkStable(label) {
      for (const actor of [a, b, victim]) {
        assertUnchanged(stable.get(actor.org.id), await snapshot(actor.org.id),
          label + ": untouched " + actor.label);
      }
      assertUnchanged(stableCore, await t.victimSnapshot(victim.org.id),
        label + ": untouched extended victim source");
    }
    async function denied(label, options, status, markers) {
      const response = await t.standaloneRequest(ENDPOINT, options);
      assertPrivateDenial(response, status, markers);
      await checkStable(label);
    }
    for (const actor of attackers) {
      const other = actor === a ? b : a;
      const markers = [victim.marker, other.marker + " PRIVATE", actor.marker + "-PEER PRIVATE"];
      await denied(actor.label + " foreign-victim POST", {
        method: "POST", cookie: actor.self.cookie,
        body: { reviewId: victim.review.id, organizationId: victim.org.id,
          employeeId: victim.worker.id, employeeComment: "attempt stolen review" },
      }, 404, markers);
      await denied(actor.label + " other-attacker POST", {
        method: "POST", cookie: actor.self.cookie,
        body: { reviewId: other.review.id, employeeComment: "attempt unrelated review" },
      }, 404, markers);
      await denied(actor.label + " same-employer peer POST", {
        method: "POST", cookie: actor.self.cookie,
        body: { reviewId: actor.peer.review.id, employeeId: actor.peer.worker.id,
          employeeComment: "attempt peer review" },
      }, 404, markers);
      await denied(actor.label + " repeated own POST", {
        method: "POST", cookie: actor.self.cookie,
        body: { reviewId: actor.review.id, employeeComment: "duplicate" },
      }, 409, markers);
      await denied(actor.label + " invalid ID POST", {
        method: "POST", cookie: actor.self.cookie,
        body: { reviewId: "not-a-review", employeeComment: "invalid" },
      }, 400, markers);
      await denied(actor.label + " owner GET", { cookie: actor.cookie }, 403, markers);
      await denied(actor.label + " owner POST", {
        cookie: actor.cookie, method: "POST", body: { reviewId: actor.review.id },
      }, 403, markers);
    }
    for (let i = 0; i < attackers.length; i++) {
      const actor = attackers[i];
      await denied(actor.label + " forged victim employeeId GET",
        { cookie: forgedCookies[i] }, 403, [victim.marker]);
      await denied(actor.label + " forged victim employeeId POST", {
        method: "POST", cookie: forgedCookies[i],
        body: { reviewId: victim.review.id },
      }, 403, [victim.marker]);
    }
    await denied("anonymous GET", {}, 401, [victim.marker]);
    await denied("anonymous POST",
      { method: "POST", body: { reviewId: victim.review.id } }, 401, [victim.marker]);
    console.log("FICTIONAL_PG16_HTTP_PROBATION: two actual own GET/POST writes, " +
      "peer and foreign denials, forged victim identity and unchanged protected HR/payroll/audit verified; " +
      "zero coverage credits, no live employers");
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].replaceAll("\\", "/")
  .endsWith("scripts/qa/tenant-self-probation-http.mjs")) {
  proveProbationIsolation().catch(error => {
    console.error("FICTIONAL_PG16_HTTP_PROBATION_FAIL:", error.message);
    process.exitCode = 1;
  });
}