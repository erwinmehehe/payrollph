import assert from "node:assert/strict";
import test from "node:test";
import { validateStagingTarget, checkSchedulerResponse, main } from "../scripts/check-scheduler-staging-health.mjs";

const proofTime = new Date("2026-10-09T00:01:30.000Z");
const healthy = {
  ok: true, state: "healthy",
  lastSuccessfulRunAt: "2026-10-09T00:00:00.000Z",
  secondsSinceSuccess: 90, lastLeaseStatus: "completed",
};

test("requires HTTPS exact staging host and refuses a production host", () => {
  assert.equal(validateStagingTarget("https://staging.example.test/","staging.example.test",
    "prod.example.test").pathname,"/api/jobs/status");
  assert.throws(()=>validateStagingTarget("http://staging.example.test/","staging.example.test","prod.example.test"),/Staging target/);
  assert.throws(()=>validateStagingTarget("https://staging.example.test/","staging.example.test"),/production hostname/);
  assert.throws(()=>validateStagingTarget("https://prod.example.test/","prod.example.test","prod.example.test"),/Staging target/);
  assert.throws(()=>validateStagingTarget("https://other.example.test/","staging.example.test","prod.example.test"),/Staging target/);
  assert.throws(()=>validateStagingTarget("https://staging.example.test/?token=x","staging.example.test","prod.example.test"),/Staging target/);
  assert.throws(()=>validateStagingTarget("https://u:p@staging.example.test/","staging.example.test","prod.example.test"),/Staging target/);
});
test("strict authenticated healthy status must be recent and have a lease", () => {
  assert.equal(checkSchedulerResponse(200,healthy,proofTime).ok,true);
  for(const value of [
    {...healthy,secondsSinceSuccess:601},
    {...healthy,secondsSinceSuccess:-1},
    {...healthy,ok:false},
    {...healthy,state:"last-run-failed"},
    {...healthy,lastLeaseStatus:"failed"},
    {...healthy,lastSuccessfulRunAt:"not-a-date"},
  ])assert.equal(checkSchedulerResponse(200,value,proofTime).ok,false);
  assert.equal(checkSchedulerResponse(401,healthy).ok,false);
  assert.equal(checkSchedulerResponse(503,healthy).ok,false);
});
test("rejects cached or inconsistent healthy-looking scheduler evidence", () => {
  assert.deepEqual(
    checkSchedulerResponse(200, {...healthy, lastSuccessfulRunAt: "2026-10-08T23:00:00.000Z"},proofTime),
    {ok:false,reason:"stale-or-inconsistent-scheduler-timestamp"}
  );
  assert.equal(checkSchedulerResponse(200,{...healthy,secondsSinceSuccess:599},proofTime).ok,false);
  assert.equal(checkSchedulerResponse(200,{...healthy,lastSuccessfulRunAt:"2026-10-09T00:05:00.000Z"},proofTime).ok,false);
});

test("read-only GET uses bounded request, explicit host and does not trigger work", async () => {
  let method = null;
  let path = null;
  let secret = null;
  const fakeFetch=async(url,request)=>{
    path=url.pathname;method=request.method;secret=request.headers["x-scheduler-monitor-token"];
    return {status:200,headers:{get:()=> "application/json"},json:async()=>healthy};
  };
  try {
    const verdict=await main({
      PAYROLL_STAGING_URL:"https://staging.example.test/",
      PAYROLL_STAGING_EXPECTED_HOST:"staging.example.test",
      PAYROLL_PRODUCTION_HOST:"prod.example.test",
      PAYROLL_STAGING_MONITOR_TOKEN:"synthetic-stage-monitor-token-is-over-32-characters",
    },fakeFetch,proofTime);
    assert.equal(verdict.ok,true);
    assert.equal(method,"GET");
    assert.equal(path,"/api/jobs/status");
    assert.equal(secret,"synthetic-stage-monitor-token-is-over-32-characters");
    assert.notEqual(secret, undefined);
  }finally{process.exitCode=0}
});
test("missing staging secret fails closed before networking", async()=>{
  await assert.rejects(()=>main({
    PAYROLL_STAGING_URL:"https://staging.example.test/",
    PAYROLL_STAGING_EXPECTED_HOST:"staging.example.test",
    PAYROLL_PRODUCTION_HOST:"prod.example.test",
  },async()=>{throw new Error("should not connect")}),/staging monitor token/);
});


test("secret-bearing staging workflow cannot be dispatched from an unreviewed PR branch", async () => {
  const { readFileSync } = await import("node:fs");
  const workflow = readFileSync(".github/workflows/scheduler-staging-health.yml", "utf8");
  assert.ok(workflow.includes("if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'"));
  assert.ok(workflow.includes("environment: payroll-staging"));
  assert.ok(workflow.includes("persist-credentials: false"));
  assert.ok(!workflow.includes("pull_request_target:"));
});


test("GitHub job summary never persists network response data", async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const folder = mkdtempSync(join(tmpdir(), "payroll-staging-summary-"));
  const summary = join(folder, "summary.txt");
  const env = {
    PAYROLL_STAGING_URL:"https://staging.example.test/",
    PAYROLL_STAGING_EXPECTED_HOST:"staging.example.test",
    PAYROLL_PRODUCTION_HOST:"prod.example.test",
    PAYROLL_STAGING_MONITOR_TOKEN:"synthetic-stage-monitor-token-is-over-32-characters",
    GITHUB_STEP_SUMMARY:summary,
  };
  try {
    await main(env, async () => ({
      status: 599,
      headers: {get:()=>"text/plain"},
      json: async ()=>({secret:"UNTRUSTED_CANARY"}),
    }), proofTime);
    const text = readFileSync(summary, "utf8");
    assert.ok(text.includes("Outcome: FAIL"));
    assert.ok(!text.includes("599") && !text.includes("UNTRUSTED_CANARY"));
    assert.ok(!text.includes("Observed HTTP status"));
    assert.ok(!text.includes("PAYROLL_STAGING_MONITOR_TOKEN"));
  } finally {
    process.exitCode=0;
    rmSync(folder, {recursive:true,force:true});
  }
});
