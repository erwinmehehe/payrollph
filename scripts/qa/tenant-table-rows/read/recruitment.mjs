// Fictional fixtures only. Shared runners enforce all HTTP/DB isolation controls.
// Preserve the existing fixture order; new rows may omit an order until integration.
export const fixtureOrder = {
  "GET recruitment": 61,
  "GET recruitment/privacy": 76
};

export function createRows({ applicantPrivacyEvidence, db, jobApplicants, jobRequisitions, proofs }) {
  return [
  { key: "GET recruitment",
    seed: async (e) => {
      const [requisition] = await db.insert(jobRequisitions).values({ organizationId: e.org.id, title: e.marker, department: e.marker }).returning();
      await db.insert(jobApplicants).values({ requisitionId: requisition.id, organizationId: e.org.id, fullName: e.marker, email: e.marker + "@example.invalid" });
    },
    prove: proofs.all(proofs.listsOwnMarker("requisitions", "title"), proofs.listsOwnMarker("applicants", "fullName")) },
  { key: "GET recruitment/privacy", profile: "flagged-reads", flags: ["APPLICANT_PRIVACY_CONTROLS_ENABLED"], query: (c) => "applicantId=" + c.seeded.id,
    seed: async (e) => {
      const [requisition] = await db.insert(jobRequisitions).values({ organizationId: e.org.id, title: e.marker + " privacy", department: e.marker }).returning();
      const [applicant] = await db.insert(jobApplicants).values({ requisitionId: requisition.id, organizationId: e.org.id,
        fullName: e.marker + " applicant", email: e.marker + "-privacy@example.invalid" }).returning();
      await db.insert(applicantPrivacyEvidence).values({ organizationId: e.org.id, applicantId: applicant.id, legalBasis: "consent",
        privacyNoticeVersion: "fictional-v1", consentCapturedAt: new Date(), sourceEvidenceReference: e.marker });
      return applicant;
    },
    prove: proofs.all(proofs.valueHasOwnMarker("applicant.fullName"), proofs.echoesOwn("applicant.organizationId", "orgId")) },
  ];
}
