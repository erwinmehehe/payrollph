import assert from "node:assert/strict";
import test from "node:test";
import { createRows } from "../scripts/qa/tenant-table-rows/write/spend-review.mjs";

const rows = createRows({ assert });
const own = {
  orgId: 11, workerId: 21, rank: 1, marker: "Fictional-SPEND-A",
  owner: { id: 31, name: "Fictional owner" },
  seeded: { id: 41, claimId: 51, submitterId: 71 },
  victim: { org: { id: 99 }, worker: { id: 109 } },
  victimSeeded: { id: 141, claimId: 151, submitterId: 171 },
};

function evidence(key) {
  const prior = { id: 1, organizationId: 11, actor: "Earlier", action: "Unrelated", resource: "earlier", metadata: {} };
  const card = { id: 41, organizationId: 11, employeeId: 21, issuer: "Legacy", lastFour: "9000", reference: "legacy", status: "registered" };
  const result = { cards: [card], transactions: [], reports: [], items: [], claims: [], audit: [prior] };
  let after, json;
  if (key === "POST spend") {
    const registered = { id: 81, organizationId: 11, employeeId: 21,
      issuer: own.marker + " fictional issuer", lastFour: "4201", reference: own.marker + "-new-card", status: "registered" };
    after = { ...result, cards: [card, registered], audit: [prior, {
      id: 2, organizationId: 11, actor: own.owner.name, action: "Corporate card registered (metadata only)",
      resource: "81", metadata: { cardId: 81, employeeId: 21 },
    }] };
    json = registered;
  } else {
    const claim = { id: 51, organizationId: 11, employeeId: 21, status: "pending",
      amount: "150.00", submittedByUserId: 71, decidedBy: null };
    const report = { id: 41, organizationId: 11, employeeId: 21, status: "submitted",
      title: own.marker + " fictional report", totalAmount: "150.00", submittedByUserId: 71,
      decidedByUserId: null, decidedAt: null, decisionNote: null };
    const item = { id: 61, organizationId: 11, reportId: 41, claimId: 51 };
    result.reports = [report]; result.claims = [claim]; result.items = [item];
    const rejected = { ...report, status: "rejected", decidedByUserId: 31,
      decidedAt: "2026-10-26T00:00:00.000Z", decisionNote: own.marker + " fictional decision" };
    after = { ...result, reports: [rejected], claims: [{ ...claim, status: "rejected", decidedBy: own.owner.name }],
      audit: [prior, { id: 2, organizationId: 11, actor: own.owner.name, action: "Expense report rejected",
        resource: "41", metadata: { reportId: 41, employeeId: 21, decidedByUserId: 31 } }] };
    json = rejected;
  }
  return { before: structuredClone(result), after: structuredClone(after), response: { json: structuredClone(json) } };
}

test("Spend family contains two unique uncredited write methods", () => {
  assert.deepEqual(rows.map(row => row.key), ["POST spend", "PATCH spend"]);
  assert.ok(rows.every(row => row.state && row.seed && row.expect && row.ownBody && row.foreignBody));
});

for (const row of rows) {
  test(row.key + " accepts exact owned persisted evidence, rejects foreign/no-op/swapped proofs", () => {
    const sample = evidence(row.key);
    row.expect(sample.before, sample.after, own, sample.response);
    assert.throws(() => row.expect(sample.before, sample.before, own, sample.response));
    assert.throws(() => row.expect(sample.before, sample.after, { ...own, orgId: 99 }, sample.response));
    assert.throws(() => row.expect(sample.before, sample.after, own, { json: {} }));
    const foreign = structuredClone(sample.after);
    if (row.key === "POST spend") foreign.cards.at(-1).organizationId = 99;
    else foreign.reports[0].organizationId = 99;
    assert.throws(() => row.expect(sample.before, foreign, own, sample.response));
  });
  test(row.key + " denies victim selectors and forged references without relying on guessed IDs", () => {
    const legitimate = row.ownBody(own), victim = row.foreignBody(own);
    assert.notDeepEqual(legitimate, victim);
    assert.equal(row.forged.status, row.key === "POST spend" ? 404 : 403);
    const forged = row.forged.body(own);
    assert.notDeepEqual(forged, legitimate);
    assert.equal(row.key === "POST spend" ? forged.employeeId : forged.id,
      row.key === "POST spend" ? own.victim.worker.id : own.victimSeeded.id);
    if (row.key === "POST spend") {
      assert.equal(victim.organizationId, 99);
      assert.equal(forged.organizationId, 11);
    } else {
      assert.equal(victim.id, 141);
      assert.equal(forged.organizationId, 11);
    }
  });
  test(row.key + " refuses missing, forged, or rewritten audit history", () => {
    const sample = evidence(row.key);
    for (const mutate of [
      s => { s.after.audit.pop(); },
      s => { s.after.audit.at(-1).actor = "Foreign owner"; },
      s => { s.after.audit.at(-1).organizationId = 99; },
      s => { s.after.audit.at(-1).metadata = {}; },
      s => { s.after.audit[0].resource = "rewritten"; },
    ]) {
      const e = structuredClone(sample); mutate(e);
      assert.throws(() => row.expect(e.before, e.after, own, e.response));
    }
  });
  test(row.key + " leaves unrelated money and employer rows untouched", () => {
    const sample = evidence(row.key);
    const e = structuredClone(sample);
    e.after.transactions.push({ id: 999, organizationId: 11, amount: "100.00" });
    assert.throws(() => row.expect(e.before, e.after, own, e.response));
    const f = structuredClone(sample);
    if (row.key === "POST spend") f.after.claims.push({ id: 88, organizationId: 11 });
    else f.after.cards[0].status = "closed";
    assert.throws(() => row.expect(f.before, f.after, own, f.response));
  });
}

test("report rejection preserves claim monetary value, maker/checker identity, and audit binding", () => {
  const row = rows.find(entry => entry.key === "PATCH spend");
  for (const mutate of [
    e => { e.after.claims[0].amount = "100.00"; },
    e => { e.after.reports[0].totalAmount = "100.00"; },
    e => { e.after.reports[0].submittedByUserId = 31; },
    e => { e.after.reports[0].decidedByUserId = 71; },
    e => { e.after.reports[0].status = "approved"; },
    e => { e.after.claims[0].status = "approved"; },
    e => { e.after.items[0].claimId = 999; },
  ]) {
    const e = evidence("PATCH spend"); mutate(e);
    assert.throws(() => row.expect(e.before, e.after, own, e.response));
  }
});
