import { eq, asc } from "drizzle-orm";

// Factory import must remain source-only under plain Node test discovery.
// Application/DB modules are loaded only when the disposable PG16 proof actually
// executes a fixture, never when catalog tests inspect the row contract.
let runtimePromise;
function runtime() {
  return runtimePromise ??= Promise.all([
    import("../../../../src/db/index.ts"),
    import("../../../../src/db/schema.ts"),
    import("../../../../src/lib/hcm-business-process.ts"),
    import("../../../../src/lib/hcm-effective-corrections.ts"),
  ]).then(([database, schema, process, corrections]) => ({
    db: database.db, schema,
    startHcmBusinessProcessTx: process.startHcmBusinessProcessTx,
    returnEffectiveChangeForCorrection: corrections.returnEffectiveChangeForCorrection,
  }));
}
export const fixtureOrder = {};
export function createRows({ assert, auditBusinessSnapshot, addWorker }) {
  const state = async orgId => {
    const { db, schema: t } = await runtime();
    const tables = { changes: t.workerEffectiveChanges, processes: t.hcmBusinessProcessInstances,
      steps: t.hcmBusinessProcessInstanceSteps, tasks: t.approvalTasks, workers: t.employees,
      events: t.workerEmploymentEvents, profiles: t.employeePayProfiles, audits: t.auditEvents };
    const out = {};
    for (const [name, table] of Object.entries(tables)) out[name] = await db.select().from(table).where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
    out.audits = auditBusinessSnapshot(out.audits); return out;
  };
  const seed = async (e, returned) => {
    const { db, schema, startHcmBusinessProcessTx, returnEffectiveChangeForCorrection } = await runtime();
    const { users, userOrganizations, workerEffectiveChanges, hcmBusinessProcessDefinitions } = schema;
    const worker = await addWorker(e, returned ? "cres" : "cret");
    const [other] = await db.insert(users).values({ email: (e.marker + (returned ? "-checker" : "-maker")).toLowerCase() + "@example.invalid",
      name: e.marker + " independent", passwordHash: "fictional-no-login", role: "owner", totpEnabled: true }).returning();
    await db.insert(userOrganizations).values({ organizationId: e.org.id, userId: other.id, role: "owner" });
    const maker = returned ? e.owner : other;
    const fromSnapshot = { employee: Object.fromEntries(["orgUnitId", "legalEntityId", "title", "employmentType", "status"].map(k => [k, worker[k]])), assignment: null, position: null };
    const [change] = await db.insert(workerEffectiveChanges).values({ organizationId: e.org.id, employeeId: worker.id,
      movementType: "employment_type_change", changeType: "employment_change", effectiveDate: "2099-01-01",
      reason: e.marker, requestedByUserId: maker.id, requestedBy: maker.name,
      targetEmploymentType: "Probationary", fromSnapshot, toSnapshot: { changes: { employmentType: "Probationary" }, targetPosition: null } }).returning();
    // An unrelated read-table fixture intentionally seeds an unvalidated 2026
    // definition (steps=[]). Do not change that historical frozen fixture.
    // Instead use a later, explicit fictional policy for this 2099 scenario.
    // The real process engine validates all step fields before creating a task.
    await db.insert(hcmBusinessProcessDefinitions).values({
      organizationId: e.org.id,
      code: (e.marker + (returned ? "-corr-resubmit" : "-corr-return")).slice(0, 64),
      name: e.marker + " fictional independent correction approval",
      processType: "change_job", effectiveFrom: "2098-01-01", active: true,
      steps: [{ type: "approval", label: "Independent correction review",
        assignee: "role:owner", dueDays: 1, priority: "High" }],
    });
    const process = await db.transaction(tx => startHcmBusinessProcessTx(tx, { organizationId: e.org.id, sourceType: "worker_effective_change",
      sourceKey: String(change.id), processType: "change_job", employeeId: worker.id, employeeLabel: e.marker,
      effectiveDate: change.effectiveDate, initiatedByUserId: maker.id, initiatedByName: maker.name }));
    if (returned) await returnEffectiveChangeForCorrection({ organizationId: e.org.id, changeId: change.id, userId: other.id, name: other.name, note: "Please correct the fictional effective date." });
    return { id: change.id, processId: process.id, makerId: maker.id, workerId: worker.id };
  };
  const unchanged = (before, after) => { for (const key of ["workers", "events", "profiles"]) assert.deepEqual(after[key], before[key], key); };
  return [
    { key: "POST hcm/effective-change-corrections/return", seed: e => seed(e, false), state: state,
      ownBody: c => ({ organizationId: c.orgId, changeId: c.seeded.id, note: "Correct the requested date: " + c.marker }),
      foreignBody: c => ({ organizationId: c.victim.org.id, changeId: c.victimSeeded.id, note: "Forbidden request " + c.marker }),
      forged: { status: 409, body: c => ({ organizationId: c.orgId, changeId: c.victimSeeded.id, note: "Forbidden forged request " + c.marker }) },
      expect: (before, after, c, response) => {
        unchanged(before, after);
        const old = before.changes.find(r => r.id === c.seeded.id), row = after.changes.find(r => r.id === c.seeded.id);
        assert.ok(old && row); assert.equal(row.organizationId, c.orgId); assert.equal(row.employeeId, c.seeded.workerId);
        assert.equal(old.status, "pending_approval"); assert.equal(row.status, "returned_for_correction");
        assert.deepEqual(after.changes.filter(r => r.id !== row.id), before.changes.filter(r => r.id !== row.id));
        assert.equal(row.requestedByUserId, c.seeded.makerId); assert.deepEqual(row.fromSnapshot, old.fromSnapshot); assert.deepEqual(row.toSnapshot, old.toSnapshot);
        assert.equal(row.approvedByUserId, null); assert.equal(row.appliedAt, null);
        const process = after.processes.find(r => r.id === c.seeded.processId); assert.ok(process);
        assert.equal(process.status, "cancelled"); assert.equal(process.organizationId, c.orgId);
        assert.deepEqual(after.processes.filter(r => r.id !== process.id), before.processes.filter(r => r.id !== process.id));
        assert.deepEqual(after.steps.filter(r => r.instanceId !== process.id), before.steps.filter(r => r.instanceId !== process.id));
        assert.ok(after.steps.filter(r => r.instanceId === process.id).every(r => r.status === "cancelled"));
        const taskIds = after.steps.filter(r => r.instanceId === process.id).map(r => r.approvalTaskId).filter(Boolean);
        assert.ok(taskIds.length > 0); assert.ok(after.tasks.filter(r => taskIds.includes(r.id)).every(r => r.status === "Cancelled"));
        assert.deepEqual(after.tasks.filter(r => !taskIds.includes(r.id)), before.tasks.filter(r => !taskIds.includes(r.id)));
        assert.equal(after.audits.length, before.audits.length + 1);
        assert.deepEqual(after.audits.filter(r => before.audits.some(old => old.id === r.id)), before.audits);
        const event = after.audits.find(r => !before.audits.some(b => b.id === r.id));
        assert.equal(event.action, "HCM change returned for correction"); assert.equal(event.metadata.effectiveChangeId, row.id);
        assert.equal(event.metadata.actorUserId, c.owner.id); assert.ok(event.metadata.note.includes(c.marker));
        assert.deepEqual(response.json.change, row);
      } },
    { key: "POST hcm/effective-change-corrections/resubmit", status: 201, seed: e => seed(e, true), state: state,
      ownBody: c => ({ organizationId: c.orgId, changeId: c.seeded.id, reason: "Corrected reason " + c.marker, effectiveDate: "2099-01-02" }),
      foreignBody: c => ({ organizationId: c.victim.org.id, changeId: c.victimSeeded.id, reason: "Forbidden correction " + c.marker, effectiveDate: "2099-01-02" }),
      forged: { status: 409, body: c => ({ organizationId: c.orgId, changeId: c.victimSeeded.id, reason: "Forbidden forged correction " + c.marker, effectiveDate: "2099-01-02" }) },
      expect: (before, after, c, response) => {
        unchanged(before, after); assert.equal(after.changes.length, before.changes.length + 1);
        const row = after.changes.find(r => !before.changes.some(b => b.id === r.id)); assert.ok(row);
        assert.equal(row.organizationId, c.orgId); assert.equal(row.employeeId, c.seeded.workerId); assert.equal(row.requestedByUserId, c.owner.id);
        assert.equal(row.status, "pending_approval"); assert.equal(row.reason, "Corrected reason " + c.marker); assert.equal(row.effectiveDate, "2099-01-02");
        assert.equal(row.toSnapshot.correctionOfChangeId, c.seeded.id);
        assert.equal(row.approvedByUserId, null); assert.equal(row.appliedAt, null);
        assert.deepEqual(after.changes.filter(r => r.id !== row.id), before.changes);
        assert.equal(after.processes.length, before.processes.length + 1);
        const process = after.processes.find(r => !before.processes.some(b => b.id === r.id)); assert.ok(process);
        assert.equal(process.organizationId, c.orgId); assert.equal(process.sourceKey, String(row.id)); assert.equal(process.status, "in_progress"); assert.equal(process.currentStepIndex, 0);
        assert.equal(process.initiatedByUserId, c.owner.id);
        assert.equal(process.definitionSnapshot.sourceEvidence.previousChangeId, c.seeded.id);
        assert.equal(process.definitionSnapshot.sourceEvidence.previousProcessId, c.seeded.processId);
        assert.deepEqual(after.processes.filter(r => r.id !== process.id), before.processes);
        assert.deepEqual(after.steps.filter(r => r.instanceId !== process.id), before.steps);
        assert.deepEqual(after.tasks.filter(r => before.tasks.some(old => old.id === r.id)), before.tasks);
        const freshSteps = after.steps.filter(r => r.instanceId === process.id);
        assert.equal(freshSteps[0].status, "pending"); assert.ok(freshSteps.every(r => r.completedAt === null));
        assert.ok(!before.tasks.some(task => task.id === freshSteps[0].approvalTaskId));
        const freshTask = after.tasks.find(task => task.id === freshSteps[0].approvalTaskId); assert.ok(freshTask);
        assert.equal(freshTask.organizationId, c.orgId); assert.equal(freshTask.status, "Pending"); assert.equal(freshTask.approver, freshSteps[0].assignee);
        assert.equal(after.audits.length, before.audits.length + 1);
        assert.deepEqual(after.audits.filter(r => before.audits.some(old => old.id === r.id)), before.audits);
        const event = after.audits.find(r => !before.audits.some(b => b.id === r.id)); assert.equal(event.action, "HCM corrected change resubmitted");
        assert.equal(event.metadata.previousChangeId, c.seeded.id); assert.equal(event.metadata.effectiveChangeId, row.id);
        assert.deepEqual(response.json.change, row); assert.equal(response.json.businessProcess.id, process.id);
      } },
  ];
}
