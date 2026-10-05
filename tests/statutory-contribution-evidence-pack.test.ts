import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContributionEvidencePack,
  evidenceHash,
} from "../src/lib/statutory-contribution-evidence-pack";

test("evidence hash is stable regardless of object key insertion order", () => {
  const first = evidenceHash({
    agency: "SSS",
    month: "2026-09",
    totals: { employee: 750, employer: 1530 },
  });
  const second = evidenceHash({
    totals: { employer: 1530, employee: 750 },
    month: "2026-09",
    agency: "SSS",
  });
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test("evidence hash changes when contribution evidence changes", () => {
  const original = evidenceHash({
    postingReference: "POST-001",
    postedAmount: 2280,
  });
  const changed = evidenceHash({
    postingReference: "POST-001",
    postedAmount: 2200,
  });
  assert.notEqual(original, changed);
});

test("pack appends hash without mutating source payload", () => {
  const payload = {
    schemaVersion: "v1",
    agency: "Pag-IBIG",
    payrollEvidence: [{ employeeShareDeducted: 200 }],
  };
  const pack = buildContributionEvidencePack(payload);
  assert.equal("evidenceHashSha256" in payload, false);
  assert.match(pack.evidenceHashSha256, /^[a-f0-9]{64}$/);
});
