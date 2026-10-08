import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const engine = readFileSync("src/lib/hcm-business-process.ts", "utf8");

test("HCM sequential steps receive deadlines when activated, not at process initiation", () => {
  const activation = engine.slice(engine.indexOf("async function activateStepTx("), engine.indexOf("export async function startHcmBusinessProcessTx("));
  const creation = engine.slice(engine.indexOf("export async function startHcmBusinessProcessTx("), engine.indexOf("async function advanceAfterStepTx("));
  assert.match(activation, /definitionSnapshot/);
  assert.match(activation, /validateHcmBusinessProcessSteps/);
  assert.match(activation, /dueAt: stepDueAt\(frozenStep.dueDays\)/);
  assert.match(creation, /dueAt: null, \/\/ Starts when activated/);
  assert.doesNotMatch(creation, /dueAt: stepDueAt\(step.dueDays\)/);
});

test("HCM step deadlines reject invalid due-day values", () => {
  assert.match(engine, /Number.isInteger\(dueDays \?\? 3\)/);
  assert.match(engine, /\(dueDays \?\? 3\) < 0/);
  assert.match(engine, /\(dueDays \?\? 3\) > 90/);
});
