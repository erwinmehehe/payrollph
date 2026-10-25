// Fictional fixtures only. Shared runners enforce all HTTP/DB isolation controls.
// Preserve the existing fixture order; new rows may omit an order until integration.
export const fixtureOrder = {
  "GET hcm/lifecycle-readiness": 4,
  "GET hcm/business-processes/definitions": 27,
  "GET hcm/engagement-surveys": 28,
  "GET hcm/lifecycle-policy": 29,
  "GET hcm/people-operations-inbox": 45,
  "GET hcm/work-items": 46,
  "GET hcm/capabilities": 53,
  "GET hcm/effective-changes": 54,
  "GET hcm/employment-terms": 55,
  "GET hcm/employment-term-decisions": 56,
  "GET hcm/worker-profile": 72,
  "GET hcm/my-team": 74,
  "GET hcm/worker-360": 75
};

export function createRows({ addWorker, db, engagementSurveys, hcmBusinessProcessDefinitions, hcmEmploymentTermDecisions, hcmEmploymentTerms, hcmLifecyclePolicies, hcmLifecyclePolicyEvents, hcmSkills, proofs, workerEffectiveChanges }) {
  return [
  { key: "GET hcm/lifecycle-readiness",
    prove: proofs.all(proofs.echoesOrganization(), proofs.listsOwnMarker("rows", "employeeNo")) },
  { key: "GET hcm/business-processes/definitions",
    seed: (e) => db.insert(hcmBusinessProcessDefinitions).values({ organizationId: e.org.id, code: e.marker, name: e.marker,
      processType: "change_job", effectiveFrom: "2026-01-01" }),
    prove: proofs.listsOwnMarker("definitions", "name") },
  { key: "GET hcm/engagement-surveys", flags: ["ENGAGEMENT_SURVEY_ENABLED"],
    seed: (e) => db.insert(engagementSurveys).values({ organizationId: e.org.id, question: e.marker }),
    prove: proofs.listsOwnMarker("surveys", "question") },
  { key: "GET hcm/lifecycle-policy",
    seed: async (e) => {
      const [policy] = await db.insert(hcmLifecyclePolicies).values({ organizationId: e.org.id }).returning();
      await db.insert(hcmLifecyclePolicyEvents).values({ organizationId: e.org.id, policyId: policy.id, eventType: "updated",
        actorName: e.marker, toVersion: 1, afterSnapshot: {} });
    },
    prove: proofs.listsOwnMarker("history", "actorName") },
  { key: "GET hcm/people-operations-inbox", prove: proofs.listsOwnMarker("rows", "employeeNo") },
  { key: "GET hcm/work-items", prove: proofs.listsOwnMarker("owners", "name") },
  { key: "GET hcm/capabilities",
    seed: (e) => db.insert(hcmSkills).values({ organizationId: e.org.id, code: e.marker + "-CAP", name: e.marker }),
    prove: proofs.listsOwnMarker("skills", "name") },
  { key: "GET hcm/effective-changes",
    seed: async (e) => db.insert(workerEffectiveChanges).values({ organizationId: e.org.id, employeeId: (await addWorker(e, "EFF")).id,
      effectiveDate: "2026-06-01", reason: e.marker, requestedBy: e.marker }),
    prove: proofs.listsOwnMarker("changes", "reason") },
  { key: "GET hcm/employment-terms",
    seed: async (e) => db.insert(hcmEmploymentTerms).values({ organizationId: e.org.id, employeeId: (await addWorker(e, "TRM")).id,
      employmentType: "regular", termKind: "regular", effectiveFrom: "2026-01-05", reason: e.marker, requestedBy: e.marker }),
    prove: proofs.listsOwnMarker("terms", "reason") },
  { key: "GET hcm/employment-term-decisions",
    seed: async (e) => {
      const worker = await addWorker(e, "DEC");
      const [term] = await db.insert(hcmEmploymentTerms).values({ organizationId: e.org.id, employeeId: worker.id,
        employmentType: "probationary", termKind: "probationary", effectiveFrom: "2026-01-05", reason: e.marker + " term", requestedBy: e.marker }).returning();
      await db.insert(hcmEmploymentTermDecisions).values({ organizationId: e.org.id, employeeId: worker.id, employmentTermId: term.id,
        decisionKind: "continue_current", effectiveDate: "2026-07-05", reason: e.marker, requestedBy: e.marker });
    },
    prove: proofs.listsOwnMarker("decisions", "reason") },
  { key: "GET hcm/worker-profile", query: (c) => "employeeId=" + c.workerId,
    prove: proofs.all(proofs.valueHasOwnMarker("employee.employeeNo"), proofs.echoesOwn("employee.id", "workerId")) },
  { key: "GET hcm/my-team", profile: "flagged-reads", flags: ["HCM_MY_TEAM_ENABLED"], prove: proofs.listsOwnMarker("items", "name") },
  { key: "GET hcm/worker-360", profile: "flagged-reads", flags: ["HCM_WORKER_360_ENABLED"], query: (c) => "employeeId=" + c.workerId,
    prove: proofs.all(proofs.valueHasOwnMarker("worker.name"), proofs.echoesOwn("worker.id", "workerId")) },
  ];
}
