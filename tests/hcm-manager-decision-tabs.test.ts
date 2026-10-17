import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { nextManagerDecisionTab } from "../src/lib/hcm-manager-decision-tabs";

const order = ["hcm", "leave", "overtime"] as const;

test("read-only manager source tabs arrow between actual sources and wrap around", () => {
  assert.equal(nextManagerDecisionTab("hcm", "ArrowRight", order), "leave");
  assert.equal(nextManagerDecisionTab("leave", "ArrowRight", order), "overtime");
  assert.equal(nextManagerDecisionTab("overtime", "ArrowRight", order), "hcm");
  assert.equal(nextManagerDecisionTab("hcm", "ArrowLeft", order), "overtime");
  assert.equal(nextManagerDecisionTab("leave", "ArrowLeft", order), "hcm");
  assert.equal(nextManagerDecisionTab("overtime", "ArrowLeft", order), "leave");
  assert.equal(nextManagerDecisionTab("leave", "Home", order), "hcm");
  assert.equal(nextManagerDecisionTab("hcm", "End", order), "overtime");
});

test("do not intercept Tab, Shift+Tab, scroll arrows or unsupported sources", () => {
  for (const key of ["Tab", "Shift", "Escape", "Enter", " ", "ArrowUp", "ArrowDown", "a"]) {
    assert.equal(nextManagerDecisionTab("hcm", key, order), null, key);
  }
  assert.equal(nextManagerDecisionTab("hcm", "Home", []), null);
  assert.equal(nextManagerDecisionTab("hcm", "ArrowRight", ["leave", "overtime"]), null);
  assert.equal(nextManagerDecisionTab("hcm", "ArrowRight", ["hcm", "hcm"]), null);
});

test("source tablist implements roving Tab index, keyboard focus and scoped data fetch", () => {
  const source = readFileSync("src/components/hcm-manager-decision-inbox.tsx", "utf8");
  assert.match(source, /role="tablist" aria-label="Decision sources"/);
  assert.match(source, /tabIndex=\{source === option\.key \? 0 : -1\}/);
  assert.match(source, /onKeyDown=\{handleSourceKeyDown\}/);
  assert.match(source, /nextManagerDecisionTab\(source, event\.key, SOURCE_ORDER\)/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /querySelector<HTMLButtonElement>/);
  assert.match(source, /aria-selected=\{source === option\.key\}/);
  assert.match(source, /loaded\?\.key === requestKey/);
  assert.match(source, /controller\.abort\(\)/);
  assert.doesNotMatch(source, /method: "(POST|PATCH|DELETE)"/);
});
