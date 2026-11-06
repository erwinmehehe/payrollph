import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePayrollAssurance, NEW_PAYOUT_DESTINATION_DAYS, NEW_PAYOUT_LARGE_NET } from "../src/lib/payroll-assurance";

const entry = (id: number, employeeId: number, net: number) => ({
  id, employeeId, grossPay: net + 1000, deductions: 1000, netPay: net, status: "Ready",
  lineItems: [{ code: "BASIC", label: "Basic", amount: net + 1000 }, { code: "SSS", label: "SSS", amount: -1000 }],
  trace: { inputs: ["punches=10", "payBasis=monthly"] },
});
const staff = (id: number, extra: Record<string, unknown> = {}) => ({
  id, employeeNo: "E-" + id, status: "Active", startDate: "2025-01-01", bankAccount: "x", bankCode: "BPI", ...extra,
});
const codes = (assurance: ReturnType<typeof evaluatePayrollAssurance>, code: string) =>
  assurance.findings.filter((finding) => finding.code === code);
const context = (employees: ReturnType<typeof staff>[]) => ({ periodStart: "2026-10-01", periodEnd: "2026-10-15", payDate: "2026-10-15", employees });

test("two paid employees sharing one payout destination are flagged for each other, never blocking, never printing the account", () => {
  const result = evaluatePayrollAssurance(
    [entry(1, 1, 20000), entry(2, 2, 21000), entry(3, 3, 22000)], [],
    context([staff(1, { payoutFingerprint: "fp-A" }), staff(2, { payoutFingerprint: "fp-A" }), staff(3, { payoutFingerprint: "fp-B" })]),
  );
  const duplicates = codes(result, "DUPLICATE_PAYEE_ACCOUNT");
  assert.deepEqual(duplicates.map((finding) => finding.employeeId).sort(), [1, 2], "exactly the two sharing a destination");
  assert.ok(duplicates.every((finding) => finding.severity === "high" && !finding.blocking), "acknowledgeable, not blocking");
  assert.match(duplicates.find((finding) => finding.employeeId === 1)!.detail, /E-2/);
  assert.doesNotMatch(JSON.stringify(duplicates), /fp-A/, "the fingerprint is never exposed");
  assert.equal(result.summary.blocking, 0);
});

test("a shared destination is not flagged for a zero-net employee, a distinct destination or a missing fingerprint", () => {
  const entries = [entry(1, 1, 20000), entry(2, 2, 0), entry(3, 3, 20000), entry(4, 4, 20000)];
  const result = evaluatePayrollAssurance(entries, [], context([
    staff(1, { payoutFingerprint: "fp-A" }), staff(2, { payoutFingerprint: "fp-A" }),
    staff(3, { payoutFingerprint: null }), staff(4, { payoutFingerprint: null }),
  ]));
  assert.equal(codes(result, "DUPLICATE_PAYEE_ACCOUNT").length, 0);
});

test("a destination changed within 30 days before pay day flags a large net or a sharp jump, and nothing else", () => {
  const previous = (id: number, employeeId: number, net: number) => entry(id, employeeId, net);
  const run = (netNow: number, netBefore: number | null, changedOn: string | null) => evaluatePayrollAssurance(
    [entry(1, 1, netNow)], netBefore == null ? [] : [previous(9, 1, netBefore)],
    context([staff(1, { payoutChangedOn: changedOn })]),
  );
  // Large net, account changed 5 days before pay day.
  const large = codes(run(NEW_PAYOUT_LARGE_NET, null, "2026-10-10"), "NEW_PAYOUT_DESTINATION_LARGE_PAY");
  assert.equal(large.length, 1);
  assert.equal(large[0].severity, "high");
  assert.ok(!large[0].blocking);
  assert.match(large[0].detail, /5 day\(s\) before pay day/);
  // Sharp jump: +6,000 and +30%.
  assert.equal(codes(run(26000, 20000, "2026-10-10"), "NEW_PAYOUT_DESTINATION_LARGE_PAY").length, 1);
  // Below the large-net and jump thresholds.
  assert.equal(codes(run(26000, 25000, "2026-10-10"), "NEW_PAYOUT_DESTINATION_LARGE_PAY").length, 0, "small change");
  assert.equal(codes(run(30000, 28000, "2026-10-10"), "NEW_PAYOUT_DESTINATION_LARGE_PAY").length, 0, "no jump, modest net");
  // Old change, future-dated change, no change.
  assert.equal(codes(run(NEW_PAYOUT_LARGE_NET, null, "2026-09-14"), "NEW_PAYOUT_DESTINATION_LARGE_PAY").length, 0, "31 days ago");
  assert.equal(codes(run(NEW_PAYOUT_LARGE_NET, null, "2026-09-15"), "NEW_PAYOUT_DESTINATION_LARGE_PAY").length, 1, `exactly ${NEW_PAYOUT_DESTINATION_DAYS} days ago`);
  assert.equal(codes(run(NEW_PAYOUT_LARGE_NET, null, "2026-10-20"), "NEW_PAYOUT_DESTINATION_LARGE_PAY").length, 0, "future-dated change");
  assert.equal(codes(run(NEW_PAYOUT_LARGE_NET, null, null), "NEW_PAYOUT_DESTINATION_LARGE_PAY").length, 0, "no change recorded");
});
