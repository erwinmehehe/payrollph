import assert from "node:assert/strict";
import test from "node:test";
import { projectMonitor } from "../src/lib/hcm-bp-monitor-projection";
test("monitor only includes known instances and distinguishes missing SLA",()=>{
const rows=[{id:7,processType:"change_job",status:"in_progress",effectiveDate:"2026-10-10",initiatedAt:"2026-10-01",currentStepIndex:1}];
const steps=[{id:1,instanceId:7,stepIndex:1,stepType:"approval",status:"pending",dueAt:null},
{id:2,instanceId:7,stepIndex:2,stepType:"review",status:"pending",dueAt:"2026-10-01T00:00:00Z"},
{id:3,instanceId:999,stepIndex:3,stepType:"approval",status:"pending",dueAt:null}];
const p=projectMonitor(rows,steps,new Date("2026-10-10T00:00:00Z"));
assert.equal(p[0].steps.length,2);assert.deepEqual(p[0].steps.map(x=>x.sla),["no_due_date","overdue"]);
assert.ok(!JSON.stringify(p).includes("decisionNote"));
});
