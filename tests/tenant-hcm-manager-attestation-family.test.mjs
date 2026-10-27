import assert from "node:assert/strict";
import test from "node:test";
import { createRows } from "../scripts/qa/tenant-table-rows/read/hcm-manager-attestation.mjs";

const [proof] = createRows({ assert });
const marker = rank => "TTBL-ATT" + rank + "-fictional";

function context(rank) {
  const ownMarker = marker(rank);
  const workerId = 100 + rank, managerId = 200 + rank;
  const positionId = 300 + rank, assignmentId = 400 + rank;
  return {
    orgId: 10 + rank, marker: ownMarker,
    victim: { marker: "TTBL-VICTIM-persisted" },
    seeded: {
      id: 500 + rank, attestationId: 600 + rank, workerId,
      managerId, managerNo: ownMarker + "-ATMAN",
      managerName: "Table " + ownMarker + "-ATMAN",
      statement: ownMarker + " fictional manager attestation; no approval or action",
      positionId, assignmentId,
      reportingLineSnapshot: {
        workerPositionAssignmentId: assignmentId,
        workerPositionId: positionId,
        workerPositionCode: ownMarker + "-ATT",
        assignmentEffectiveFrom: "2026-01-05", managerEmployeeId: managerId,
      },
    },
  };
}

function response(c) {
  const row = {
    id: c.seeded.attestationId, organizationId: c.orgId,
    decisionId: c.seeded.id, employeeId: c.seeded.workerId,
    workerPositionAssignmentId: c.seeded.assignmentId,
    workerPositionId: c.seeded.positionId,
    managerEmployeeId: c.seeded.managerId, managerUserId: null,
    managerName: c.seeded.managerName,
    recommendation: "needs_more_review", statement: c.seeded.statement,
    reportingLineSnapshot: structuredClone(c.seeded.reportingLineSnapshot),
    createdAt: "2026-10-27T08:00:00.000Z",
  };
  const json = {
    attestations: [row], canAttest: false,
    currentManager: { employeeId: c.seeded.managerId,
      employeeNo: c.seeded.managerNo, name: c.seeded.managerName,
      title: "Fictional" },
  };
  return { json, text: JSON.stringify(json) };
}

test("one uncredited path-ID GET uses exact HCM manager-attestation source method", () => {
  assert.equal(proof.key,
    "GET hcm/employment-term-decisions/[id]/manager-attestation");
  assert.deepEqual(proof.pathIds, { id: "id" });
  assert.deepEqual(proof.flags ?? [], []);
  assert.equal(proof.status ?? 200, 200);
  assert.equal(proof.deny ?? 403, 403);
  assert.equal(typeof proof.seed, "function");
  assert.equal(typeof proof.prove, "function");
  assert.equal(proof.ownBody, undefined);
  const own = context(1), victim = context(4);
  assert.ok(victim.seeded.id > own.seeded.id);
  assert.equal("/api/hcm/employment-term-decisions/" + own.seeded.id +
    "/manager-attestation?organizationId=" + own.orgId,
    "/api/hcm/employment-term-decisions/501/manager-attestation?organizationId=11");
});

test("fake DB preserves employer-bound relationships and never approves or applies a decision", async () => {
  let id = 1000;
  const records = [];
  const tables = Object.fromEntries([
    "jobProfiles", "positions", "positionAssignments", "hcmEmploymentTerms",
    "hcmEmploymentTermDecisions", "hcmEmploymentDecisionManagerAttestations",
  ].map(name => [name, { name }]));
  const db = { insert: table => ({
    values: value => ({
      returning: async () => {
        const item = { id: ++id, ...structuredClone(value) };
        records.push({ table: table.name, item });
        return [item];
      },
    }),
  }) };
  const workerAdds = [];
  const addWorker = async (_employer, suffix, opts) => {
    workerAdds.push({ suffix, opts });
    return { id: suffix === "ATWORK" ? 151 : 152 };
  };
  const [row] = createRows({ assert, db, addWorker, rowTables: tables });
  const employer = {
    org: { id: 71 }, entity: { id: 81 }, unit: { id: 91 },
    owner: { id: 101, name: "Fictional owner" },
    marker: "TTBL-ATTA-persisted",
  };
  const seeded = await row.seed(employer);
  assert.deepEqual(workerAdds, [
    { suffix: "ATWORK", opts: { payProfile: false } },
    { suffix: "ATMAN", opts: { payProfile: false } },
  ]);
  assert.deepEqual(records.map(r => r.table), [
    "jobProfiles", "positions", "positionAssignments", "hcmEmploymentTerms",
    "hcmEmploymentTermDecisions", "hcmEmploymentDecisionManagerAttestations",
  ]);
  const at = name => records.find(r => r.table === name).item;
  assert.equal(at("positions").managerEmployeeId, 152);
  assert.equal(at("positions").organizationId, 71);
  assert.equal(at("positionAssignments").employeeId, 151);
  assert.equal(at("positionAssignments").positionId, at("positions").id);
  assert.equal(at("hcmEmploymentTerms").employeeId, 151);
  assert.equal(at("hcmEmploymentTerms").status, "active");
  assert.equal(at("hcmEmploymentTermDecisions").status, "pending_approval");
  assert.equal(at("hcmEmploymentTermDecisions").decisionKind, "continue_current");
  assert.equal(at("hcmEmploymentTermDecisions").employmentTermId,
    at("hcmEmploymentTerms").id);
  assert.equal(at("hcmEmploymentTermDecisions").requestedByUserId, 101);
  assert.equal(at("hcmEmploymentDecisionManagerAttestations").decisionId,
    at("hcmEmploymentTermDecisions").id);
  assert.equal(at("hcmEmploymentDecisionManagerAttestations").organizationId, 71);
  assert.equal(at("hcmEmploymentDecisionManagerAttestations").managerEmployeeId, 152);
  assert.equal(at("hcmEmploymentDecisionManagerAttestations").managerUserId, null);
  assert.equal(at("hcmEmploymentDecisionManagerAttestations").recommendation,
    "needs_more_review");
  assert.deepEqual(at("hcmEmploymentDecisionManagerAttestations").reportingLineSnapshot,
    seeded.reportingLineSnapshot);
  assert.equal(seeded.id, at("hcmEmploymentTermDecisions").id);
  assert.equal(seeded.attestationId, at("hcmEmploymentDecisionManagerAttestations").id);
  assert.ok(records.every(r => r.item.organizationId === 71),
    "all persisted fixture tables must be employer-bound");
});

test("own response needs real attestation and distinct reporting-line evidence", () => {
  const first = context(1), second = context(2);
  proof.prove(response(first), first);
  proof.prove(response(second), second);
  assert.throws(() => proof.prove(response(first), second));
  assert.throws(() => proof.prove(response(second), first));
});

test("forged worker, manager, decision, and approval responses are rejected", () => {
  const first = context(1), second = context(2);
  const mutations = [
    b => { b.attestations = []; },
    b => { b.canAttest = true; },
    b => { b.currentManager = null; },
    b => { b.currentManager.employeeId = second.seeded.managerId; },
    b => { b.currentManager.employeeNo = second.seeded.managerNo; },
    b => { b.attestations[0].id = second.seeded.attestationId; },
    b => { b.attestations[0].organizationId = second.orgId; },
    b => { b.attestations[0].decisionId = second.seeded.id; },
    b => { b.attestations[0].employeeId = second.seeded.workerId; },
    b => { b.attestations[0].managerUserId = 555; },
    b => { b.attestations[0].managerEmployeeId = second.seeded.managerId; },
    b => { b.attestations[0].statement = second.seeded.statement; },
    b => { b.attestations[0].recommendation = "support"; },
    b => { b.attestations[0].reportingLineSnapshot.managerEmployeeId = 9999; },
    b => { b.attestations[0].reportingLineSnapshot.workerPositionId = 9999; },
    b => { b.attestations[0].secretGovernmentId = "000000000"; },
    b => { b.secret = "bank account"; },
    b => { b.attestations[0].statement = first.victim.marker; },
  ];
  for (const mutate of mutations) {
    const forged = response(first);
    mutate(forged.json);
    forged.text = JSON.stringify(forged.json);
    assert.throws(() => proof.prove(forged, first));
  }
});

test("serialized victim data is rejected even when the parsed response is otherwise valid", () => {
  const own = context(1);
  const result = response(own);
  result.text += own.victim.marker;
  assert.throws(() => proof.prove(result, own));
});
