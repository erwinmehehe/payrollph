// One independent HCM manager-attestation read GAP; fictional rows only.
// Shared PG16/localhost HTTP runner seeds two authenticated attackers and a
// real higher-ID victim. No decision approval, term change, or POST is exercised.
export const fixtureOrder = {};

export function createRows({ assert, db, addWorker, rowTables }) {
  let schema;
  const tables = async () => rowTables ?? (schema ??= await import("../../../../src/db/schema.ts"));
  return [
    {
      key: "GET hcm/employment-term-decisions/[id]/manager-attestation",
      pathIds: { id: "id" },
      seed: async employer => {
        const { jobProfiles, positions, positionAssignments,
          hcmEmploymentTerms, hcmEmploymentTermDecisions,
          hcmEmploymentDecisionManagerAttestations } = await tables();
        const worker = await addWorker(employer, "ATWORK", { payProfile: false });
        const manager = await addWorker(employer, "ATMAN", { payProfile: false });
        const [job] = await db.insert(jobProfiles).values({
          organizationId: employer.org.id,
          title: employer.marker + " fictional attestation position",
        }).returning();
        const code = (employer.marker + "-ATT").slice(0, 48);
        const [position] = await db.insert(positions).values({
          organizationId: employer.org.id, jobProfileId: job.id,
          orgUnitId: employer.unit.id, legalEntityId: employer.entity.id,
          managerEmployeeId: manager.id, code,
        }).returning();
        const [assignment] = await db.insert(positionAssignments).values({
          organizationId: employer.org.id, positionId: position.id,
          employeeId: worker.id, assignmentType: "primary",
          effectiveFrom: "2026-01-05", effectiveUntil: null,
          createdByUserId: employer.owner.id,
        }).returning();
        const [term] = await db.insert(hcmEmploymentTerms).values({
          organizationId: employer.org.id, employeeId: worker.id,
          employmentType: "probationary", termKind: "probationary",
          effectiveFrom: "2026-01-05", status: "active",
          reason: employer.marker + " fictional existing term",
          requestedByUserId: employer.owner.id, requestedBy: employer.owner.name,
        }).returning();
        const [decision] = await db.insert(hcmEmploymentTermDecisions).values({
          organizationId: employer.org.id, employeeId: worker.id,
          employmentTermId: term.id, decisionKind: "continue_current",
          effectiveDate: "2026-11-01", status: "pending_approval",
          reason: employer.marker + " fictional pending employment review",
          requestedByUserId: employer.owner.id, requestedBy: employer.owner.name,
        }).returning();
        const managerName = "Table " + employer.marker + "-ATMAN";
        const statement = employer.marker + " fictional manager attestation; no approval or action";
        const reportingLineSnapshot = {
          workerPositionAssignmentId: assignment.id,
          workerPositionId: position.id, workerPositionCode: code,
          assignmentEffectiveFrom: "2026-01-05", managerEmployeeId: manager.id,
        };
        const [attestation] = await db.insert(hcmEmploymentDecisionManagerAttestations).values({
          organizationId: employer.org.id, decisionId: decision.id,
          employeeId: worker.id, workerPositionAssignmentId: assignment.id,
          workerPositionId: position.id, managerEmployeeId: manager.id,
          managerUserId: null, managerName,
          recommendation: "needs_more_review", statement, reportingLineSnapshot,
        }).returning();
        for (const [label, id] of Object.entries({
          decision: decision.id, attestation: attestation.id, position: position.id,
          assignment: assignment.id, worker: worker.id, manager: manager.id,
        })) assert.ok(Number.isSafeInteger(id) && id > 0, label + " must be persisted");
        return {
          id: decision.id, attestationId: attestation.id,
          workerId: worker.id, managerId: manager.id,
          managerNo: employer.marker + "-ATMAN", managerName,
          statement, positionId: position.id, assignmentId: assignment.id,
          reportingLineSnapshot,
        };
      },
      prove: (response, c) => {
        const body = response.json;
        assert.ok(body && typeof body === "object" && !Array.isArray(body));
        assert.deepEqual(Object.keys(body).sort(), [
          "attestations", "canAttest", "currentManager",
        ].sort(), "no unrelated employee/decision data may be returned");
        assert.equal(body.canAttest, false,
          "an HR owner without the manager employee identity cannot attest");
        const manager = body.currentManager;
        assert.ok(manager && typeof manager === "object");
        assert.deepEqual(Object.keys(manager).sort(), [
          "employeeId", "employeeNo", "name", "title",
        ].sort());
        assert.equal(manager.employeeId, c.seeded.managerId);
        assert.equal(manager.employeeNo, c.seeded.managerNo);
        assert.equal(manager.name, c.seeded.managerName);
        assert.equal(manager.title, "Fictional");
        assert.ok(Array.isArray(body.attestations) && body.attestations.length === 1,
          "a real persisted, own-employer manager attestation must be returned");
        const row = body.attestations[0];
        assert.deepEqual(Object.keys(row).sort(), [
          "id", "organizationId", "decisionId", "employeeId",
          "workerPositionAssignmentId", "workerPositionId",
          "managerEmployeeId", "managerUserId", "managerName",
          "recommendation", "statement", "reportingLineSnapshot", "createdAt",
        ].sort(), "only expected attestation fields may appear");
        assert.equal(row.id, c.seeded.attestationId);
        assert.equal(row.organizationId, c.orgId);
        assert.equal(row.decisionId, c.seeded.id);
        assert.equal(row.employeeId, c.seeded.workerId);
        assert.equal(row.workerPositionAssignmentId, c.seeded.assignmentId);
        assert.equal(row.workerPositionId, c.seeded.positionId);
        assert.equal(row.managerEmployeeId, c.seeded.managerId);
        assert.equal(row.managerUserId, null);
        assert.equal(row.managerName, c.seeded.managerName);
        assert.equal(row.recommendation, "needs_more_review");
        assert.equal(row.statement, c.seeded.statement);
        assert.deepEqual(row.reportingLineSnapshot, c.seeded.reportingLineSnapshot);
        assert.match(row.createdAt, /^\d{4}-\d{2}-\d{2}T/);
        assert.ok(!response.text.includes(c.victim.marker),
          "neither the victim's reporting line nor its statement may leak");
      },
    },
  ];
}
