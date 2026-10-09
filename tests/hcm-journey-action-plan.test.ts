import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildHcmJourneyActionPlan } from "../src/lib/hcm-journey-action-plan";
import type { HcmWorkerJourney, WorkerJourneyStage } from "../src/lib/hcm-worker-journey";

const stage = (
  id: WorkerJourneyStage["id"],
  state: WorkerJourneyStage["state"],
  detail = "",
): WorkerJourneyStage => ({
  id, state, detail, label: id, page: ({
    recruitment: "Recruitment", position: "Planning", onboarding: "People",
    performance: "Performance", compensation: "Compensation", payroll: "Payroll",
    offboarding: "Separation",
  } as const)[id], evidence: null,
});

const journey = (stages: WorkerJourneyStage[]): HcmWorkerJourney => ({
  stages,
  summary: { recorded: 0, inProgress: 0, attention: 0, notRecorded: 0, restricted: 0, notApplicable: 0 },
  disclaimer: "Source linked only",
});

test("prioritizes source integrity review above follow-ups and optional source checks", () => {
  const result = buildHcmJourneyActionPlan(journey([
    stage("recruitment", "not_recorded"),
    stage("onboarding", "in_progress"),
    stage("offboarding", "attention"),
    stage("compensation", "attention"),
    stage("payroll", "restricted"),
  ]));
  assert.deepEqual(result.actions.map((item) => item.stageId), [
    "offboarding", "compensation", "onboarding", "recruitment",
  ]);
  assert.deepEqual(result.summary, { review: 2, followUp: 1, sourceCheck: 1 });
  assert.ok(result.actions.some((item) => /not release final pay automatically/i.test(item.instruction)));
});

test("never leaks restricted pay or compensation evidence or untrusted source details", () => {
  const result = buildHcmJourneyActionPlan(journey([
    stage("payroll", "restricted", "sensitive-run-922"),
    stage("compensation", "restricted", "salary-secret-877"),
    stage("position", "attention", "UNTRUSTED: pay 50000"),
  ]));
  assert.equal(result.actions.length, 1);
  const data = JSON.stringify(result);
  assert.ok(!data.includes("sensitive-run-922"));
  assert.ok(!data.includes("salary-secret-877"));
  assert.ok(!data.includes("UNTRUSTED"));
});

test("recorded, not applicable and restricted states produce no fabricated work", () => {
  const result = buildHcmJourneyActionPlan(journey([
    stage("recruitment", "recorded"),
    stage("onboarding", "recorded"),
    stage("payroll", "restricted"),
    stage("offboarding", "not_applicable"),
  ]));
  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.summary, { review: 0, followUp: 0, sourceCheck: 0 });
});

test("missing legacy evidence does not imply unauthorized hiring or unpaid wages", () => {
  const result = buildHcmJourneyActionPlan(journey([
    stage("recruitment", "not_recorded"),
    stage("payroll", "not_recorded"),
  ]));
  assert.equal(result.actions[0].priority, "source_check");
  assert.match(result.actions[0].instruction, /may legitimately lack/);
  assert.match(result.actions[1].instruction, /do not conclude wages were unpaid/);
});

test("recommendations never authorize wage or employment mutations", () => {
  const result = buildHcmJourneyActionPlan(journey([
    stage("compensation", "attention"),
    stage("offboarding", "in_progress"),
    stage("payroll", "in_progress"),
  ]));
  assert.match(result.disclaimer, /no HR decision, wage change, payroll release, bank payment/i);
  assert.match(result.actions[0].instruction, /without authorization/);
  assert.ok(result.actions.every((row) => !!row.page && !!row.responsibleTeam));
});

test("People mounts actions only beside the source journey and keeps all controls read-only", () => {
  const people = readFileSync("src/components/workspace/people.tsx", "utf8");
  const ui = readFileSync("src/components/hcm-worker-journey-actions.tsx", "utf8");
  const helper = readFileSync("src/lib/hcm-journey-action-plan.ts", "utf8");
  assert.ok(people.includes('import { HcmWorkerJourneyActions }'));
  assert.ok(people.includes("<HcmWorkerJourneyPanel journey={connectedProfile.journey}"));
  assert.ok(people.includes("<HcmWorkerJourneyActions journey={connectedProfile.journey}"));
  assert.ok(ui.includes("onPage(action.page)"));
  assert.ok(!ui.includes("fetch("));
  assert.ok(!ui.includes("POST"));
  assert.ok(!helper.includes("db.update("));
  assert.ok(!helper.includes("db.insert("));
});
