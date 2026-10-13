import assert from "node:assert/strict";
import test from "node:test";
import { loanDisplaySchedule } from "../src/lib/loan-schedule-view";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";
import { resolveWorkflowUiFlags } from "../src/lib/workflow-ui-flags";

test("financial display controls default OFF and never activate in multi-entity mode",()=>{
 for(const value of [undefined,"","true ","1","TRUE"])
  assert.equal(criticalReleaseFlagEnabled("benefitsLoans",{BENEFITS_LOANS_UI_ENABLED:value}),false);
 assert.equal(resolveWorkflowUiFlags({BENEFITS_LOANS_UI_ENABLED:"true",MULTI_ENTITY_ENABLED:"false"}).benefitsLoans,true);
 assert.equal(resolveWorkflowUiFlags({BENEFITS_LOANS_UI_ENABLED:"true",MULTI_ENTITY_ENABLED:"true"}).benefitsLoans,false);
});

test("illustrative centavo-only loan schedule preserves remaining balance and excludes unapproved loans",()=>{
 const rows=loanDisplaySchedule({balance:"1000.01",installment:"333.34",startsOn:"2026-01-15",status:"active"});
 assert.deepEqual(rows.map(x=>x.amount),[333.34,333.34,333.33]);
 assert.equal(rows.at(-1)?.projectedBalance,0);
 assert.equal(rows.reduce((n,x)=>Math.round(n+x.amount*100),0),100001);
 assert.deepEqual(loanDisplaySchedule({balance:1000,installment:200,startsOn:"2026-01-15",status:"pending_approval"}),[]);
 assert.deepEqual(loanDisplaySchedule({balance:1000,installment:0,startsOn:"2026-01-15",status:"active"}),[]);
 assert.deepEqual(loanDisplaySchedule({balance:1000,installment:100,startsOn:"2026-02-30",status:"active"}),[]);
});

test("large illustration cannot produce unbounded rows or authorize payroll deductions",()=>{
 const rows=loanDisplaySchedule({balance:"10000000.00",installment:"1.00",startsOn:"2026-01-15",status:"active"});
 assert.ok(rows.length<=120);
 assert.ok(rows.at(-1)!.projectedBalance>0);
});

test("reconciled registry preserves source-only applicant privacy and sanitized telemetry", () => {
  for (const key of ["applicantPrivacy", "sanitizedErrorTelemetry", "benefitsLoans"] as const) {
    assert.equal(criticalReleaseFlagEnabled(key, {}), false);
  }
  assert.equal(criticalReleaseFlagEnabled("applicantPrivacy", { APPLICANT_PRIVACY_CONTROLS_ENABLED: "true" }), true);
  assert.equal(criticalReleaseFlagEnabled("sanitizedErrorTelemetry", { SAFE_OTEL_ERRORS_ENABLED: "true" }), true);
  assert.equal(resolveWorkflowUiFlags({
    APPLICANT_PRIVACY_CONTROLS_ENABLED: "true", SAFE_OTEL_ERRORS_ENABLED: "true",
    BENEFITS_LOANS_UI_ENABLED: "false",
  }).benefitsLoans, false);
  assert.equal(resolveWorkflowUiFlags({
    BENEFITS_LOANS_UI_ENABLED: "true", MULTI_ENTITY_ENABLED: "true",
  }).benefitsLoans, false);
});
