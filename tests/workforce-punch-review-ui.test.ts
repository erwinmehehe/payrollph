import assert from "node:assert/strict";
import test from "node:test";
import {canApproveReviewedPunch,punchTimestampGapMinutes,validReviewTimeSource}
  from "../src/lib/workforce-punch-review-ui";

test("human reviewer must explicitly select device or server timestamp",()=>{
  assert.equal(validReviewTimeSource(""),false);
  assert.equal(validReviewTimeSource(undefined),false);
  assert.equal(validReviewTimeSource("automatic"),false);
  assert.equal(canApproveReviewedPunch("Employee work checked",undefined,false),false);
  assert.equal(canApproveReviewedPunch("Employee work checked","",false),false);
  assert.equal(canApproveReviewedPunch("short","server",false),false);
  assert.equal(canApproveReviewedPunch("Employee work checked","device",true),false);
  assert.equal(canApproveReviewedPunch("Employee work checked","device",false),true);
  assert.equal(canApproveReviewedPunch("Employee work checked","server",false),true);
});
test("offline skew is visible but cannot decide payroll automatically",()=>{
  assert.equal(punchTimestampGapMinutes("2026-10-12T01:00:00.000Z","2026-10-12T01:31:00.000Z"),31);
  assert.equal(punchTimestampGapMinutes("2026-10-12T01:31:00.000Z","2026-10-12T01:00:00.000Z"),31);
  assert.equal(punchTimestampGapMinutes("not a timestamp","2026-10-12T01:00:00.000Z"),null);
});
