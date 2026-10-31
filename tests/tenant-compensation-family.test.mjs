import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRows } from "../scripts/qa/tenant-table-rows/write/compensation.mjs";
import { tenantFamilyCatalog } from "../scripts/qa/tenant-table-catalog.mjs";

const rows = createRows({ assert });
const c = { orgId: 11, workerId: 21, owner: { id: 31, name: "Fictional owner" }, marker: "Fictional-own",
  seeded: { id: 41, bandId: 51, cycleId: 61 }, victim: { org: { id: 99 } }, victimSeeded: { id: 101 } };
function evidence(key) {
  const before = {
    components: [{ id: 1, organizationId: 11, name: "Existing component" }],
    proposals: [{ id: 41, organizationId: 11, employeeId: 21, bandId: 51, cycleId: 61, currentAnnual: "240000.00", proposedAnnual: "252000.00",
      reason: c.marker + " fictional refusal", status: "proposed", approvedByUserId: null, approvedAt: null, scheduledAt: null, appliedAt: null, appliedPayRevisionId: null }],
    payProfiles: [{ id: 71, organizationId: 11, employeeId: 21, rateAmount: "20000.00" }],
    bands: [{ id: 51 }], cycles: [{ id: 61 }], assignments: [{ id: 81 }], events: [{ id: 82 }], revisions: [{ id: 83 }], runs: [{ id: 84 }], workers: [{ id: 21 }], reviews: [{ id: 85 }],
    audits: [{ id: 2, organizationId: 11, actor: "Earlier actor", action: "Earlier audit", metadata: { retained: true } }],
  };
  const after = structuredClone(before);
  let payload, event;
  if (key === "POST compensation") {
    payload = { id: 91, organizationId: 11, createdByUserId: 31, code: "FICTIONAL-OWN-COMP", name: c.marker + " component",
      kind: "allowance", amountFrequency: "monthly", active: true, taxable: true, includeInSssBase: true, includeInPagIbigBase: true };
    after.components.push(payload);
    event = { action: "Compensation component created", resource: payload.name, metadata: { componentId: 91, code: payload.code, kind: "allowance", amountFrequency: "monthly" } };
  } else {
    payload = { ...after.proposals[0], status: "declined", approvedByUserId: 31, approvedAt: "2026-10-26T00:00:00.000Z", updatedAt: "2026-10-26T00:00:00.000Z" };
    after.proposals[0] = payload;
    event = { action: "Compensation proposal declined", resource: "Proposal #41", metadata: { employeeId: 21 } };
  }
  after.audits.push({ id: 92, organizationId: 11, actor: c.owner.name, ...event });
  return { before, after, response: { json: structuredClone(payload) } };
}

for (const row of rows) {
  test(row.key + " accepts exact own persisted evidence and rejects no-op, foreign identity and swapped response", () => {
    const e = evidence(row.key); row.expect(e.before, e.after, c, e.response);
    assert.throws(() => row.expect(e.before, e.before, c, e.response));
    assert.throws(() => row.expect(e.before, e.after, { ...c, orgId: 99 }, e.response));
    assert.throws(() => row.expect(e.before, e.after, { ...c, owner: { ...c.owner, id: 99 } }, e.response));
    assert.throws(() => row.expect(e.before, e.after, c, { json: {} }));
    const foreign = structuredClone(e.after); foreign[row.key.startsWith("POST") ? "components" : "proposals"].at(-1).organizationId = 99;
    assert.throws(() => row.expect(e.before, foreign, c, e.response));
  });
  test(row.key + " rejects altered payroll, worker, approval and companion state", () => {
    for (const field of ["payProfiles", "bands", "cycles", "assignments", "events", "revisions", "runs", "workers", "reviews"]) {
      const e = evidence(row.key); e.after[field][0].tampered = true;
      assert.throws(() => row.expect(e.before, e.after, c, e.response), field);
    }
    const e = evidence(row.key); e.after[row.key.startsWith("POST") ? "proposals" : "components"].push({ id: 555 });
    assert.throws(() => row.expect(e.before, e.after, c, e.response));
  });
  test(row.key + " requires exact actor/employer/resource audit and retained history", () => {
    for (const change of [e => e.after.audits.pop(), e => { e.after.audits[0].metadata.retained = false; },
      ...["actor", "organizationId", "action", "resource", "metadata"].map(field => e => { e.after.audits.at(-1)[field] = "foreign"; })]) {
      const e = evidence(row.key); change(e); assert.throws(() => row.expect(e.before, e.after, c, e.response));
    }
  });
  test(row.key + " names the actual victim rather than an invented missing resource", () => {
    const own = row.ownBody(c), foreign = row.foreignBody(c);
    if (row.key.startsWith("POST")) { assert.equal(own.organizationId, 11); assert.equal(foreign.organizationId, 99); }
    else { assert.equal(own.id, 41); assert.equal(foreign.id, 101); assert.equal(foreign.decision, "declined"); }
  });
}

test("component proof rejects changed statutory treatment or an unexpected assignment", () => {
  const row = rows[0];
  for (const field of ["active", "taxable", "includeInSssBase", "includeInPagIbigBase"]) {
    const e = evidence(row.key); e.after.components.at(-1)[field] = false; assert.throws(() => row.expect(e.before, e.after, c, e.response));
  }
});

test("proposal refusal cannot schedule pay, alter annual amounts or swap the target worker", () => {
  const row = rows[1];
  for (const field of ["scheduledAt", "appliedAt", "appliedPayRevisionId", "proposedAnnual", "currentAnnual", "employeeId", "bandId", "cycleId", "reason"]) {
    const e = evidence(row.key); e.after.proposals[0][field] = "tampered"; e.response.json = structuredClone(e.after.proposals[0]);
    assert.throws(() => row.expect(e.before, e.after, c, e.response));
  }
  const e = evidence(row.key); e.before.payProfiles = []; e.after.payProfiles = [];
  assert.throws(() => row.expect(e.before, e.after, c, e.response), /existing worker pay profile/);
});

test("refusal fixture uses real returned proposal, band and cycle IDs scoped to the same employer", async () => {
  const inserted = [], tables = { compensationBands: Symbol("band"), compensationCycles: Symbol("cycle"), compensationProposals: Symbol("proposal") };
  const db = { insert: table => ({ values: value => {
    const row = { ...value, id: 100 + inserted.length }; inserted.push({ table, row });
    return Object.assign(Promise.resolve(), { returning: async () => [row] });
  } }) };
  const row = createRows({ assert, db, ...tables })[1];
  const seeded = await row.seed({ org: { id: 11 }, entity: { id: 12 }, unit: { id: 13 }, worker: { id: 21 }, owner: c.owner, marker: c.marker });
  assert.deepEqual(inserted.slice(0, 3).map(item => item.table), Object.values(tables));
  for (const item of inserted) if ("organizationId" in item.row) assert.equal(item.row.organizationId, 11);
  assert.equal(inserted[0].row.active, false); assert.equal(inserted[0].row.legalEntityId, 12);
  assert.equal(inserted[1].row.status, "draft"); assert.equal(inserted[1].row.budgetPool, "0.00");
  assert.equal(seeded.id, 102); assert.equal(seeded.bandId, 100); assert.equal(seeded.cycleId, 101); assert.equal(seeded.employeeId, 21);
  const { extras } = seeded, pending = inserted.filter(item => item.row.status === "pending_approval");
  assert.equal(pending.length, 4); assert.deepEqual(Object.keys(extras.assignments).sort(), ["approve", "cancel", "decline", "self"]);
  assert.deepEqual(pending.map(item => item.row.employeeId), [21, 21, 21, 21]);
  assert.equal(pending.filter(item => item.row.requestedByUserId === c.owner.id).length, 1, "exactly one assignment is self-requested by the owner");
  assert.ok(pending.every(item => item.row.effectiveFrom > "2098-12-31"), "decisions only schedule pay in the far future");
  const member = inserted.find(item => item.row.role === "admin" && item.row.organizationId === 11);
  assert.ok(member && member.row.userId === extras.adminId, "the second admin is a member of the own employer only");
});

test("Compensation targets are unique; PATCH is credited only because every action is executed, POST stays GAP", () => {
  const catalog = tenantFamilyCatalog("write"), manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  for (const row of rows) {
    assert.equal(catalog.filter(item => item.key === row.key).length, 1);
    const [method, route] = row.key.split(" "), record = Object.values(manifest.allApiRouteFiles).find(item => item.route === route);
    assert.equal(record.methods.find(item => item.name === method).status, method === "PATCH" ? "COVERED" : "GAP");
  }
  assert.equal(typeof rows[1].exercise, "function", "the PATCH row executes the additional actions");
  assert.equal(rows[0].exercise, undefined);
});

test("PATCH proof executes every assignment action and every proposal decision with forged-employer and maker-checker refusals", () => {
  const source = readFileSync("scripts/qa/tenant-table-rows/helpers/compensation-patch-actions.mjs", "utf8");
  for (const needle of ['"approve"', '"decline"', '"cancel"', 'decide(proposalX.id, "approved")', 'decide(proposalX.id, "cancel")', 'decide(proposalY.id, "cancel")', 'decide(failed.id, "retry")',
    'for (const decision of ["approved", "cancel", "retry"])', 'maker-checker: the requester approving their own component', 'maker-checker: the submitter approving their own proposal',
    'victimBefore', 'not_due', 'salary_change_scheduled', 'component_scheduled']) assert.ok(source.includes(needle), needle);
  assert.ok(source.includes('effectiveDate: "2098-" + month') && source.includes('effectiveFrom: "2099-03-01"'), "pay changes are scheduled in the far future, never applied");
});
