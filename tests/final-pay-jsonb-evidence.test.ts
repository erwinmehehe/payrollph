import assert from "node:assert/strict";
import test from "node:test";
import { sameFinalPaySource } from "../src/lib/final-pay-source-fingerprint";

const source = () => ({
  employeeStatus: "Separating",
  leave: { balances: [{ id: 1, used: "4", pending: "2" }],
    policies: [{ id: 2, conversionCap: 5 }],
    conversions: [{ id: 3, daysConverted: "2", createdAt: new Date("2026-09-01T00:00:00Z") }] },
  payProfile: { rateAmount: 22000, updatedAt: "2026-01-01T00:00:00Z" },
  released: [{ runId: 4, trace: { payment: { bankCode: "QA", bankAccount: "synthetic-envelope" } } }],
});
function reorder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorder);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).reverse().map(([key, child]) => [key, reorder(child)]),
  );
  return value;
}
test("JSONB object order and serialized Dates do not stale unchanged final-pay evidence", () => {
  const current = source();
  const stored = reorder(JSON.parse(JSON.stringify(current)));
  assert.notEqual(JSON.stringify(current), JSON.stringify(stored));
  assert.equal(sameFinalPaySource(stored, current), true);
  assert.equal(sameFinalPaySource({ "é": 1, "e\u0301": 2 }, { "e\u0301": 2, "é": 1 }), true);
});
test("comparison still rejects financial, employment, timestamp and payment source changes", () => {
  const frozen = JSON.parse(JSON.stringify(source()));
  for (const change of [
    (s: ReturnType<typeof source>) => { s.leave.balances[0].used = "5"; },
    (s: ReturnType<typeof source>) => { s.leave.policies[0].conversionCap = 6; },
    (s: ReturnType<typeof source>) => { s.leave.conversions[0].daysConverted = "1"; },
    (s: ReturnType<typeof source>) => { s.leave.conversions[0].createdAt = new Date("2026-09-02T00:00:00Z"); },
    (s: ReturnType<typeof source>) => { s.payProfile.rateAmount = 23000; },
    (s: ReturnType<typeof source>) => { s.employeeStatus = "Active"; },
    (s: ReturnType<typeof source>) => { s.released[0].trace.payment.bankAccount = "different-envelope"; },
  ]) {
    const changed = source(); change(changed);
    assert.equal(sameFinalPaySource(frozen, changed), false);
  }
  assert.equal(sameFinalPaySource({ entries: [1, 2] }, { entries: [2, 1] }), false);
  assert.equal(sameFinalPaySource({ amount: 2 }, { amount: "2" }), false);
  assert.equal(sameFinalPaySource(null, source()), false);
  assert.equal(sameFinalPaySource(undefined, source()), false);
});
