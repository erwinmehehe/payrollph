import assert from "node:assert/strict";
import test from "node:test";
import { validateStagingTarget, checkSchedulerResponse, main } from "../scripts/check-scheduler-staging-health.mjs";

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
  assert.equal(checkSchedulerResponse(200,healthy).ok,true);
  for(const value of [
    {...healthy,secondsSinceSuccess:601},
    {...healthy,secondsSinceSuccess:-1},
    {...healthy,ok:false},
    {...healthy,state:"last-run-failed"},
    {...healthy,lastLeaseStatus:"failed"},
    {...healthy,lastSuccessfulRunAt:"not-a-date"},
  ])assert.equal(checkSchedulerResponse(200,value).ok,false);
  assert.equal(checkSchedulerResponse(401,healthy).ok,false);
  assert.equal(checkSchedulerResponse(503,healthy).ok,false);
});
test("read-only GET uses bounded request, explicit host and does not trigger work", async () => {
  let method = null;
  let path = null;
  let secret = null;
  const fakeFetch=async(url,request)=>{
    path=url.pathname;method=request.method;secret=request.headers["x-worker-token"];
    return {status:200,headers:{get:()=> "application/json"},json:async()=>healthy};
  };
  try {
    const verdict=await main({
      PAYROLL_STAGING_URL:"https://staging.example.test/",
      PAYROLL_STAGING_EXPECTED_HOST:"staging.example.test",
      PAYROLL_PRODUCTION_HOST:"prod.example.test",
      PAYROLL_STAGING_WORKER_TOKEN:"synthetic-stage-token-is-long",
    },fakeFetch);
    assert.equal(verdict.ok,true);
    assert.equal(method,"GET");
    assert.equal(path,"/api/jobs/status");
    assert.equal(secret,"synthetic-stage-token-is-long");
  }finally{process.exitCode=0}
});
test("missing staging secret fails closed before networking", async()=>{
  await assert.rejects(()=>main({
    PAYROLL_STAGING_URL:"https://staging.example.test/",
    PAYROLL_STAGING_EXPECTED_HOST:"staging.example.test",
    PAYROLL_PRODUCTION_HOST:"prod.example.test",
  },async()=>{throw new Error("should not connect")}),/staging worker token/);
});
