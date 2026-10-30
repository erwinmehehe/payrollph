// Fictional-only recruitment privacy: request_delete (the row), independent approve_delete and erase, on
// disposable applicants only. The erase rewrites only the fictional applicant's own row.
import { createHash, randomBytes } from "node:crypto";
// The shared disposable PG16/HTTP write runner supplies two independent signed-in
// employers, a genuine higher-ID victim and immutable foreign DB/audit snapshots.
export const fixtureOrder = {};

export function createRows({ assert, db, eq, asc, jobRequisitions, jobApplicants, auditEvents, auditBusinessSnapshot }) {
  let privacySchema;
  const schemaOf = async () => (privacySchema ??= await import("../../../../src/db/schema.ts"));
  const privacyTable = async () => (await schemaOf()).applicantPrivacyEvidence;
  const byOrg = (table, orgId) => db.select().from(table)
    .where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
  const reason = c => "Documented fictional applicant deletion request for " + c.marker;
  const state = async orgId => {
    const evidence = await privacyTable();
    const [requisitions, applicants, privacy, audit] = await Promise.all([
      byOrg(jobRequisitions, orgId), byOrg(jobApplicants, orgId),
      byOrg(evidence, orgId), byOrg(auditEvents, orgId),
    ]);
    return { requisitions, applicants, privacy, audit: auditBusinessSnapshot(audit) };
  };
  return [
    { key: "PATCH recruitment/privacy", profile: "flagged-reads",
      flags: ["APPLICANT_PRIVACY_CONTROLS_ENABLED"],
      seed: async e => {
        const [requisition] = await db.insert(jobRequisitions).values({
          organizationId: e.org.id,
          title: e.marker + " fictional privacy requisition", department: e.marker,
        }).returning();
        const [applicant] = await db.insert(jobApplicants).values({
          organizationId: e.org.id, requisitionId: requisition.id,
          fullName: e.marker + " fictional applicant",
          email: e.marker.toLowerCase() + "-privacy-write@example.invalid",
        }).returning();
        await db.insert(await privacyTable()).values({
          organizationId: e.org.id, applicantId: applicant.id,
          legalBasis: "consent", privacyNoticeVersion: "fictional-v1",
          consentCapturedAt: new Date("2026-01-01T00:00:00.000Z"),
          sourceEvidenceReference: e.marker + "-fictional-source",
        });
        // A second company-wide admin: approve_delete refuses the requester reviewing their own request.
        const { users, userOrganizations, sessions } = await schemaOf();
        const [manager] = await db.insert(users).values({ email: e.marker.toLowerCase() + "-privacy-reviewer@example.invalid",
          name: e.marker + " privacy reviewer", passwordHash: "fictional-session-only", role: "admin", totpEnabled: true }).returning();
        await db.insert(userOrganizations).values({ userId: manager.id, organizationId: e.org.id, role: "admin", active: true });
        const raw = randomBytes(32).toString("hex");
        await db.insert(sessions).values({ userId: manager.id, tokenHash: createHash("sha256").update(raw).digest("hex"),
          expiresAt: new Date(Date.now() + 3_600_000), lastSeenAt: new Date(), mfaVerifiedAt: new Date() });
        return { ...applicant, reviewerId: manager.id, reviewerName: manager.name, reviewerCookie: "__Host-linaw_session=" + raw };
      },
      state: state,
      ownBody: c => ({ organizationId: c.orgId, applicantId: c.seeded.id,
        action: "request_delete", reason: reason(c) }),
      foreignBody: c => ({ organizationId: c.victim.org.id, applicantId: c.victimSeeded.id,
        action: "request_delete", reason: reason(c) }),
      forged: { status: 404, body: c => ({ organizationId: c.orgId,
        applicantId: c.victimSeeded.id, action: "request_delete", reason: reason(c) }) },
      expect: (before, after, c, response) => {
        assert.deepEqual(after.requisitions, before.requisitions, "requisition state is unchanged");
        assert.deepEqual(after.applicants, before.applicants, "candidate PII and stage are unchanged");
        assert.equal(after.privacy.length, before.privacy.length, "no new privacy evidence rows");
        const old = before.privacy.find(p => p.applicantId === c.seeded.id);
        const updated = after.privacy.find(p => p.applicantId === c.seeded.id);
        assert.ok(old && updated, "a real own applicant and privacy row must exist");
        assert.equal(old.organizationId, c.orgId);
        assert.equal(updated.organizationId, c.orgId);
        assert.equal(updated.id, old.id);
        assert.equal(old.deletionRequestedByUserId, null);
        assert.equal(old.deletionRequestedAt, null);
        assert.equal(old.deletionReason, null);
        assert.equal(updated.deletionRequestedByUserId, c.owner.id);
        assert.ok(Number.isFinite(Date.parse(updated.deletionRequestedAt)), "persisted request time");
        assert.equal(updated.deletionReason, reason(c));
        for (const [field, value] of Object.entries(old)) {
          if (!["deletionRequestedByUserId", "deletionRequestedAt", "deletionReason"].includes(field)) {
            assert.deepEqual(updated[field], value, "privacy field must remain unchanged: " + field);
          }
        }
        assert.deepEqual(after.privacy.filter(p => p.id !== updated.id),
          before.privacy.filter(p => p.id !== old.id), "unrelated candidate privacy records unchanged");
        assert.deepEqual(response.json, { status: "requested", applicantId: c.seeded.id },
          "the HTTP response must identify only the owned candidate request");
        assert.equal(after.audit.length, before.audit.length + 1, "one new audit event");
        const added = after.audit.filter(event => !before.audit.some(previous => previous.id === event.id));
        assert.equal(added.length, 1, "exactly one new actor-bound audit event");
        assert.deepEqual(after.audit.filter(event => event.id !== added[0].id), before.audit,
          "existing audit history unchanged");
        assert.equal(added[0].organizationId, c.orgId);
        assert.equal(added[0].actor, c.owner.name);
        assert.equal(added[0].action, "Candidate PII deletion requested");
        assert.equal(added[0].resource, "Applicant #" + c.seeded.id);
        assert.deepEqual(added[0].metadata, {
          applicantId: c.seeded.id, requesterUserId: c.owner.id,
        });
      },
      exercise: async (c, { request, expectStatus, cookie }) => {
        const url = "/api/recruitment/privacy";
        const plain = async orgId => JSON.parse(JSON.stringify(await state(orgId)));
        const victimBefore = await plain(c.victim.org.id);
        const decision = (organizationId, applicantId) => ({ organizationId, applicantId, action: "approve_delete",
          approvalReason: "Independent fictional review of the deletion request for " + c.marker, reviewEvidenceReference: c.marker + "-review-evidence" });
        const erase = (organizationId, applicantId) => ({ organizationId, applicantId, action: "erase" });
        const refused = async (body, who, status, label) => {
          const own = await plain(c.orgId);
          const response = expectStatus(await request(url, { method: "PATCH", cookie: who, body }), status, label);
          assert.ok(!response.text.includes(c.victim.marker), label + ": a refusal leaks no victim data");
          assert.deepEqual(await plain(c.orgId), own, label + ": writes nothing in the own employer");
          assert.deepEqual(await plain(c.victim.org.id), victimBefore, label + ": leaves the victim unchanged");
        };
        const oneAudit = (before, after, action) => {
          assert.equal(after.audit.length, before.audit.length + 1, "exactly one audit receipt: " + action);
          assert.deepEqual(after.audit.slice(0, -1), before.audit, "earlier audit rows are unchanged");
          const audit = after.audit.at(-1);
          assert.equal(audit.organizationId, c.orgId); assert.equal(audit.action, action);
          assert.equal(audit.resource, "Applicant #" + c.seeded.id);
          return audit;
        };
        // The requester cannot review their own request, and erase is refused until an independent review exists.
        await refused(decision(c.orgId, c.seeded.id), cookie, 409, "requester self-review");
        await refused(erase(c.orgId, c.seeded.id), cookie, 409, "erase before independent review");

        // approve_delete: the second admin records the independent review.
        let before = await plain(c.orgId);
        const reviewed = expectStatus(await request(url, { method: "PATCH", cookie: c.seeded.reviewerCookie, body: decision(c.orgId, c.seeded.id) }), 200, "independent approve_delete");
        let after = await plain(c.orgId);
        assert.deepEqual(reviewed.json, { status: "reviewed", applicantId: c.seeded.id });
        const oldPrivacy = before.privacy.find(p => p.applicantId === c.seeded.id), reviewedPrivacy = after.privacy.find(p => p.applicantId === c.seeded.id);
        assert.equal(oldPrivacy.deletionReviewedByUserId, null);
        assert.equal(reviewedPrivacy.deletionReviewedByUserId, c.seeded.reviewerId, "the reviewer, not the requester, is recorded");
        assert.equal(reviewedPrivacy.deletionRequestedByUserId, c.owner.id);
        assert.equal(reviewedPrivacy.deletionReviewEvidenceReference, c.marker + "-review-evidence");
        assert.deepEqual(after.applicants, before.applicants, "review leaves the candidate's data untouched");
        assert.equal(oneAudit(before, after, "Candidate PII deletion independently reviewed").actor, c.seeded.reviewerName);
        // A victim applicant under the own employer, and the victim employer named directly, are refused.
        await refused(decision(c.orgId, c.victimSeeded.id), c.seeded.reviewerCookie, 404, "forged victim applicant approve_delete");
        await refused(decision(c.victim.org.id, c.victimSeeded.id), c.seeded.reviewerCookie, 403, "victim employer approve_delete");

        // erase: the requester erases the reviewed fictional applicant; only that applicant's row is rewritten.
        before = after;
        await refused(erase(c.orgId, c.victimSeeded.id), cookie, 404, "forged victim applicant erase");
        await refused(erase(c.victim.org.id, c.victimSeeded.id), cookie, 403, "victim employer erase");
        const erased = expectStatus(await request(url, { method: "PATCH", cookie, body: erase(c.orgId, c.seeded.id) }), 200, "own erase");
        after = await plain(c.orgId);
        assert.deepEqual(erased.json, { status: "erased", applicantId: c.seeded.id });
        const person = after.applicants.find(a => a.id === c.seeded.id);
        assert.equal(person.fullName, "Redacted applicant #" + c.seeded.id);
        assert.equal(person.email, "redacted+" + c.seeded.id + "@deleted.invalid");
        assert.equal(person.stage, "rejected");
        const purged = after.privacy.find(p => p.applicantId === c.seeded.id);
        assert.ok(purged.purgedAt, "the privacy record is marked purged");
        assert.equal(purged.purgedByUserId, c.owner.id);
        assert.deepEqual(after.applicants.filter(a => a.id !== c.seeded.id), before.applicants.filter(a => a.id !== c.seeded.id), "no other applicant changes");
        assert.deepEqual(after.requisitions, before.requisitions);
        assert.equal(oneAudit(before, after, "Candidate PII erasure applied after independent review").actor, c.owner.name);
        await refused(erase(c.orgId, c.seeded.id), cookie, 409, "second erase of the same applicant");
        return { actions: ["approve_delete", "erase"], forgedReferences: 2, victimEmployerDenials: 2, selfReviewRefused: true };
      },
    },
  ];
}
