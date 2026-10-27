import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRows } from "../scripts/qa/tenant-table-rows/write/hcm-employee-skills.mjs";

function rowWith(overrides = {}) {
  const [row] = createRows({
    assert, db: {}, eq: () => {}, asc: () => {}, hcmSkills: {},
    employees: {}, employeePayProfiles: {}, payrollRuns: {},
    hcmJobProfileSkillRequirements: {}, auditEvents: {},
    auditBusinessSnapshot: x => x, pool: {}, ...overrides,
  });
  return row;
}
const owner = {
  orgId: 11, workerId: 31, entityId: 21, rank: 1,
  marker: "TTBL-ATTA-fictional",
  owner: { id: 41, name: "Fictional HCM owner" },
  worker: { id: 31, employeeNo: "Fictional-Employee-A" },
  seeded: { id: 51, previousId: 61, name: "TTBL-ATTA-fictional fictional capability" },
  victim: { org: { id: 91 }, worker: { id: 99, employeeNo: "Fictional-Victim" },
    marker: "TTBL-VICTIM-fake" },
  victimSeeded: { id: 111, previousId: 121 },
};

function fixture() {
  const previous = {
    id: 61, organization_id: 11, employee_id: 31, skill_id: 51,
    proficiency: 1, status: "declared", effective_from: "2026-01-05",
    effective_until: null, verified_at: null, verified_by_user_id: null,
    verified_by_name: null, notes: "private historical skill",
  };
  const before = {
    skills: [{ id: 51, organizationId: 11, name: owner.seeded.name }],
    assignments: [previous],
    workers: [{ id: 31, organizationId: 11, employeeNo: owner.worker.employeeNo }],
    payProfiles: [{ id: 12, organizationId: 11, rateAmount: "25000.00" }],
    payroll: [{ id: 16, organizationId: 11, status: "draft" }],
    jobRequirements: [],
    audit: [{ id: 70, organizationId: 11, actor: "Older actor", action: "Older event",
      resource: "Older record", metadata: {} }],
  };
  const after = structuredClone(before);
  const newRow = { ...previous, id: 71, proficiency: 3, effective_from: "2026-10-27",
    notes: owner.marker + " private unverified skill evidence" };
  after.assignments.push(newRow);
  after.audit.push({ id: 80, organizationId: 11, actor: owner.owner.name,
    action: "HCM employee skill updated",
    resource: owner.worker.employeeNo + " · " + owner.seeded.name,
    metadata: {
      employeeId: 31, skillId: 51, proficiency: 3,
      status: "declared", effectiveFrom: "2026-10-27", effectiveUntil: null,
    } });
  const response = { json: { employeeSkill: { id: 71, organizationId: 11,
    employeeId: 31, skillId: 51, status: "declared" } } };
  return { before, after, response };
}

test("one exact POST GAP row requires real employer/skill and forged high-ID employee denial", () => {
  const row = rowWith();
  assert.equal(row.key, "POST hcm/capabilities");
  assert.equal(row.profile ?? "default", "default");
  assert.deepEqual(row.flags ?? [], []);
  assert.equal(row.status ?? 200, 200);
  assert.equal(row.deny ?? 403, 403);
  assert.equal(row.forged.status, 404);
  for (const method of ["seed", "state", "ownBody", "foreignBody", "expect"])
    assert.equal(typeof row[method], "function", method);
  assert.deepEqual(row.ownBody(owner), {
    organizationId: 11, action: "set_employee_skill", employeeId: 31,
    skillId: 51, proficiency: 3, status: "declared", effectiveFrom: "2026-10-27",
    effectiveUntil: null, notes: owner.marker + " private unverified skill evidence",
  });
  assert.equal(row.foreignBody(owner).organizationId, owner.victim.org.id);
  assert.equal(row.foreignBody(owner).employeeId, owner.victim.worker.id);
  assert.equal(row.foreignBody(owner).skillId, owner.victimSeeded.id);
  assert.equal(row.forged.body(owner).organizationId, 11);
  assert.equal(row.forged.body(owner).employeeId, owner.victim.worker.id);
  assert.equal(row.forged.body(owner).skillId, owner.seeded.id);
  assert.ok(owner.victim.worker.id > owner.workerId);
  assert.ok(owner.victimSeeded.id > owner.seeded.id);
});

test("seed inserts actual skill and preexisting historical employee-skill row for every employer", async () => {
  const inserted = [];
  const fakeDb = {
    insert: table => {
      assert.equal(table, "hcmSkills");
      return { values: values => ({
        returning: async () => {
          inserted.push(values);
          return [{ id: 51, name: values.name, organizationId: values.organizationId }];
        },
      }) };
    },
  };
  const fakePool = { query: async (sql, params) => {
    assert.match(sql, /^INSERT INTO hcm_employee_skills/);
    assert.match(sql, /RETURNING id/);
    assert.deepEqual(params, [11, 31, 51, owner.marker + " old private skill"]);
    return { rows: [{ id: 61 }] };
  } };
  const row = rowWith({ db: fakeDb, pool: fakePool, hcmSkills: "hcmSkills" });
  const seeded = await row.seed({
    org: { id: 11 }, worker: { id: 31 }, owner: owner.owner,
    marker: owner.marker,
  });
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].organizationId, 11);
  assert.equal(inserted[0].createdByUserId, owner.owner.id);
  assert.equal(seeded.id, 51);
  assert.equal(seeded.previousId, 61);
  assert.match(inserted[0].name, /fictional capability$/);
});

test("one true own write, historical-row immutability and actor-bound audit are required", () => {
  const row = rowWith();
  const e = fixture();
  row.expect(e.before, e.after, owner, e.response);
});

test("reject no-op, wrong worker/skill/tenant, extra rows or fabricated verification", () => {
  const changes = [
    e => { e.after = structuredClone(e.before); },
    e => { e.after.assignments[1].organization_id = 91; },
    e => { e.after.assignments[1].employee_id = 99; },
    e => { e.after.assignments[1].skill_id = 111; },
    e => { e.after.assignments[1].effective_from = "2026-01-05"; },
    e => { e.after.assignments[1].proficiency = 5; },
    e => { e.after.assignments[1].status = "verified"; },
    e => { e.after.assignments[1].verified_at = "2026-10-27T00:00:00.000Z"; },
    e => { e.after.assignments[1].verified_by_user_id = 41; },
    e => { e.after.assignments[1].notes = "invented"; },
    e => { e.after.assignments[0].notes = "rewritten historical evidence"; },
    e => { e.after.assignments.push({ ...e.after.assignments[1], id: 72 }); },
    e => { e.response.json.employeeSkill.id = 999; },
    e => { e.response.json.employeeSkill.skillId = 111; },
  ];
  for (const change of changes) {
    const e = fixture(); change(e);
    assert.throws(() => rowWith().expect(e.before, e.after, owner, e.response));
  }
});

test("reject rewrites of employee, skill catalog, payroll, pay and job requirements", () => {
  const changes = [
    e => { e.after.skills[0].organizationId = 91; },
    e => { e.after.workers[0].employeeNo = "other"; },
    e => { e.after.payProfiles[0].rateAmount = "27000.00"; },
    e => { e.after.payroll[0].status = "released"; },
    e => { e.after.jobRequirements.push({ id: 31, organizationId: 11 }); },
  ];
  for (const change of changes) {
    const e = fixture(); change(e);
    assert.throws(() => rowWith().expect(e.before, e.after, owner, e.response));
  }
});

test("audit must identify the actual session actor, own employee and only an unverified declaration", () => {
  const changes = [
    e => { e.after.audit.pop(); },
    e => { e.after.audit[0].actor = "rewritten"; },
    e => { e.after.audit[1].organizationId = 91; },
    e => { e.after.audit[1].actor = "foreign actor"; },
    e => { e.after.audit[1].action = "HCM employee skill verified"; },
    e => { e.after.audit[1].resource = "other employee"; },
    e => { e.after.audit[1].metadata.employeeId = 99; },
    e => { e.after.audit[1].metadata.skillId = 111; },
    e => { e.after.audit.push({ ...e.after.audit[1], id: 81 }); },
  ];
  for (const change of changes) {
    const e = fixture(); change(e);
    assert.throws(() => rowWith().expect(e.before, e.after, owner, e.response));
  }
  const e = fixture();
  assert.throws(() => rowWith().expect(e.before, e.after,
    { ...owner, orgId: 91 }, e.response), "real other employer success must be rejected");
});

test("production branch enforces both resource identities and scope before writing skill evidence", () => {
  const route = readFileSync("src/app/api/hcm/capabilities/route.ts", "utf8");
  assert.match(route, /enforceSameOriginMutation\(request\)/);
  assert.match(route, /getSessionUser\(\)/);
  assert.match(route, /assertOrganizationRole\([\s\S]*?PEOPLE_ADMIN_ROLES/);
  assert.match(route, /if \(action === "set_employee_skill"\)/);
  assert.match(route, /eq\(employees\.organizationId, organizationId\)/);
  assert.match(route, /eq\(hcmSkills\.organizationId, organizationId\)/);
  assert.match(route, /assertScope\(access, employee\.orgUnitId\)/);
  assert.match(route, /recordAuditEvent\(/);
  assert.match(route, /status === "verified"/);
});

test("POST hcm/capabilities stays GAP; GET remains COVERED and no production credits are invented", () => {
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const methods = manifest.allApiRouteFiles["src/app/api/hcm/capabilities/route.ts"].methods;
  const get = methods.find(m => m.name === "GET");
  const post = methods.find(m => m.name === "POST");
  assert.equal(get?.status, "COVERED");
  assert.equal(post?.status, "GAP");
  assert.equal(post?.testedBy ?? null, null);
});
