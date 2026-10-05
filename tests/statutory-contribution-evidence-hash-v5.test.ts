import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContributionEvidencePack,
  evidenceHash,
} from "../src/lib/statutory-contribution-evidence-pack";

test("evidence hash is deterministic regardless of object key order", () => {
  const a = evidenceHash({ z: 1, a: { c: 3, b: 2 } });
  const b = evidenceHash({ a: { b: 2, c: 3 }, z: 1 });
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test("evidence hash changes when evidence changes", () => {
  assert.notEqual(
    evidenceHash({ amount: 100, status: "confirmed" }),
    evidenceHash({ amount: 101, status: "confirmed" }),
  );
});

test("evidence pack includes its SHA-256 evidence hash", () => {
  const pack = buildContributionEvidencePack({
    case: { id: 1 },
    timeline: [{ event: "reported" }],
  });
  assert.match(pack.evidenceHashSha256, /^[a-f0-9]{64}$/);
});

test("unsupported and non-finite values fail closed", () => {
  assert.throws(() => evidenceHash({ amount: Number.NaN }), /non-finite/i);
  assert.throws(() => evidenceHash({ value: BigInt(1) }), /unsupported/i);
});
