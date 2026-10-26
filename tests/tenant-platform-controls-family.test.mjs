import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createRows } from "../scripts/qa/tenant-table-rows/write/platform-controls.mjs";
import { createRows as readRows } from "../scripts/qa/tenant-table-rows/read/platform-controls.mjs";
import { createRows as hcmRows } from "../scripts/qa/tenant-table-rows/write/hcm.mjs";
import { tenantFamilyCatalog } from "../scripts/qa/tenant-table-catalog.mjs";

const rows = createRows({ assert });
const c = { orgId: 11, workerId: 21, rank: 1, marker: "Fictional-own", owner: { id: 31, name: "Fictional owner" }, seeded: { id: 41 }, victim: { org: { id: 99 } }, victimSeeded: { id: 101 } };

test("HCM and Platform case fixtures coexist for the same worker without duplicate source-case keys", async () => {
  const table = Symbol("automationOperationalCases"), records = [];
  const db = { insert(target) {
    assert.equal(target, table);
    return { values(value) { return { returning: async () => {
      assert.ok(!records.some(old => old.organizationId === value.organizationId && old.caseType === value.caseType && old.sourceId === value.sourceId), "automation_operations_source_case_unique");
      const row = { ...value, id: records.length + 1 }; records.push(row); return [row];
    } }; } };
  } };
  const context = { assert, db, automationOperationalCases: table };
  const hcm = hcmRows(context).find(row => row.key === "PATCH hcm/work-items");
  const studio = createRows(context).find(row => row.key === "POST automation-studio");
  const employer = { org: { id: 11 }, worker: { id: 21 }, marker: "Fictional-own" };
  const hcmCase = await hcm.seed(employer), studioCase = await studio.seed(employer);
  assert.notEqual(hcmCase.id, studioCase.id); assert.notEqual(hcmCase.caseType, studioCase.caseType);
  assert.equal(studioCase.organizationId, 11); assert.equal(studioCase.employeeId, 21); assert.equal(studioCase.status, "open");
  assert.equal(studioCase.caseType, "coverage_recovery");
  await assert.rejects(() => studio.seed(employer), /automation_operations_source_case_unique/, "the regression still enforces uniqueness rather than dropping duplicates");
});
function evidence(key) {
  let before, after, json, action, resource, metadata;
  if (key === "POST developer") {
    const record = { id: 41, organizationId: 11, name: c.marker, prefix: "fictional", keyHash: "fictional-hash", scopes: [], revokedAt: null };
    before = { keys: [record] }; after = { keys: [{ ...record, revokedAt: "2026-10-26T00:00:00.000Z" }] }; json = { ok: true }; action = "API key revoked"; resource = c.marker; metadata = { prefix: "fictional" };
  } else if (key === "POST enterprise") {
    const policy = { id: 71, organizationId: 11, sessionIdleMinutes: 31, sessionMaxHours: 24, maxActiveSessions: 3, requireMfa: true, ssoMode: "optional", updatedByUserId: 31 };
    before = { policies: [] }; after = { policies: [policy] }; json = policy; action = "Enterprise security policy updated"; resource = "Organization security policy"; metadata = { sessionIdleMinutes: 31, sessionMaxHours: 24, maxActiveSessions: 3, requireMfa: true, ssoMode: "optional" };
  } else if (key === "POST automation-studio") {
    const record = { id: 41, organizationId: 11, employeeId: 21, title: c.marker, status: "open", acknowledgedByUserId: null, acknowledgedByName: null, acknowledgedAt: null, resolvedAt: null };
    before = { cases: [record], workers: [{ id: 21, organizationId: 11, status: "Active" }], executions: [] };
    const updated = { ...record, status: "acknowledged", acknowledgedByUserId: 31, acknowledgedByName: c.owner.name, acknowledgedAt: "2026-10-26T00:00:00.000Z" };
    after = { cases: [updated], workers: before.workers, executions: [] }; json = { operationalCase: updated, sourceMutation: false, executionStatusUnchanged: true };
    action = "Automation operations case acknowledge"; resource = c.marker; metadata = { caseId: 41, note: c.marker + " fictional triage note", sourceMutation: false, underlyingExecutionStatusUnchanged: true };
  } else {
    const org = { id: 11, name: c.marker + " employer", legalName: c.marker + " Inc.", statutoryDeductionTiming: "split", payrollCalendarMode: "flexible", birTin: null };
    const renamed = { ...org, name: c.marker + " renamed" }; before = { organizations: [org] }; after = { organizations: [renamed] }; json = { ok: true, organization: renamed };
    action = "Organization profile updated"; resource = renamed.name; metadata = { legalName: org.legalName, statutoryDeductionTiming: "split", payrollCalendarMode: "flexible", governmentFieldsUpdated: [] };
  }
  before.audits = [{ id: 1, organizationId: 11, action: "earlier record" }];
  after.audits = [...before.audits, { id: 81, organizationId: 11, actor: c.owner.name, action, resource, metadata }];
  return { before: structuredClone(before), after: structuredClone(after), response: { json: structuredClone(json) } };
}

for (const row of rows) {
  test(row.key + " requires genuine own persisted changes and rejects no-op, foreign and response-swapped proof", () => {
    const { before, after, response } = evidence(row.key); row.expect(before, after, c, response);
    assert.throws(() => row.expect(before, before, c, response));
    assert.throws(() => row.expect(before, after, { ...c, orgId: 99 }, response));
    assert.throws(() => row.expect(before, after, c, { json: {} }));
    const foreign = structuredClone(after), field = Object.keys(foreign).find(k => k !== "audits");
    if (field === "organizations") foreign.organizations[0].id = 99; else foreign[field][0].organizationId = 99;
    assert.throws(() => row.expect(before, foreign, c, response));
  });
  test(row.key + " retains the real foreign employer and victim IDs", () => {
    const own = row.ownBody(c), foreign = row.foreignBody(c); assert.equal(own.organizationId, 11); assert.equal(foreign.organizationId, 99); assert.notDeepEqual(own, foreign);
    if (row.forged) { const forged = row.forged.body(c); assert.equal(forged.organizationId, 11); assert.ok(Object.values(forged).includes(101)); assert.notDeepEqual(own, forged); assert.equal(row.forged.status, 404); }
  });
}

test("every platform write requires the exact actor/employer audit and preserves prior audit records", () => {
  for (const row of rows) for (const mutate of [e => { e.after.audits.pop(); }, e => { e.after.audits.at(-1).actor = "Foreign"; }, e => { e.after.audits.at(-1).organizationId = 99; }, e => { e.after.audits.at(-1).metadata = {}; }, e => { e.after.audits[0].action = "tampered"; }]) {
    const e = evidence(row.key); mutate(e); assert.throws(() => row.expect(e.before, e.after, c, e.response));
  }
});

test("revocation cannot replace key hashes or unrelated credential fields", () => {
  const row = rows.find(r => r.key === "POST developer"), e = evidence(row.key); e.after.keys[0].keyHash = "replaced";
  assert.throws(() => row.expect(e.before, e.after, c, e.response));
});

test("enterprise policy proof retains MFA and rejects false response claims", () => {
  const row = rows.find(r => r.key === "POST enterprise");
  for (const mutate of [e => { e.after.policies[0].requireMfa = false; }, e => { e.response.json.requireMfa = false; }, e => { e.after.policies[0].updatedByUserId = 99; }]) {
    const e = evidence(row.key); mutate(e); assert.throws(() => row.expect(e.before, e.after, c, e.response));
  }
});

test("triage acknowledgement cannot resolve source records or rerun execution", () => {
  const row = rows.find(r => r.key === "POST automation-studio");
  for (const mutate of [e => { e.after.cases[0].resolvedAt = "2026-10-26"; }, e => { e.after.workers[0].status = "Separated"; }, e => { e.after.executions.push({ id: 99 }); }, e => { e.response.json.sourceMutation = true; }]) {
    const e = evidence(row.key); mutate(e); assert.throws(() => row.expect(e.before, e.after, c, e.response));
  }
});

test("organization rename cannot change payroll settings or government identifiers", () => {
  const row = rows.find(r => r.key === "PUT organizations");
  for (const key of ["statutoryDeductionTiming", "payrollCalendarMode", "birTin", "legalName"]) {
    const e = evidence(row.key); e.after.organizations[0][key] = "tampered"; assert.throws(() => row.expect(e.before, e.after, c, e.response));
  }
});

test("enterprise read proves a real inactive own permission set, never defaults or foreign rows", () => {
  const row = readRows({ assert }).find(r => r.key === "GET enterprise");
  const payload = { permissionSets: [{ id: 41, organizationId: 11, name: c.marker, active: false, permissions: [] }] };
  row.prove({ json: payload }, c);
  for (const bad of [{ permissionSets: [] }, { permissionSets: [{ ...payload.permissionSets[0], id: 99 }] }, { permissionSets: [{ ...payload.permissionSets[0], organizationId: 99 }] }, { permissionSets: [{ ...payload.permissionSets[0], active: true }] }, { permissionSets: [{ ...payload.permissionSets[0], permissions: ["unexpected"] }] }]) assert.throws(() => row.prove({ json: bad }, c));
});

test("five distinct platform targets credit only the reviewed read and single update path", () => {
  const keys = [...rows.map(r => r.key), "GET enterprise"]; assert.equal(keys.length, 5); assert.equal(new Set(keys).size, 5);
  const catalog = [...tenantFamilyCatalog("write"), ...tenantFamilyCatalog("read")]; for (const key of keys) assert.equal(catalog.filter(r => r.key === key).length, 1);
  const file = "scripts/qa/tenant-isolation-coverage-manifest.json", text = readFileSync(file, "utf8"), manifest = JSON.parse(text);
  for (const key of keys) { const [method, route] = key.split(" "), record = Object.values(manifest.allApiRouteFiles).find(r => r.route === route); assert.equal(record.methods.find(m => m.name === method).status, ["GET enterprise", "PUT organizations"].includes(key) ? "COVERED" : "GAP"); }
  const report = JSON.parse(execFileSync(process.execPath, ["scripts/qa/tenant-table-credit.mjs", "--refresh-links", "--check"], { encoding: "utf8" }));
  assert.equal(report.newlyCredited, 0); assert.deepEqual(report.before, report.after); assert.equal(readFileSync(file, "utf8"), text);
});
