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

test("waiting and declined steps do not claim an SLA, completed steps are recorded separately", () => {
  const source = [{ id: 12, processType: "transfer", status: "declined", effectiveDate: null,
    initiatedAt: "2026-10-10T00:00:00Z", currentStepIndex: 2 }];
  const steps = [
    { id: 9, instanceId: 12, stepIndex: 3, stepType: "review", status: "waiting",
      dueAt: "2026-10-01T00:00:00Z" },
    { id: 8, instanceId: 12, stepIndex: 1, stepType: "approval", status: "completed",
      dueAt: null },
    { id: 7, instanceId: 12, stepIndex: 2, stepType: "approval", status: "declined",
      dueAt: "2026-09-01T00:00:00Z" },
  ];
  const result = projectMonitor(source, steps, new Date("2026-10-10T00:00:00Z"));
  assert.deepEqual(result[0].steps.map((step) => step.id), [8, 7, 9]);
  assert.deepEqual(result[0].steps.map((step) => step.sla),
    ["completed", "not_applicable", "not_applicable"]);
  assert.equal(result[0].steps[2].dueAt, "2026-10-01T00:00:00.000Z");
});

test("pending due times report exact, future and malformed timestamps separately", () => {
  const source = [{ id: 1, processType: "promotion", status: "in_progress",
    effectiveDate: "2026-10-11", initiatedAt: "2026-10-09T00:00:00Z", currentStepIndex: 1 }];
  const steps = [
    { id: 1, instanceId: 1, stepIndex: 1, stepType: "approval", status: "pending",
      dueAt: "2026-10-10T00:00:00Z" },
    { id: 2, instanceId: 1, stepIndex: 2, stepType: "review", status: "pending",
      dueAt: "2026-10-12T00:00:00Z" },
    { id: 3, instanceId: 1, stepIndex: 3, stepType: "to_do", status: "pending",
      dueAt: "not-a-date" },
  ];
  const p = projectMonitor(source, steps, new Date("2026-10-10T00:00:00Z"));
  assert.deepEqual(p[0].steps.map((step) => step.sla), ["due", "not_due", "no_due_date"]);
  assert.equal(p[0].steps[2].dueAt, null);
  assert.equal(p[0].effectiveDate, "2026-10-11");
  assert.ok(!JSON.stringify(p).includes("assignee"));
});
