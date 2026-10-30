/**
 * POST hcm/business-processes/definitions: the actions the single-action table row does not prove.
 * The row proves set-active (disable). This adds save-create, save-revise and set-active (enable), which also
 * deactivates the other active definition of the same process type. Fictional employers only; every refusal must
 * leave the own employer and the victim byte-identical. Lives outside write/ so the loader skips it.
 */
let schema;
const tables = async () => (schema ??= await import("../../../../src/db/schema.ts"));

export async function definitionActions({ assert, asc, auditBusinessSnapshot, db, eq }, c, { request, expectStatus, cookie }) {
  const s = await tables();
  const url = "/api/hcm/business-processes/definitions";
  const read = (table, orgId) => db.select().from(table).where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
  const snapshot = async (orgId) => JSON.parse(JSON.stringify({
    definitions: await read(s.hcmBusinessProcessDefinitions, orgId),
    audit: auditBusinessSnapshot(await read(s.auditEvents, orgId)),
  }));
  const post = async (body, status, label) => expectStatus(await request(url, { method: "POST", cookie, body }), status, label);
  const steps = (label) => [{ type: "approval", label, assignee: "Fictional approver", dueDays: 2, priority: "High" }];
  const saveBody = (organizationId, extra) => ({ organizationId, action: "save", code: c.marker.toLowerCase() + "-saved", name: c.marker + " saved process",
    processType: "hire", effectiveFrom: "2026-02-01", steps: steps(c.marker + " first step"), ...extra });
  const victimBefore = await snapshot(c.victim.org.id);
  const refused = async (body, status, label) => {
    const own = await snapshot(c.orgId);
    const response = await post(body, status, label);
    assert.ok(!response.text.includes(c.victim.marker), label + ": a refusal leaks no victim data");
    assert.deepEqual(await snapshot(c.orgId), own, label + ": writes nothing in the own employer");
    assert.deepEqual(await snapshot(c.victim.org.id), victimBefore, label + ": leaves the victim unchanged");
  };
  const oneAudit = (before, after, action) => {
    assert.equal(after.audit.length, before.audit.length + 1, "exactly one audit receipt: " + action);
    assert.deepEqual(after.audit.slice(0, -1), before.audit, "earlier audit rows are unchanged");
    const audit = after.audit.at(-1);
    assert.equal(audit.organizationId, c.orgId);
    assert.equal(audit.actor, c.owner.name);
    assert.equal(audit.action, action);
    return audit;
  };

  // The row has just disabled the seeded definition, so nothing of type "hire" is active.
  let before = await snapshot(c.orgId);
  assert.equal(before.definitions.find((d) => d.id === c.seeded.id)?.active, false, "the row's set-active left the seeded definition disabled");
  assert.equal(before.definitions.filter((d) => d.processType === "hire" && d.active).length, 0);

  // save, create: a new active definition owned by this employer.
  const created = await post(saveBody(c.orgId), 201, "own save create");
  let after = await snapshot(c.orgId);
  assert.equal(after.definitions.length, before.definitions.length + 1, "exactly one definition is created");
  const fresh = after.definitions.at(-1);
  assert.equal(fresh.organizationId, c.orgId);
  assert.equal(fresh.code, c.marker.toLowerCase() + "-saved");
  assert.equal(fresh.version, 1);
  assert.equal(fresh.active, true);
  assert.equal(fresh.createdByUserId, c.owner.id);
  assert.equal(created.json?.id, fresh.id, "the response names the committed definition");
  assert.deepEqual(after.definitions.filter((d) => d.id !== fresh.id), before.definitions, "creating leaves the other definitions untouched");
  assert.equal(oneAudit(before, after, "HCM business process created").metadata.definitionId, fresh.id);
  await refused(saveBody(c.victim.org.id, { code: c.marker.toLowerCase() + "-foreign" }), 403, "victim employer save create");

  // save, revise: the same row gets a new version and steps; a victim definition id is refused.
  before = after;
  const revised = await post(saveBody(c.orgId, { id: fresh.id, name: c.marker + " revised process", steps: steps(c.marker + " second step") }), 200, "own save revise");
  after = await snapshot(c.orgId);
  const row = after.definitions.find((d) => d.id === fresh.id);
  assert.equal(row.version, 2, "revising bumps the version");
  assert.equal(row.name, c.marker + " revised process");
  assert.equal(row.steps[0].label, c.marker + " second step");
  assert.equal(row.organizationId, c.orgId);
  assert.equal(revised.json?.id, fresh.id);
  assert.deepEqual(after.definitions.filter((d) => d.id !== fresh.id), before.definitions.filter((d) => d.id !== fresh.id), "revising touches only the revised definition");
  assert.equal(oneAudit(before, after, "HCM business process revised").metadata.version, 2);
  await refused(saveBody(c.orgId, { id: c.victimSeeded.id, code: c.marker.toLowerCase() + "-stolen" }), 404, "forged victim definition save revise");
  await refused(saveBody(c.victim.org.id, { id: c.victimSeeded.id, code: c.marker.toLowerCase() + "-stolen" }), 403, "victim employer save revise");

  // set-active, enable: re-enabling the seeded definition deactivates the other active one of the same type.
  before = after;
  await post({ organizationId: c.orgId, action: "set-active", id: c.seeded.id, active: true }, 200, "own set-active enable");
  after = await snapshot(c.orgId);
  assert.equal(after.definitions.find((d) => d.id === c.seeded.id).active, true);
  assert.equal(after.definitions.find((d) => d.id === fresh.id).active, false, "enabling one definition disables the other of the same type");
  assert.equal(oneAudit(before, after, "HCM business process enabled").metadata.definitionId, c.seeded.id);
  await refused({ organizationId: c.orgId, action: "set-active", id: c.victimSeeded.id, active: true }, 404, "forged victim definition set-active enable");
  await refused({ organizationId: c.victim.org.id, action: "set-active", id: c.victimSeeded.id, active: true }, 403, "victim employer set-active enable");
  return { actions: ["save:create", "save:revise", "set-active:enable"], forgedReferences: 3, victimEmployerDenials: 3 };
}
