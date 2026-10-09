import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateSchedulerLiveness } from "../src/lib/scheduler-liveness";

const now = new Date("2026-10-09T05:00:00.000Z");
const success = new Date("2026-10-09T04:58:00.000Z");
test("recent scheduler completion is healthy and has no tenant data",()=>{
  const x = evaluateSchedulerLiveness({now,lastSuccessfulRunAt:success,lastLeaseStatus:"completed"});
  assert.deepEqual(x,{ok:true,state:"healthy",lastSuccessfulRunAt:success.toISOString(),secondsSinceSuccess:120,lastLeaseStatus:"completed"});
});
test("unconfigured or never-started worker is unhealthy",()=>{
  const x = evaluateSchedulerLiveness({now,lastSuccessfulRunAt:null,lastLeaseStatus:null});
  assert.equal(x.ok,false); assert.equal(x.state,"never-ran");
});
test("stale tick is unhealthy even if a process or a stuck lease reports running",()=>{
  const x = evaluateSchedulerLiveness({now,lastSuccessfulRunAt:new Date("2026-10-09T04:00:00.000Z"),lastLeaseStatus:"running"});
  assert.equal(x.ok,false); assert.equal(x.state,"overdue");
});
test("failed lease run reports unhealthy even when a previous tick recently succeeded",()=>{
  const x = evaluateSchedulerLiveness({now,lastSuccessfulRunAt:success,lastLeaseStatus:"failed"});
  assert.equal(x.ok,false);assert.equal(x.state,"last-run-failed");
});
test("future timestamps and invalid timeout never report a healthy scheduler",()=>{
  assert.equal(evaluateSchedulerLiveness({now,lastSuccessfulRunAt:new Date("2026-10-09T05:01:00.000Z")}).state,"invalid-clock");
  assert.equal(evaluateSchedulerLiveness({now,lastSuccessfulRunAt:success,overdueAfterMs:0}).state,"invalid-clock");
});
test("monitor route requires a distinct read-only monitor token and never triggers scheduler work",()=>{
  const route=readFileSync("src/app/api/jobs/status/route.ts","utf8");
  assert.ok(route.includes("process.env.SCHEDULER_MONITOR_TOKEN?.trim()"));
  assert.ok(route.includes('constantTimeSecretEqual(expected, operationalSecret("worker"))'));
  assert.ok(route.includes('constantTimeSecretEqual(request.headers.get("x-scheduler-monitor-token"), expected)'));
  assert.ok(!route.includes('request.headers.get("x-worker-token")'));
  assert.ok(route.includes('status: state.ok ? 200 : 503'));
  assert.ok(!route.includes("tickScheduler("));
});
