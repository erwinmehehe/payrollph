import assert from "node:assert/strict";
import test from "node:test";
import {firstPayrollRunHref, resolveFirstPayrollRunFocus} from "../src/lib/first-payroll-run-navigation";

const scope = {enabled:true, demoMode:false, requestedPage:"Payroll", requestedOrganizationId:"7",
  requestedRunId:"42", organizationId:7, access:{role:"payroll",companyWide:true},authorizedRuns:[{id:42},{id:43}]};
test("saved payroll link resumes exactly the authorized employer and run after reload",()=>{
  const url=new URL(firstPayrollRunHref(7,42),"https://example.test");
  assert.equal(resolveFirstPayrollRunFocus({...scope,requestedPage:url.searchParams.get("workspacePage"),
    requestedOrganizationId:url.searchParams.get("organizationId"),requestedRunId:url.searchParams.get("focusPayrollRunId")}),42);
  assert.equal(resolveFirstPayrollRunFocus({...scope,requestedRunId:"43"}),43);
});
test("flag-off, demo, foreign employer, missing run and disallowed roles cannot focus payroll",()=>{
  for(const patch of [{enabled:false},{demoMode:true},{requestedPage:"People"},
    {requestedOrganizationId:"8"},{requestedOrganizationId:null},{requestedRunId:"999"},{authorizedRuns:[]},
    {access:null},{access:{role:"hr",companyWide:true}},{access:{role:"employee",companyWide:true}},
    {access:{role:"payroll",companyWide:false}}]) {
    assert.equal(resolveFirstPayrollRunFocus({...scope,...patch}),null);
  }
  for(const value of ["0","-1","01","1.0"," 42","42 ","42x","9007199254740992",null]) {
    assert.equal(resolveFirstPayrollRunFocus({...scope,requestedRunId:value}),null);
    assert.equal(resolveFirstPayrollRunFocus({...scope,requestedOrganizationId:value}),null);
  }
  for(const role of ["owner","admin","bookkeeper","payroll","checker"]) {
    assert.equal(resolveFirstPayrollRunFocus({...scope,access:{role,companyWide:true}}),42);
  }
});
test("navigation builder rejects malformed scope rather than creating ambiguous URLs",()=>{
  for(const id of [0,-1,1.1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(()=>firstPayrollRunHref(id,42));
    assert.throws(()=>firstPayrollRunHref(7,id));
  }
});
