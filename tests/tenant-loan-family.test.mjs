import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRows } from "../scripts/qa/tenant-table-rows/write/loans.mjs";
import { tenantFamilyCatalog } from "../scripts/qa/tenant-table-catalog.mjs";

const rows = createRows({ assert });
const c = { orgId: 11, workerId: 21, owner: { id: 31, name: "Fictional owner" }, marker: "Fictional-own",
  seeded: { id: 41 }, victim: { org: { id: 99 }, worker: { id: 199 } }, victimSeeded: { id: 101 } };
function evidence(key) {
  const existing = { id: 41, organizationId: 11, employeeId: 21, loanType: "Company Emergency Loan", referenceNo: c.marker + "-PAUSE",
    status: "active", principal: "1500.00", remainingBalance: "1000.00", totalPaid: "500.00", requestedByUserId: 31,
    deductionAuthorizationReference: "Fictional historical authority",
    reviewedByUserId: 32, reviewedAt: "2026-01-05T00:00:00.000Z",
    reviewEvidenceReference: c.marker + " fictional independent review evidence",
    reviewReason: c.marker + " fictitious historical reviewer acceptance" };
  const before = { loans: [existing], payments: [{ payment: { id: 51, loanId: 41, amount: "500.00" } }],
    runs: [{ id: 61 }], entries: [{ entry: { id: 62, payrollRunId: 61, netPay: "20000.00" } }], workers: [{ id: 21 }],
    profiles: [{ id: 71, organizationId: 11, employeeId: 21, rateAmount: "20000.00" }], revisions: [{ id: 81 }],
    audits: [{ id: 1, organizationId: 11, action: "Prior evidence", metadata: { retained: true } }] };
  const after = structuredClone(before);
  let payload, metadata, action, resource;
  if (key === "POST loans") {
    const body = rows[0].ownBody(c), { organizationId, employeeId, loanType, referenceNo, deductionAuthorizationReference, principal,
      monthlyAmortization, cutoffDeduction, startDate, endDate, notes } = body;
    const row = { id: 91, organizationId, employeeId, loanType, referenceNo, deductionAuthorizationReference, principal, monthlyAmortization,
      cutoffDeduction, startDate, endDate, notes, requestedByUserId: 31, remainingBalance: principal, totalPaid: "0.00", status: "pending_approval",
      reviewedByUserId: null, reviewedAt: null, reviewEvidenceReference: null, reviewReason: null };
    after.loans.push(row); payload = { ...row, nextAction: "Independent payroll checker must verify the source authorization." };
    metadata = { loanId: 91, employeeId: 21, makerUserId: 31, externalReference: referenceNo, sourceAuthorizationReference: deductionAuthorizationReference,
      principal, monthlyAmortization, cutoffDeduction, startDate, endDate, activated: false };
    action = "Employee loan deduction submitted for independent review"; resource = "Company Emergency Loan #91";
  } else {
    after.loans[0].status = "paused"; payload = { id: 41, action: "pause", status: "paused", paymentAmount: null };
    metadata = { loanId: 41, employeeId: 21, previousStatus: "active", actorUserId: 31, makerUserId: 31,
      originalAuthorizationReference: existing.deductionAuthorizationReference, pauseReason: c.marker + " fictional precautionary pause", nextStatus: "paused" };
    action = "Employee loan: pause"; resource = "Company Emergency Loan #41";
  }
  after.audits.push({ id: 92, organizationId: 11, actor: c.owner.name, action, resource, metadata });
  return { before, after, response: { json: structuredClone(payload) } };
}

for (const row of rows) {
  test(row.key + " requires real own persisted changes and rejects no-op, foreign and swapped evidence", () => {
    const e = evidence(row.key); row.expect(e.before, e.after, c, e.response);
    assert.throws(() => row.expect(e.before, e.before, c, e.response));
    assert.throws(() => row.expect(e.before, e.after, { ...c, orgId: 99 }, e.response));
    assert.throws(() => row.expect(e.before, e.after, { ...c, workerId: 199 }, e.response));
    assert.throws(() => row.expect(e.before, e.after, c, { json: {} }));
    const bad = structuredClone(e.after); bad.loans.at(-1).organizationId = 99;
    assert.throws(() => row.expect(e.before, bad, c, e.response));
  });
  test(row.key + " preserves payments, payroll entries/runs, worker pay profiles and revisions", () => {
    for (const field of ["payments", "runs", "entries", "workers", "profiles", "revisions"]) {
      const e = evidence(row.key); e.after[field][0].tampered = true;
      assert.throws(() => row.expect(e.before, e.after, c, e.response), field);
    }
    const e = evidence(row.key); e.before.profiles = []; e.after.profiles = [];
    assert.throws(() => row.expect(e.before, e.after, c, e.response), /existing pay profile/);
  });
  test(row.key + " binds exact audit actor/employer/metadata while retaining prior audit history", () => {
    for (const change of [e => e.after.audits.pop(), e => { e.after.audits[0].metadata.retained = false; },
      ...["actor", "organizationId", "resource", "action", "metadata"].map(field => e => { e.after.audits.at(-1)[field] = "foreign"; })]) {
      const e = evidence(row.key); change(e); assert.throws(() => row.expect(e.before, e.after, c, e.response));
    }
  });
  test(row.key + " names genuine victim employer/resource IDs", () => {
    const own = row.ownBody(c), foreign = row.foreignBody(c);
    if (row.key.startsWith("POST")) {
      assert.equal(own.organizationId, 11); assert.equal(own.employeeId, 21); assert.equal(foreign.organizationId, 99); assert.equal(foreign.employeeId, 199);
      assert.equal(row.forged.body(c).organizationId, 11); assert.equal(row.forged.body(c).employeeId, 199); assert.equal(row.forged.status, 409);
    } else { assert.equal(own.id, 41); assert.equal(foreign.id, 101); assert.equal(foreign.action, "pause"); }
  });
}

test("pending request proof refuses activation, approval, reduced balances and changed source authority", () => {
  const row = rows[0];
  for (const field of ["status", "reviewedByUserId", "reviewedAt", "reviewEvidenceReference", "reviewReason", "principal", "remainingBalance", "totalPaid", "cutoffDeduction", "deductionAuthorizationReference"]) {
    const e = evidence(row.key); e.after.loans.at(-1)[field] = "tampered"; e.response.json[field] = "tampered";
    assert.throws(() => row.expect(e.before, e.after, c, e.response));
  }
});

test("pause changes only status and cannot invent payment evidence or alter loan amounts", () => {
  const row = rows[1];
  for (const field of ["principal", "remainingBalance", "totalPaid", "requestedByUserId", "deductionAuthorizationReference",
    "reviewedByUserId", "reviewedAt", "reviewEvidenceReference", "reviewReason"]) {
    const e = evidence(row.key); e.after.loans[0][field] = "tampered"; assert.throws(() => row.expect(e.before, e.after, c, e.response));
  }
  const e = evidence(row.key); e.before.payments = []; e.after.payments = [];
  assert.throws(() => row.expect(e.before, e.after, c, e.response), /repayment evidence/);
});

test("pause seed binds real returned loan/payment IDs to the employer/worker without activating through HTTP", async () => {
  const employeeLoans = Symbol("loans"), loanPayments = Symbol("payments");
  const users = Symbol("users"), userOrganizations = Symbol("memberships"), inserts = [];
  const ids = new Map([[users, 32], [userOrganizations, 33], [employeeLoans, 41], [loanPayments, 51]]);
  const db = { insert: table => ({ values: value => {
    inserts.push({ table, value });
    return { returning: async () => [{ ...value, id: ids.get(table) }] };
  } }) };
  const row = createRows({ assert, db, employeeLoans, loanPayments, users, userOrganizations })[1];
  const seed = await row.seed({ org: { id: 11 }, worker: { id: 21 }, owner: c.owner, marker: c.marker });
  assert.equal(seed.id, 41); assert.equal(seed.organizationId, 11); assert.equal(seed.employeeId, 21);
  assert.equal(seed.status, "active"); assert.equal(seed.remainingBalance, "1000.00"); assert.equal(seed.totalPaid, "500.00");
  assert.equal(inserts.length, 4);
  assert.equal(inserts[0].table, users); assert.equal(inserts[0].value.role, "checker");
  assert.equal(inserts[1].table, userOrganizations);
  assert.equal(inserts[1].value.organizationId, 11); assert.equal(inserts[1].value.userId, 32);
  assert.equal(inserts[1].value.active, true);
  assert.equal(seed.requestedByUserId, c.owner.id); assert.equal(seed.reviewedByUserId, 32);
  assert.notEqual(seed.reviewedByUserId, seed.requestedByUserId);
  assert.ok(seed.reviewEvidenceReference.includes(c.marker)); assert.ok(seed.reviewedAt instanceof Date);
  assert.equal(inserts[2].table, employeeLoans);
  assert.equal(inserts[3].table, loanPayments); assert.equal(inserts[3].value.loanId, 41); assert.equal(inserts[3].value.amount, "500.00");
  assert.equal(row.ownBody(c).action, "pause");
});

test("Loan targets are unique, retain GAP and never change activation flags", () => {
  const catalog = tenantFamilyCatalog("write"), manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  for (const row of rows) {
    assert.equal(catalog.filter(item => item.key === row.key).length, 1);
    const [method, route] = row.key.split(" "), record = Object.values(manifest.allApiRouteFiles).find(item => item.route === route);
    assert.equal(record.methods.find(item => item.name === method).status, "GAP");
    assert.equal(row.flags, undefined);
  }
  assert.doesNotMatch(readFileSync("scripts/qa/tenant-table-rows/write/loans.mjs", "utf8"), /process\.env|action:\s*["'](?:approve|resume|record_payment)["']/);
});
