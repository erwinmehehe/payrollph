import assert from "node:assert/strict";
import { test } from "node:test";
import { employeeNeedsPayout,positiveId,readWorkspaceLocation,uiMoney,unpaidPayslipLabel,workspaceSearch,reportOnboardingStepValidity, summarizeTaskFirstPayroll } from "../src/lib/task-first-ui";

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

test("payroll KPIs use certified run state, including valid zero-pay calculations", () => {
  const run = { id: 31, status: "Processed", grossPay: "0.00", netPay: "0.00", employeeCount: 1 };
  const entry = { payrollRunId: 31, grossPay: "0.00", netPay: "0.00", deductions: "0.00" };
  assert.deepEqual(summarizeTaskFirstPayroll(run, [entry]), { calculated: true, gross: 0, net: 0, deductions: 0 });
  assert.deepEqual(summarizeTaskFirstPayroll({ ...run, status: "Draft" }, [entry]), { calculated: false, gross: null, net: null, deductions: null });
  assert.deepEqual(summarizeTaskFirstPayroll({ ...run, status: "Failed" }, [entry]), { calculated: false, gross: null, net: null, deductions: null });
});

test("payroll deductions fail closed on missing, mismatched or foreign-run evidence", () => {
  const run = { id: 52, status: "Ready for release", grossPay: "1000.00", netPay: "850.00", employeeCount: 2 };
  const rows = [
    { payrollRunId: 52, grossPay: "600.00", netPay: "500.00", deductions: "100.00" },
    { payrollRunId: 52, grossPay: "400.00", netPay: "350.00", deductions: "50.00" },
  ];
  assert.equal(summarizeTaskFirstPayroll(run, rows).deductions, 150);
  assert.equal(summarizeTaskFirstPayroll(run, rows.slice(0, 1)).deductions, null);
  assert.equal(summarizeTaskFirstPayroll(run, [{ ...rows[0], payrollRunId: 53 }, rows[1]]).deductions, null);
  assert.equal(summarizeTaskFirstPayroll(run, [{ ...rows[0], deductions: "invalid" }, rows[1]]).deductions, null);
  assert.equal(summarizeTaskFirstPayroll(run, [{ ...rows[0], grossPay: "605.00" }, rows[1]]).deductions, null);
  assert.equal(summarizeTaskFirstPayroll({ ...run, status: "Needs review", grossPay: "0.00", netPay: "0.00", employeeCount: 1 }, [{ payrollRunId: 52, grossPay: "0.00", netPay: "20.00", deductions: "-20.00" }]).deductions, null);
});

test("signed deductions are kept from stored entries rather than clamped gross-minus-net", () => {
  const run = { id: 53, status: "Processed", grossPay: "500.00", netPay: "520.00", employeeCount: 1 };
  const entry = { payrollRunId: 53, grossPay: "500.00", netPay: "520.00", deductions: "-20.00" };
  assert.equal(summarizeTaskFirstPayroll(run, [entry]).deductions, -20);
});
