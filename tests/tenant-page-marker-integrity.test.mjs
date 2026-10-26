import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const harness = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
const probe = readFileSync("scripts/qa/tenant-scoped-page-probes.mjs", "utf8");

test("three-employer fixture returns distinct REAL organization names, not undefined", () => {
  assert.match(harness,
    /const \[victim, attackerA, attackerB\] = await db\.insert\(organizations\)\.values\(\[[\s\S]*?\]\)\.returning\(\{\s*id:\s*organizations\.id,\s*name:\s*organizations\.name\s*\}\);/,
    "The three-employer fixture must return real database organization names, not ID-only rows");
  assert.match(harness, /name: "Victim Only " \+ nonce/);
  assert.match(harness, /name: "Attacker A " \+ nonce/);
  assert.match(harness, /name: "Attacker B " \+ nonce/);
  assert.match(probe, /const victimOrgMarker = victim\.name;/);
  assert.match(probe, /assert\.match\(victimOrgMarker, \/\^Victim Only/);
  assert.match(probe, /assert\.notEqual\(victimOrgMarker, own\.name/);
});

test("foreign employer HTML must continue to reject real victim markers", () => {
  assert.match(probe, /assert\.ok\(!foreignRes\.text\.includes\(victimOrgMarker\)/);
  assert.match(probe, /assert\.ok\(!foreignRes\.text\.includes\(victimPrivateEmployeeMarker\)/);
  assert.match(probe, /assert\.ok\(!foreignRes\.text\.includes\("VictimExclusive7"\)/);
  assert.match(probe, /victimEmployeeAndPayrollUnchanged: true/);
  assert.match(probe, /const pageGaps = pages\.filter\(\(page\) => page\.status === "GAP"\);/);
  assert.match(probe, /assert\.equal\(pageGaps\.length, 17,/);
  // Two provisional COVERED pages must retain real owned-success and victim-denial proof.
  assert.match(probe, /expectStatus\(ownRes, 200, "Owned workspace SSR must load the verified snapshot"\)/);
  assert.match(probe, /expectStatus\(foreignRes, 404, "Foreign employer workspace must be denied before snapshot loading"\)/);
  assert.match(probe, /outstandingPageOrActionGaps: pageGaps\.length, pageGapsReclassified: 0/);
});

test("undefined is NEVER acceptable as a sensitive marker", () => {
  const html = "<script>undefined</script>";
  assert.equal(html.includes(undefined), true, "A missing JS marker gives a false alarm");
  assert.equal(html.includes("Victim Only 0a1b2c3d4e5f"), false);
});
