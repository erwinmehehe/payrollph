/**
 * POST hcm/effective-changes: every target dimension and movement type, beyond the row's own org-unit job_change.
 * No second legal entity is seeded (it would make the workspace multi-entity and change other rows); the own employer's existing entity
 * is the own target and the victim's existing entity is the foreign one. Fictional disposable rows only; every change is dated 2099 and stays pending_approval, so no worker, position or
 * assignment is ever applied. Each success uses a fresh worker (one pending change per worker), and refusals use probe
 * workers with at most four requests each (the route rate-limits sensitive requests per user and employee at five).
 * Lives outside write/ so the family loader does not treat it as a row file.
 */
let schema;
const tables = async () => (schema ??= await import("../../../../src/db/schema.ts"));

/** Called from the row's seed: own targets for each dimension plus one worker per case. */
export async function seedActionTargets({ db, addWorker }, e) {
  const s = await tables();
  const code = (name) => (e.marker + "-" + name).slice(0, 30);
  const [supervisory] = await db.insert(s.orgUnits).values({ organizationId: e.org.id, legalEntityId: e.entity.id, type: "supervisory", code: code("SUP"), name: e.marker + " supervisory" }).returning();
  const [costCenter] = await db.insert(s.costCenters).values({ organizationId: e.org.id, code: code("CC"), name: e.marker + " cost center" }).returning();
  const manager = await addWorker(e, "GM");
  const [profile] = await db.insert(s.jobProfiles).values({ organizationId: e.org.id, title: e.marker + " effective-change role" }).returning();
  const position = async (name, status) => (await db.insert(s.positions).values({ organizationId: e.org.id, code: code(name), jobProfileId: profile.id,
    orgUnitId: e.unit.id, legalEntityId: e.entity.id, status }).returning())[0];
  const vacant = await position("PV", "approved"), occupied = await position("PO", "approved"), planned = await position("PP", "planned");
  const occupant = await addWorker(e, "OC");
  await db.insert(s.positionAssignments).values({ organizationId: e.org.id, positionId: occupied.id, employeeId: occupant.id, effectiveFrom: "2026-01-05", assignmentType: "primary", createdByUserId: e.owner.id });
  const workers = {};
  const short = { type: "T", status: "S", sup: "U", cc: "C", mgr: "M", legal: "L", pos: "P", probe1: "Q1", probe2: "Q2", probe3: "Q3", probe4: "Q4" };
  for (const [name, suffix] of Object.entries(short)) workers[name] = (await addWorker(e, suffix)).id;
  return { supervisoryId: supervisory.id, costCenterId: costCenter.id, entityId: e.entity.id, managerId: manager.id, vacantId: vacant.id, occupiedId: occupied.id, plannedId: planned.id, workers };
}

export async function effectiveChangeActions({ assert, asc, auditBusinessSnapshot, db, eq }, c, { request, expectStatus, cookie }) {
  const s = await tables();
  const url = "/api/hcm/effective-changes";
  const read = (table, orgId) => db.select().from(table).where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
  const snapshot = async (orgId) => JSON.parse(JSON.stringify({
    changes: await read(s.workerEffectiveChanges, orgId), processes: await read(s.hcmBusinessProcessInstances, orgId),
    workers: await read(s.employees, orgId), positions: await read(s.positions, orgId), assignments: await read(s.positionAssignments, orgId),
    units: await read(s.orgUnits, orgId), costCenters: await read(s.costCenters, orgId), entities: await read(s.legalEntities, orgId),
    audits: auditBusinessSnapshot(await read(s.auditEvents, orgId)),
  }));
  const post = async (body, status, label) => expectStatus(await request(url, { method: "POST", cookie, body }), status, label);
  const base = (workerId, extra) => ({ organizationId: c.orgId, employeeId: workerId, effectiveDate: "2099-08-10", reason: c.marker + " fictional", ...extra });
  const victimBefore = await snapshot(c.victim.org.id);
  const t = c.seeded.extras, v = c.victimSeeded.extras;
  const refused = async (body, status, label) => {
    const own = await snapshot(c.orgId);
    const response = await post(body, status, label);
    assert.ok(!response.text.includes(c.victim.marker), label + ": a refusal leaks no victim data");
    assert.deepEqual(await snapshot(c.orgId), own, label + ": writes nothing in the own employer");
    assert.deepEqual(await snapshot(c.victim.org.id), victimBefore, label + ": leaves the victim unchanged");
  };
  const created = async (label, workerId, extra, check) => {
    const before = await snapshot(c.orgId);
    const response = await post(base(workerId, extra), 201, label);
    const after = await snapshot(c.orgId);
    for (const key of ["workers", "positions", "assignments", "units", "costCenters", "entities"]) assert.deepEqual(after[key], before[key], label + ": " + key + " is not applied");
    assert.equal(after.changes.length, before.changes.length + 1, label + ": one change row");
    const row = after.changes.find(r => !before.changes.some(old => old.id === r.id));
    assert.deepEqual(after.changes.filter(r => r.id !== row.id), before.changes);
    assert.equal(row.organizationId, c.orgId); assert.equal(row.employeeId, workerId); assert.equal(row.status, "pending_approval");
    assert.equal(row.effectiveDate, "2099-08-10"); assert.equal(row.requestedByUserId, c.owner.id); assert.equal(row.approvedByUserId, null); assert.equal(row.appliedAt, null);
    check(row);
    assert.equal(after.processes.length, before.processes.length + 1, label + ": one business process");
    const process = after.processes.find(r => !before.processes.some(old => old.id === r.id));
    assert.deepEqual(after.processes.filter(r => r.id !== process.id), before.processes);
    assert.equal(process.organizationId, c.orgId); assert.equal(process.employeeId, workerId); assert.equal(process.sourceKey, String(row.id)); assert.equal(process.initiatedByUserId, c.owner.id);
    assert.equal(response.json.businessProcess?.id, process.id); assert.equal(response.json.id, row.id);
    assert.equal(after.audits.length, before.audits.length + 1, label + ": exactly one audit receipt");
    assert.deepEqual(after.audits.slice(0, -1), before.audits);
    const audit = after.audits.at(-1);
    assert.equal(audit.organizationId, c.orgId); assert.equal(audit.actor, c.owner.name); assert.equal(audit.action, "Effective-dated HCM change requested");
    assert.equal(audit.metadata.effectiveChangeId, row.id); assert.equal(audit.metadata.employeeId, workerId); assert.equal(audit.metadata.requesterUserId, c.owner.id);
    assert.equal(audit.metadata.businessProcessInstanceId, process.id);
    assert.deepEqual(await snapshot(c.victim.org.id), victimBefore, label + ": leaves the victim unchanged");
    return row;
  };
  // Own successes, one per dimension and movement type family.
  await created("operating organization unit", c.seeded.id, { movementType: "job_change", targetOrgUnitId: c.seeded.targetUnitId },
    row => { assert.equal(row.targetOrgUnitId, c.seeded.targetUnitId); assert.deepEqual(row.toSnapshot.changes, { orgUnitId: c.seeded.targetUnitId }); });
  await created("employment type", t.workers.type, { movementType: "employment_type_change", targetEmploymentType: "Probationary" },
    row => { assert.equal(row.targetEmploymentType, "Probationary"); assert.deepEqual(row.toSnapshot.changes, { employmentType: "Probationary" }); assert.equal(row.changeType, "employment_change"); });
  await created("employee status", t.workers.status, { movementType: "status_change", targetEmployeeStatus: "On leave" },
    row => { assert.equal(row.targetEmployeeStatus, "On leave"); assert.deepEqual(row.toSnapshot.changes, { employeeStatus: "On leave" }); });
  await created("supervisory organization", t.workers.sup, { movementType: "org_change", targetSupervisoryOrgUnitId: t.supervisoryId },
    row => { assert.equal(row.targetSupervisoryOrgUnitId, t.supervisoryId); assert.deepEqual(row.toSnapshot.changes, { supervisoryOrgUnitId: t.supervisoryId }); });
  await created("cost center", t.workers.cc, { movementType: "lateral", targetCostCenterId: t.costCenterId },
    row => { assert.equal(row.targetCostCenterId, t.costCenterId); assert.deepEqual(row.toSnapshot.changes, { costCenterId: t.costCenterId }); });
  await created("manager", t.workers.mgr, { movementType: "manager_change", targetManagerEmployeeId: t.managerId },
    row => { assert.equal(row.targetManagerEmployeeId, t.managerId); assert.deepEqual(row.toSnapshot.changes, { managerEmployeeId: t.managerId }); });
  await created("legal employer", t.workers.legal, { movementType: "legal_employer_change", targetLegalEntityId: t.entityId },
    row => { assert.equal(row.targetLegalEntityId, c.entity.id); assert.deepEqual(row.toSnapshot.changes, { legalEntityId: c.entity.id }); });
  await created("position move", t.workers.pos, { movementType: "promotion", targetPositionId: t.vacantId, targetFte: 0.5 },
    row => { assert.equal(row.targetPositionId, t.vacantId); assert.equal(row.changeType, "position_change"); assert.equal(Number(row.targetFte), 0.5);
      assert.equal(row.toSnapshot.targetPosition.id, t.vacantId); assert.equal(row.toSnapshot.targetPositionPreviousStatus, "approved"); });
  // The same session naming the victim employer and its worker is denied outright.
  await refused({ ...base(c.victimSeeded.id, { movementType: "job_change", targetOrgUnitId: c.victimSeeded.targetUnitId }), organizationId: c.victim.org.id }, 403, "victim organization");
  // Foreign references named by an own-employer request are refused and nothing is written anywhere.
  await refused(base(t.workers.probe1, { movementType: "job_change", targetOrgUnitId: c.victimSeeded.targetUnitId }), 400, "victim operating organization unit");
  await refused(base(t.workers.probe1, { movementType: "org_change", targetSupervisoryOrgUnitId: v.supervisoryId }), 400, "victim supervisory organization");
  await refused(base(t.workers.probe1, { movementType: "lateral", targetCostCenterId: v.costCenterId }), 404, "victim cost center");
  await refused(base(t.workers.probe1, { movementType: "manager_change", targetManagerEmployeeId: v.managerId }), 404, "victim manager");
  await refused(base(t.workers.probe2, { movementType: "legal_employer_change", targetLegalEntityId: v.entityId }), 404, "victim legal employer");
  await refused(base(t.workers.probe2, { movementType: "promotion", targetPositionId: v.vacantId }), 404, "victim position");
  await refused(base(c.victimSeeded.id, { movementType: "job_change", targetOrgUnitId: c.seeded.targetUnitId }), 404, "victim employee under own organization id");
  // Own-employer rules that keep the same refusal shape.
  await refused(base(t.workers.probe2, { movementType: "org_change", targetOrgUnitId: t.supervisoryId }), 400, "supervisory unit is not an operating unit");
  await refused(base(t.workers.probe2, { movementType: "manager_change", targetManagerEmployeeId: t.workers.probe2 }), 400, "an employee cannot be their own manager");
  await refused(base(t.workers.probe3, { movementType: "promotion", targetPositionId: t.occupiedId }), 409, "occupied position");
  await refused(base(t.workers.probe3, { movementType: "promotion", targetPositionId: t.plannedId }), 409, "position that is not approved");
  await refused(base(t.workers.probe3, { movementType: "promotion", targetPositionId: t.vacantId, effectiveDate: "2020-01-01" }), 409, "retroactive position move");
  await refused(base(t.workers.probe3, { movementType: "unknown_move", targetEmploymentType: "Regular" }), 400, "unsupported movement type");
  await refused(base(t.workers.probe4, { movementType: "promotion", targetPositionId: t.vacantId, targetCostCenterId: t.costCenterId }), 400, "position move may not override inherited dimensions");
  return { actions: ["operating_org_unit", "employment_type", "status", "supervisory_org", "cost_center", "manager", "legal_employer", "position_move", "foreign_organization_denial", "foreign_reference_refusals", "own_rule_refusals"] };
}
