import assert from "node:assert/strict";
import test from "node:test";
import {
  manualPostingEvidenceHash,
  postingEvidenceSourceLabel,
} from "../src/lib/statutory-posting-evidence";

test("manual posting evidence hash is deterministic", () => {
  const input = {
    organizationId: 1,
    batchId: 2,
    memberId: 3,
    postingReference: " REF-001 ",
    postedAmount: 1234.5,
    postedAt: "2026-10-05T10:00:00+08:00",
  };
  assert.equal(manualPostingEvidenceHash(input), manualPostingEvidenceHash(input));
  assert.match(manualPostingEvidenceHash(input), /^[a-f0-9]{64}$/);
});

test("manual evidence hash changes when amount or reference changes", () => {
  const base = {
    organizationId: 1,
    batchId: 2,
    memberId: 3,
    postingReference: "REF-001",
    postedAmount: 1234.5,
    postedAt: "2026-10-05T02:00:00.000Z",
  };
  assert.notEqual(
    manualPostingEvidenceHash(base),
    manualPostingEvidenceHash({ ...base, postedAmount: 1234.51 }),
  );
  assert.notEqual(
    manualPostingEvidenceHash(base),
    manualPostingEvidenceHash({ ...base, postingReference: "REF-002" }),
  );
});

test("source labels make manual and imported confirmation distinct", () => {
  assert.equal(postingEvidenceSourceLabel("csv_import"), "Imported agency evidence");
  assert.equal(postingEvidenceSourceLabel("manual_confirmation"), "Manual payroll confirmation");
  assert.equal(postingEvidenceSourceLabel(null), "Evidence source unavailable");
});
