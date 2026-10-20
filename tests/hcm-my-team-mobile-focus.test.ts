import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("My Team handles long employee identifiers without forcing the mobile content width", () => {
  const source = readFileSync("src/components/hcm-my-team.tsx", "utf8");
  assert.match(source, /<div className="min-w-0 max-w-full break-words">/);
  assert.match(source, /Employee #\{member.employeeNo\}/);
  assert.match(source, /id="hcm-team-search" type="search"/);
  assert.match(source, /min-h-11 w-full min-w-0 rounded-lg/);
});

test("My Team primary controls have 44px targets and keyboard focus visibility", () => {
  const source = readFileSync("src/components/hcm-my-team.tsx", "utf8");
  const criticalControls = ["Back to workspace", "Refresh", "Clear filters", "Search", "Newer", "Older"];
  for (const label of criticalControls) {
    assert.ok(source.includes(label), "Missing action: " + label);
  }
  assert.equal((source.match(/min-h-11/g) ?? []).length >= 7, true);
  assert.equal((source.match(/focus-visible:outline/g) ?? []).length >= 7, true);
});
