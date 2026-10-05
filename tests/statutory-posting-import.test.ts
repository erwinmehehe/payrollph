import assert from "node:assert/strict";
import test from "node:test";
import {
  parseStatutoryPostingCsv,
  STATUTORY_POSTING_TEMPLATE,
} from "../src/lib/statutory-posting-import";

test("posting CSV parser accepts the normalized template", () => {
  const parsed = parseStatutoryPostingCsv(STATUTORY_POSTING_TEMPLATE);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.valid.length, 2);
  assert.equal(parsed.valid[0].employeeNo, "EMP-001");
  assert.equal(parsed.valid[0].postedAmount, 1500);
  assert.equal(parsed.valid[0].postingReference, "AGENCY-POST-0001");
  assert.match(parsed.hash, /^[a-f0-9]{64}$/);
});

test("posting CSV parser requires every reconciliation column", () => {
  const parsed = parseStatutoryPostingCsv([
    "employee_no,posted_amount",
    "EMP-001,1500",
  ].join("\n"));
  assert.equal(parsed.valid.length, 0);
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0].problems[0], /Missing required column/i);
});

test("posting CSV parser rejects duplicate employees in one file", () => {
  const parsed = parseStatutoryPostingCsv([
    "employee_no,posted_amount,posting_reference,posted_at",
    "EMP-001,1500,REF-0001,2026-10-05",
    "EMP-001,1500,REF-0002,2026-10-05",
  ].join("\n"));
  assert.equal(parsed.valid.length, 1);
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0].problems.join(" "), /Duplicate employeeNo/i);
});

test("posting CSV parser rejects negative and invalid amounts", () => {
  const parsed = parseStatutoryPostingCsv([
    "employee_no,posted_amount,posting_reference,posted_at",
    "EMP-001,-1,REF-0001,2026-10-05",
    "EMP-002,abc,REF-0002,2026-10-05",
  ].join("\n"));
  assert.equal(parsed.valid.length, 0);
  assert.equal(parsed.errors.length, 2);
  assert.match(parsed.errors[0].problems.join(" "), /cannot be negative/i);
  assert.match(parsed.errors[1].problems.join(" "), /not a number/i);
});

test("posting CSV parser supports quoted RFC-style fields", () => {
  const parsed = parseStatutoryPostingCsv([
    "employee_no,posted_amount,posting_reference,posted_at",
    '"EMP-001","1,500.00","REF,0001","2026-10-05"',
  ].join("\n"));
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.valid[0].postedAmount, 1500);
  assert.equal(parsed.valid[0].postingReference, "REF,0001");
});
