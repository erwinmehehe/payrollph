import assert from "node:assert/strict";
import test from "node:test";
import { createRows } from "../scripts/qa/tenant-table-rows/read/year-end-report.mjs";

const [row] = createRows({ assert });
const context = rank => ({
  rank, marker: "TTBL-FICTIONAL-" + rank, workerId: 20 + rank,
  victim: { marker: "TTBL-VICTIM-HIGHER-ID" },
});
const own = context(1);
const second = context(2);

function evidence(c = own) {
  return { json: {
    taxYear: 2026, count: 1, totalRefund: 10 + c.rank, totalCollect: 0,
    rows: [{
      employeeId: c.workerId, employeeNo: c.marker, name: "Table " + c.marker,
      mwe: false, grossCompensation: (23_000 + c.rank).toFixed(2),
      taxableIncome: (23_000 + c.rank).toFixed(2), taxDue: "0.00",
      taxWithheld: (10 + c.rank).toFixed(2), adjustment: "-" + (10 + c.rank).toFixed(2),
      outcome: "refund", status: "computed", payrollRunId: null,
      approvedAt: null, settledAt: null,
    }],
  } };
}

test("year-end is a standalone default-profile JSON GET, not an annualization or export mutation", () => {
  assert.equal(row.key, "GET year-end");
  assert.equal(row.profile, undefined);
  assert.equal(row.deny ?? 403, 403);
  assert.equal(row.query(own), "taxYear=2026&format=json");
  assert.ok(typeof row.seed === "function" && typeof row.prove === "function");
  assert.equal(row.ownBody, undefined);
  row.prove(evidence(), own);
});

test("seed creates one fictional own adjustment without payroll runs, filings or approval", async () => {
  const inserted = [];
  const table = { name: "fictional-year-end-adjustments" };
  const db = { insert: found => {
    assert.equal(found, table);
    return { values: values => {
      inserted.push(structuredClone(values));
      return { returning: async () => [{ id: 77, ...values }] };
    } };
  } };
  const [fixture] = createRows({ assert, db, yearEndAdjustments: table });
  const employer = { org: { id: 11 }, worker: { id: 21 }, rank: 1, marker: own.marker };
  const seeded = await fixture.seed(employer);
  assert.equal(seeded.id, 77);
  assert.equal(seeded.organizationId, 11);
  assert.equal(seeded.employeeId, 21);
  assert.equal(seeded.taxYear, 2026);
  assert.equal(seeded.adjustment, "-11.00");
  assert.equal(seeded.status, "computed");
  assert.equal(seeded.payrollRunId, null);
  assert.deepEqual(inserted, [{
    organizationId: 11, employeeId: 21, taxYear: 2026,
    grossCompensation: "23001.00", taxableIncome: "23001.00",
    taxDue: "0.00", taxWithheld: "11.00", adjustment: "-11.00",
    outcome: "refund", status: "computed", mwe: false, payrollRunId: null,
    breakdown: { fixture: "tenant-year-end-read", fictional: true, marker: own.marker },
  }]);
});

test("own-positive evidence is employer-discriminating and refuses empty, swapped, or victim data", () => {
  row.prove(evidence(own), own);
  row.prove(evidence(second), second);
  assert.throws(() => row.prove(evidence(own), second));
  assert.throws(() => row.prove(evidence(second), own));
  const cases = [
    x => { x.json.rows = []; },
    x => { x.json.count = 0; },
    x => { x.json.rows[0].employeeId = 999; },
    x => { x.json.rows[0].employeeNo = second.marker; },
    x => { x.json.rows[0].name = "Other person"; },
    x => { x.json.rows[0].adjustment = "-99.00"; },
    x => { x.json.totalRefund = 0; },
    x => { x.json.totalCollect = 12; },
    x => { x.json.taxYear = 2025; },
    x => { x.json.rows[0].grossCompensation = "999999.00"; },
  ];
  for (const mutate of cases) {
    const x = evidence(); mutate(x);
    assert.throws(() => row.prove(x, own));
  }
});

test("rejects unapproved payroll, settlement, extra PII, or leaking victim marker", () => {
  const cases = [
    x => { x.json.rows[0].payrollRunId = 123; },
    x => { x.json.rows[0].status = "approved"; },
    x => { x.json.rows[0].approvedAt = "2026-10-27T00:00:00Z"; },
    x => { x.json.rows[0].settledAt = "2026-10-27T00:00:00Z"; },
    x => { x.json.rows[0].outcome = "collect"; },
    x => { x.json.rows[0].taxDue = "5.00"; },
    x => { x.json.rows[0].taxWithheld = "1.00"; },
    x => { x.json.rows[0].mwe = true; },
    x => { x.json.rows[0].tin = "123456789"; },
    x => { x.json.debug = own.victim.marker; },
    x => { x.json.rows[0].name = own.victim.marker; },
  ];
  for (const mutate of cases) {
    const x = evidence(); mutate(x);
    assert.throws(() => row.prove(x, own));
  }
});
