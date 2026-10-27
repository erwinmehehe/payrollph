// Fictional-only recruitment privacy request. Never approve deletion or erase candidate PII.
// The shared disposable PG16/HTTP write runner supplies two independent signed-in
// employers, a genuine higher-ID victim and immutable foreign DB/audit snapshots.
export const fixtureOrder = {};

export function createRows({ assert, db, eq, asc, jobRequisitions, jobApplicants, auditEvents, auditBusinessSnapshot }) {
  let privacySchema;
  const privacyTable = async () => (privacySchema ??= await import("../../../../src/db/schema.ts")).applicantPrivacyEvidence;
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
    {
      key: "PATCH recruitment/privacy", profile: "flagged-reads",
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
        return applicant;
      },
      state,
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
    },
  ];
}
