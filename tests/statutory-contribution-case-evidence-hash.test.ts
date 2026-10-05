import assert from "node:assert/strict";
import test from "node:test";
import { evidenceHash } from "../src/lib/statutory-contribution-evidence-pack";

test("database JSON snapshots hash deterministically even when object key order changes", () => {
  const first = evidenceHash({
    memberFound: true,
    posting: { status: "pending", amount: null },
    reference: "CASE-1",
  });
  const second = evidenceHash({
    reference: "CASE-1",
    posting: { amount: null, status: "pending" },
    memberFound: true,
  });
  assert.equal(first, second);
});

test("undefined values are excluded while unsupported values fail closed", () => {
  const withUndefined = evidenceHash({ agency: "SSS", optional: undefined });
  const withoutUndefined = evidenceHash({ agency: "SSS" });
  assert.equal(withUndefined, withoutUndefined);
  assert.throws(() => evidenceHash({ bad: () => "x" }), /unsupported value type/i);
});
