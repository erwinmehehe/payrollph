import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const time = readFileSync("src/components/workspace/time.tsx", "utf8");
const panel = readFileSync("src/components/workspace/attendance-exceptions-panel.tsx", "utf8");

test("time workspace surfaces the attendance exception center", () => {
  assert.ok(time.includes("AttendanceExceptionsPanel"));
  assert.ok(time.includes("organizationId={data.selectedOrganization.id}"));
});

test("attendance exception center calls verified employer- and range-bound workforce APIs", () => {
  const source = readFileSync("src/lib/attendance-exception-read.ts", "utf8");
  assert.ok(panel.includes("readVerifiedAttendanceAnalysis(organizationId, startDate, endDate"));
  assert.ok(panel.includes("readVerifiedAttendanceOperations(organizationId, startDate, endDate"));
  assert.ok(source.includes('fetcher("/api/workforce/"+path+"?"+search.toString()'));
  assert.ok(source.includes("organizationId:String(org),startDate:start,endDate:end"));
  assert.ok(source.includes('fetchVerified("attendance-exceptions"'));
  assert.ok(source.includes('fetchVerified("attendance-exception-events"'));
  assert.ok(source.includes('if(!verified)throw Error('));
});

test("attendance UI distinguishes blocking review from informational signals", () => {
  assert.ok(panel.includes('severity === "blocker"'));
  assert.ok(panel.includes('severity === "warning"'));
  assert.ok(panel.includes("Needs review"));
  assert.ok(panel.includes("All signals"));
});

test("attendance UI states that authorization cannot suppress statutory overtime", () => {
  assert.ok(panel.includes("never zeroes legally payable overtime"));
});
