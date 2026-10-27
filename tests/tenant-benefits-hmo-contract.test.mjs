import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRows } from "../scripts/qa/tenant-table-rows/write/benefits-hmo.mjs";

const sourceKey = "POST benefits/hmo";
const tableNames = [
  "benefitPlans", "benefitEnrollments", "benefitDependents",
  "benefitEnrollmentEvents", "auditEvents",
];

function harness() {
  let nextId = 900;
  const tables = Object.fromEntries(tableNames.map(name =>
    [name, { name, id: { column: "id" }, organizationId: { column: "organizationId" } }]));
  const store = Object.fromEntries(tableNames.map(name => [name, []]));
  const db = {
    insert: (table) => ({ values: (input) => ({
      returning: async () => {
        const row = { ...structuredClone(input), id: ++nextId };
        store[table.name].push(row);
        return [structuredClone(row)];
      },
    }) }),
    select: () => ({ from: (table) => ({ where: ({ orgId }) => ({
      orderBy: () => structuredClone(store[table.name]
        .filter(row => row.organizationId === orgId).sort((a, b) => a.id - b.id)),
    }) }) }),
  };
  const context = {
    db, assert, ...tables,
    asc: x => x, eq: (_, orgId) => ({ orgId }),
    auditBusinessSnapshot: rows => rows.map(row => Object.fromEntries(
      Object.entries(row).filter(([key]) => !["chainSeq", "rowHash", "prevHash"].includes(key)))),
  };
  const [row] = createRows(context);
  return { row, store, tables, db };
}

const employers = [
  { marker: "TTBL-ATTA-private", rank: 1,
    org: { id: 11 }, worker: { id: 21 }, owner: { id: 31, name: "Attacker A owner" } },
  { marker: "TTBL-ATTB-private", rank: 2,
    org: { id: 12 }, worker: { id: 22 }, owner: { id: 32, name: "Attacker B owner" } },
  { marker: "TTBL-VICTIM-private", rank: 4,
    org: { id: 14 }, worker: { id: 24 }, owner: { id: 34, name: "Victim owner" } },
];
async function seededHarness() {
  const h = harness();
  const seeds = [];
  for (const e of employers) seeds.push(await h.row.seed(e));
  const ctxFor = (index) => {
    const e = employers[index];
    return {
      orgId: e.org.id, workerId: e.worker.id,
      marker: e.marker, rank: e.rank, owner: e.owner,
      seeded: seeds[index], victimSeeded: seeds[2],
      victim: employers[2],
    };
  };
  return { ...h, seeds, ctxFor };
}
async function makeOwnWrite(h, c) {
  const before = await h.row.state(c.orgId);
  const req = h.row.ownBody(c);
  const [plan] = await h.db.insert(h.tables.benefitPlans).values({
    organizationId: c.orgId, name: req.name, category: "hmo",
    provider: req.provider, planCode: req.planCode,
    contractNumber: req.contractNumber,
    employeeShare: req.employeeShare.toFixed(2),
    employerShare: req.employerShare.toFixed(2),
    dependentShare: req.dependentShare.toFixed(2),
    employerPaidDependents: req.employerPaidDependents,
    waitingPeriodDays: req.waitingPeriodDays,
    annualBenefitLimit: req.annualBenefitLimit.toFixed(2),
    coverageDetails: req.coverageDetails,
  }).returning();
  await h.db.insert(h.tables.auditEvents).values({
    organizationId: c.orgId, actor: c.owner.name,
    action: "HMO plan created", resource: plan.name,
    metadata: { planId: plan.id, provider: plan.provider },
  }).returning();
  const after = await h.row.state(c.orgId);
  const response = { status: 201, json: plan, text: JSON.stringify(plan) };
  return { before, after, response, plan };
}

test("one exact GAP method in new, independent Benefits/HMO write family", () => {
  const { row } = harness();
  assert.equal(row.key, sourceKey);
  assert.equal(row.status, 201);
  assert.equal(row.deny ?? 403, 403);
  assert.equal(row.profile ?? "default", "default");
  assert.deepEqual(row.flags ?? [], []);
  assert.equal(row.pathIds, undefined);
  for (const key of ["seed", "state", "ownBody", "foreignBody", "expect", "exercise"]) {
    assert.equal(typeof row[key], "function");
  }
  assert.equal(row.forged.status, 404);
  assert.equal(typeof row.forged.body, "function");
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const record = Object.values(manifest.allApiRouteFiles)
    .find(item => item.route === "benefits/hmo");
  assert.equal(record.methods.find(m => m.name === "POST")?.status, "GAP",
    "source tests do not grant coverage credits");
});

test("all three HMO sources persist distinct real plan, enrollment and dependent IDs", async () => {
  const h = await seededHarness();
  const [a, b, v] = h.seeds;
  for (const id of ["id", "enrollmentId", "dependentId"]) {
    assert.ok(v[id] > a[id] && v[id] > b[id], "victim must have real higher " + id);
    assert.ok(a[id] > 0 && b[id] > 0);
  }
  assert.equal(h.store.benefitPlans.length, 3);
  assert.equal(h.store.benefitEnrollments.length, 3);
  assert.equal(h.store.benefitDependents.length, 3);
  for (let i = 0; i < employers.length; i++) {
    const e = employers[i], seed = h.seeds[i];
    const plan = h.store.benefitPlans.find(p => p.id === seed.id);
    const enrollment = h.store.benefitEnrollments.find(p => p.id === seed.enrollmentId);
    const dependent = h.store.benefitDependents.find(p => p.id === seed.dependentId);
    assert.equal(plan.organizationId, e.org.id);
    assert.equal(plan.category, "hmo");
    assert.ok(plan.name.includes(e.marker));
    assert.equal(enrollment.organizationId, e.org.id);
    assert.equal(enrollment.planId, plan.id);
    assert.equal(enrollment.employeeId, e.worker.id);
    assert.equal(enrollment.providerStatus, "not_sent");
    assert.equal(dependent.organizationId, e.org.id);
    assert.equal(dependent.enrollmentId, enrollment.id);
    assert.equal(dependent.employeeId, e.worker.id);
    assert.ok(dependent.name.includes(e.marker));
  }
  assert.equal(h.store.auditEvents.length, 0,
    "fixtures are direct source inserts, not an actual provider enrollment");
});

test("own, victim-organization, and stolen victim enrollment bodies are genuinely distinct", async () => {
  const h = await seededHarness(), c = h.ctxFor(0);
  const own = h.row.ownBody(c), foreign = h.row.foreignBody(c);
  assert.equal(own.action, "create_plan");
  assert.equal(own.organizationId, c.orgId);
  assert.equal(foreign.organizationId, c.victim.org.id);
  assert.equal(foreign.name, own.name,
    "foreign attempt must use same authenticated attacker intent");
  assert.ok(own.name.includes(c.marker));
  assert.ok(!own.name.includes(c.victim.marker));
  assert.deepEqual(own.coverageDetails, {
    source: "disposable-tenant-table", ownerMarker: c.marker,
  });
  const forged = h.row.forged.body(c);
  assert.equal(forged.action, "add_dependent");
  assert.equal(forged.organizationId, c.orgId);
  assert.equal(forged.enrollmentId, c.victimSeeded.enrollmentId);
  assert.notEqual(forged.enrollmentId, c.seeded.enrollmentId);
  assert.equal(h.row.forged.status, 404);
});

test("own source proof binds exact plan fields, cents, audit ID and HTTP response", async () => {
  const h = await seededHarness();
  const a = h.ctxFor(0), b = h.ctxFor(1);
  const first = await makeOwnWrite(h, a);
  h.row.expect(first.before, first.after, a, first.response);
  const second = await makeOwnWrite(h, b);
  h.row.expect(second.before, second.after, b, second.response);
  assert.throws(() => h.row.expect(first.before, first.after, b, first.response),
    "A's actual response must fail B's own-data proof");
  assert.throws(() => h.row.expect(second.before, second.after, a, second.response),
    "B's actual response must fail A's own-data proof");
  assert.equal((await h.row.state(employers[2].org.id)).plans.length, 1,
    "positive writes must not touch the victim plan");
});

test("forged write validators reject leakage, missing audit, changed old plan and benefits mutations", async () => {
  const h = await seededHarness(), c = h.ctxFor(0);
  const { before, after, response } = await makeOwnWrite(h, c);
  const changes = [
    d => { d.after.plans.pop(); },
    d => { d.after.plans.at(-1).organizationId = employers[2].org.id; },
    d => { d.after.plans.at(-1).name = employers[2].marker; },
    d => { d.after.plans.at(-1).employeeShare = "999.00"; },
    d => { d.after.plans.at(-1).dependentShare = "999.00"; },
    d => { d.after.plans.at(-1).planCode = "wrong-plan"; },
    d => { d.after.plans.at(-1).coverageDetails.ownerMarker = "other"; },
    d => { d.after.plans[0].name = "mutated former source"; },
    d => { d.after.enrollments.push({ id: 999 }); },
    d => { d.after.dependents[0].status = "active"; },
    d => { d.after.events.push({ id: 999 }); },
    d => { d.after.audit.pop(); },
    d => { d.after.audit.at(-1).organizationId = employers[2].org.id; },
    d => { d.after.audit.at(-1).metadata.planId = 999; },
    d => { d.response.json.id = 999; },
    d => { d.response.text += employers[2].marker; },
  ];
  for (const mutate of changes) {
    const d = { before: structuredClone(before), after: structuredClone(after),
      response: structuredClone(response) };
    mutate(d);
    assert.throws(() => h.row.expect(d.before, d.after, c, d.response));
  }
});

test("additional actions reject victim dependent/enrollment IDs and preserve source state", async () => {
  const h = await seededHarness(), c = h.ctxFor(0);
  await makeOwnWrite(h, c);
  const visited = [];
  const request = async (url, { method, body, cookie }) => {
    assert.equal(cookie, "fake-session-A");
    assert.ok(url.startsWith("/api/benefits/hmo"));
    visited.push(method === "GET" ? "GET" : body.action);
    if (method === "POST") {
      assert.equal(body.organizationId, c.orgId);
      if (body.action === "update_dependent") {
        assert.equal(body.dependentId, c.victimSeeded.dependentId);
      } else if (body.action === "update_enrollment") {
        assert.equal(body.enrollmentId, c.victimSeeded.enrollmentId);
      } else throw new Error("unrecognized additional probe");
      const json = { error: "HMO resource not found." };
      return { status: 404, json, text: JSON.stringify(json) };
    }
    assert.equal(method, "GET");
    const own = await h.row.state(c.orgId);
    const json = {
      plans: own.plans.filter(p => p.category === "hmo"),
      enrollments: own.enrollments.map(e => ({
        ...e, dependents: own.dependents.filter(d => d.enrollmentId === e.id),
      })),
    };
    return { status: 200, json, text: JSON.stringify(json) };
  };
  const expectStatus = (res, status) => {
    assert.equal(res.status, status);
    return res;
  };
  const result = await h.row.exercise(c, {
    request, expectStatus, cookie: "fake-session-A",
  });
  assert.deepEqual(visited, [
    "update_dependent", "update_enrollment", "GET",
  ]);
  assert.deepEqual(result, {
    forgedAdditionalIdsDenied: 2, ownHmoReadback: true,
    victimHmoUntouched: true, providerOrMoneyMovement: false,
  });
});

test("additional source checks fail if forged action succeeds or touches victim records", async () => {
  const h = await seededHarness(), c = h.ctxFor(0);
  await makeOwnWrite(h, c);
  let count = 0;
  await assert.rejects(() => h.row.exercise(c, {
    cookie: "synthetic",
    expectStatus: (r, s) => {
      assert.equal(r.status, s); return r;
    },
    request: async () => {
      if (++count === 1) {
        const [changed] = h.store.benefitDependents.filter(
          d => d.organizationId === c.victim.org.id);
        changed.status = "active";
      }
      return { status: 404, text: '{"error":"Not found."}',
        json: { error: "Not found." } };
    },
  }));
  assert.equal(h.store.benefitDependents
    .find(x => x.organizationId === c.victim.org.id).status, "active",
    "the test intentionally simulated a victim mutation to ensure rejection");
});

test("HMO route source keeps real organization and resource ID guards before writes", () => {
  const route = readFileSync("src/app/api/benefits/hmo/route.ts", "utf8");
  for (const clause of [
    'action === "create_plan"', "assertOrganizationRole(",
    "if (!access?.companyWide)", "recordAuditEvent(",
    'action === "add_dependent"', "eq(benefitEnrollments.organizationId, organizationId)",
    'action === "update_dependent"', "eq(benefitDependents.organizationId, organizationId)",
    'action === "update_enrollment"',
  ]) assert.ok(route.includes(clause), "route changed or omitted gate: " + clause);
  const source = readFileSync(
    "scripts/qa/tenant-table-rows/write/benefits-hmo.mjs", "utf8");
  assert.equal((source.match(/key: "POST benefits\/hmo"/g) ?? []).length, 1);
  for (const clause of ["victimSeeded.enrollmentId", "victimSeeded.dependentId",
    "auditBusinessSnapshot", "forgedAdditionalIdsDenied", "await state(c.victim.org.id)",
    "assert.deepEqual(after[field]", "providerOrMoneyMovement: false"]) {
    assert.ok(source.includes(clause), "missing source proof: " + clause);
  }
});
