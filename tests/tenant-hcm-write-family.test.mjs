import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { load } from "js-yaml";
import { createRows } from "../scripts/qa/tenant-table-rows/write/hcm.mjs";
import { createRows as readRows } from "../scripts/qa/tenant-table-rows/read/hcm.mjs";
import { assertHcmWorkItemFixtureTarget, hcmWorkItemFixtureSql } from "../scripts/qa/prepare-hcm-work-item-fixture.mjs";

const c = { orgId: 11, workerId: 21, unitId: 22, marker: "Fictional-own", owner: { id: 31, name: "Fictional owner" },
  seeded: { id: 41, employeeId: 21, skillId: 42, targetUnitId: 22, code: "fictional-own-disable", version: 1 },
  victim: { org: { id: 99 }, unit: { id: 98 }, owner: { id: 91 } }, victimSeeded: { id: 101, employeeId: 102, skillId: 103, targetUnitId: 98 } };
const keys = ["POST hcm/employment-terms", "POST hcm/employment-term-decisions", "POST hcm/effective-changes", "POST hcm/capabilities", "POST hcm/business-processes/definitions", "PATCH hcm/work-items"];
const rows = createRows({ assert });
function evidence(key) {
  let before = [], after, payload;
  if (key === keys[0]) {
    payload = { id: 71, organizationId: 11, employeeId: 41, reason: c.marker, termKind: "regular", employmentType: "Regular", effectiveFrom: "2026-07-05", status: "pending_approval", requestedByUserId: 31, requestedBy: c.owner.name, approvedByUserId: null, activatedAt: null };
    after = [payload]; payload = { term: payload };
  } else if (key === keys[1]) {
    const decision = { id: 71, organizationId: 11, employeeId: 21, employmentTermId: 41, reason: c.marker, decisionKind: "continue_current", effectiveDate: "2026-07-05", status: "pending_approval", requestedByUserId: 31, separationHandoffStatus: "none" };
    before = { decisions: [], events: [] }; after = { decisions: [decision], events: [{ id: 81, organizationId: 11, decisionId: 71, employeeId: 21, actorUserId: 31, eventType: "requested" }] }; payload = { decision };
  } else if (key === keys[2]) {
    const change = { id: 71, organizationId: 11, employeeId: 41, targetOrgUnitId: 22, reason: c.marker, status: "pending_approval", effectiveDate: "2099-07-05", requestedByUserId: 31, toSnapshot: { changes: { orgUnitId: 22 } } };
    before = { changes: [], processes: [] }; after = { changes: [change], processes: [{ id: 81, organizationId: 11, employeeId: 41, sourceType: "worker_effective_change", sourceKey: "71", initiatedByUserId: 31 }] }; payload = { ...change, businessProcess: { id: 81 } };
  } else if (key === keys[3]) {
    const requirement = { id: 71, organizationId: 11, jobProfileId: 41, skillId: 42, minimumProficiency: 3, mandatory: true, createdByUserId: 31 }; after = [requirement]; payload = { requirement };
  } else if (key === keys[4]) {
    const definition = { id: 41, organizationId: 11, active: true, name: c.marker, code: c.seeded.code, version: 1 }; before = [definition]; after = [{ ...definition, active: false }]; payload = after[0];
  } else {
    const item = { id: 41, organizationId: 11, employeeId: 21, title: c.marker, status: "open", ownerTeam: "HR Operations", assignedOwnerUserId: null };
    before = { cases: [item], events: [] }; after = { cases: [{ ...item, ownerTeam: "People Operations", assignedOwnerUserId: 31 }], events: [{ id: "81", organization_id: 11, case_id: 41, actor_user_id: 31, event_type: "ownership_sla_updated", previous_value: { ownerTeam: "HR Operations" }, next_value: { ownerTeam: "People Operations", ownerUserId: 31 } }] }; payload = { item: { id: 41, organization_id: 11 } };
  }
  return { before: structuredClone(before), after: structuredClone(after), response: { json: structuredClone(payload) } };
}

for (const key of keys) {
  const row = rows.find(r => r.key === key);
  test(key + " accepts own persisted evidence and rejects unchanged, foreign and response-swapped evidence", () => {
    const { before, after, response } = evidence(key); row.expect(before, after, c, response);
    assert.throws(() => row.expect(before, before, c, response));
    assert.throws(() => row.expect(before, after, { ...c, orgId: 99 }, response));
    assert.throws(() => row.expect(before, after, { ...c, seeded: { ...c.seeded, id: 999 } }, response));
    assert.throws(() => row.expect(before, after, c, { json: {} }));
    const wrongResponse = JSON.parse(JSON.stringify(response).replaceAll('"id":71', '"id":999').replaceAll('"id":41', '"id":999'));
    assert.throws(() => row.expect(before, after, c, wrongResponse));
  });
  test(key + " sends real victim selectors and retains own employer on forged references", () => {
    const own = row.ownBody(c), foreign = row.foreignBody(c), forged = row.forged.body(c);
    assert.equal(own.organizationId, 11); assert.equal(foreign.organizationId, 99); assert.equal(forged.organizationId, 11);
    assert.notDeepEqual(own, foreign); assert.notDeepEqual(own, forged);
    assert.ok(Object.values(foreign).some(v => [101, 102, 103, 98].includes(v)));
    assert.ok(Object.values(forged).some(v => [101, 103, 98].includes(v)));
    assert.ok([400, 404].includes(row.forged.status));
  });
}

test("decision, process and ownership proofs reject absent, foreign or misattributed companion evidence", () => {
  for (const [key, field] of [[keys[1], "events"], [keys[2], "processes"], [keys[5], "events"]]) {
    const row = rows.find(r => r.key === key), { before, after, response } = evidence(key);
    assert.throws(() => row.expect(before, { ...after, [field]: [] }, c, response));
    const foreign = structuredClone(after); const record = foreign[field][0];
    if (field === "processes") record.initiatedByUserId = 99;
    else if (key === keys[5]) record.actor_user_id = 99;
    else record.actorUserId = 99;
    assert.throws(() => row.expect(before, foreign, c, response));
  }
});

test("work-item event read requires the exact seeded event, actor and employer marker", () => {
  const row = readRows({ assert, proofs: new Proxy({}, { get: () => () => {} }) }).find(r => r.key === "GET hcm/work-items/events");
  const ctx = { ...c, seeded: { id: 41, eventId: "81" } };
  const payload = { events: [{ id: "81", actorUserId: 31, eventType: "ownership_sla_updated", nextValue: { marker: c.marker, ownerUserId: 31 } }] };
  row.prove({ json: payload }, ctx); assert.equal(row.query(ctx), "caseId=41");
  for (const bad of [{ events: [] }, { events: [{ ...payload.events[0], id: "99" }] }, { events: [{ ...payload.events[0], actorUserId: 99 }] }, { events: [{ ...payload.events[0], nextValue: { marker: "Foreign", ownerUserId: 31 } }] }, { events: [...payload.events, payload.events[0]] }]) assert.throws(() => row.prove({ json: bad }, ctx));
});

test("HCM SQL-only fixture refuses every non-disposable environment before connecting", () => {
  const env = { GITHUB_ACTIONS: "true", CI: "true", TENANT_SECOND_PASS_MODE: "isolated-ci-only", DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db", PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false" };
  assertHcmWorkItemFixtureTarget(env);
  for (const key of Object.keys(env)) { assert.throws(() => assertHcmWorkItemFixtureTarget({ ...env, [key]: undefined })); assert.throws(() => assertHcmWorkItemFixtureTarget({ ...env, [key]: "wrong" })); }
  assert.equal(hcmWorkItemFixtureSql(), readFileSync("drizzle/0104_hcm_work_item_sla.sql", "utf8").replaceAll("\r\n", "\n"));
});

test("HCM fixture is installed after baseline and before build/server or employer seeding", () => {
  const workflow = load(readFileSync(".github/workflows/tenant-table-proof.yml", "utf8"));
  const runs = workflow.jobs.table.steps.map(s => s.run ?? "");
  const index = runs.findIndex(r => r.includes("prepare-hcm-work-item-fixture")); assert.ok(index > 0);
  assert.ok(runs.slice(0, index).some(r => r.includes("apply-isolated-baseline")));
  assert.ok(runs.slice(index + 1).some(r => r.includes("npm run build")));
  const source = readFileSync("scripts/qa/prepare-hcm-work-item-fixture.mjs", "utf8");
  assert.ok(source.indexOf('target.employers, 0') < source.indexOf('client.query(sql)'));
  assert.ok(source.indexOf('target.audits, 0') < source.indexOf('client.query(sql)'));
  assert.match(source, /LOCK TABLE organizations, audit_events IN ACCESS EXCLUSIVE MODE/);
  assert.match(source, /ROLLBACK/);
});

test("all seven HCM targets remain GAP and a link-only refresh cannot credit them", () => {
  const file = "scripts/qa/tenant-isolation-coverage-manifest.json", source = readFileSync(file, "utf8"), manifest = JSON.parse(source);
  for (const key of [...keys, "GET hcm/work-items/events"]) {
    const [method, route] = key.split(" "), record = Object.values(manifest.allApiRouteFiles).find(r => r.route === route);
    assert.equal(record.methods.find(m => m.name === method).status, "GAP");
  }
  const report = JSON.parse(execFileSync(process.execPath, ["scripts/qa/tenant-table-credit.mjs", "--refresh-links", "--check"], { encoding: "utf8" }));
  assert.equal(report.newlyCredited, 0); assert.deepEqual(report.before, report.after); assert.equal(readFileSync(file, "utf8"), source);
});
