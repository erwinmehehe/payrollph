import assert from "node:assert/strict";
import { test } from "node:test";
import { employeeNeedsPayout,positiveId,readWorkspaceLocation,uiMoney,unpaidPayslipLabel,workspaceSearch,reportOnboardingStepValidity } from "../src/lib/task-first-ui";

test("onboarding stops at the first invalid control and allows a corrected step", () => {
  let valid = false;
  const visited: string[] = [];
  const controls = [
    { reportValidity: () => { visited.push("name"); return true; } },
    { reportValidity: () => { visited.push("email"); return valid; } },
    { reportValidity: () => { visited.push("title"); return true; } },
  ];
  assert.equal(reportOnboardingStepValidity(controls), false);
  assert.deepEqual(visited, ["name", "email"]);
  valid = true;
  visited.length = 0;
  assert.equal(reportOnboardingStepValidity(controls), true);
  assert.deepEqual(visited, ["name", "email", "title"]);
});

test("only authorized employer and loaded run IDs can be restored",()=>{
  const scope={organizationId:8,pages:["Overview","Payroll","People"],runIds:[15],employeeIds:[44]};
  assert.deepEqual(readWorkspaceLocation("?organizationId=9&page=Payroll&runId=15&focus=exceptions",scope),{organizationId:8,page:"Overview"});
  assert.deepEqual(readWorkspaceLocation("?organizationId=8&page=Payroll&runId=999&focus=exceptions",scope),{organizationId:8,page:"Payroll",focus:"exceptions"});
  assert.deepEqual(readWorkspaceLocation("?organizationId=8&page=Payroll&runId=15&focus=exceptions",scope),{organizationId:8,page:"Payroll",runId:15,focus:"exceptions"});
  assert.deepEqual(readWorkspaceLocation("?organizationId=8&page=Enterprise",scope),{organizationId:8,page:"Overview"});
});
test("navigation retains demoRole and removes stale run parameters",()=>{
  const q=workspaceSearch("?demoRole=payroll&runId=2&focus=history",{organizationId:8,page:"People",employeeId:44});
  const params=new URLSearchParams(q);
  assert.equal(params.get("demoRole"),"payroll");
  assert.equal(params.get("runId"),null);
  assert.equal(params.get("employeeId"),"44");
});
test("malformed ids and unknown money are never coerced to valid values",()=>{
  for(const id of [-2,0,"00","2x",NaN,1.3]) assert.equal(positiveId(id),undefined);
  assert.equal(uiMoney(undefined),"Unavailable");
  assert.equal(uiMoney("bad"),"Unavailable");
  assert.match(uiMoney("0"),/0/);
  assert.equal(employeeNeedsPayout(null,"BPI"),true);
  assert.match(unpaidPayslipLabel("2026-10-05"),/^Pay date /);
});
