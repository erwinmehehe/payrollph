import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const manifest = JSON.parse(read("scripts/qa/tenant-isolation-coverage-manifest.json"));
const METHOD_KEYS = [
  ["POST", "self/photo"],
  ["GET", "web-bundy/evidence"],
  ["POST", "web-bundy/evidence"],
  ["POST", "workforce/demand-observations/import"],
];
test("DL-02 closure preserves its frozen four exact GAP method identities", () => {
  assert.equal(new Set(METHOD_KEYS.map(x => x.join(" "))).size, 4);
  for (const [verb, route] of METHOD_KEYS) {
    const entry = manifest.allApiRouteFiles["src/app/api/" + route + "/route.ts"];
    assert.ok(entry, "missing manifest entry: " + route);
    const method = entry.methods.filter(x => x.name === verb);
    assert.equal(method.length, 1, "method identity must occur once: " + verb + " " + route);
    assert.ok(["GAP", "COVERED"].includes(method[0].status));
    if (method[0].status === "COVERED") {
      assert.ok(method[0].testedBy?.file,
        "cannot promote to COVERED without executable method-specific proof pins");
      assert.ok(method[0].testedBy?.ownPositiveLine &&
        method[0].testedBy?.foreignDenialLine &&
        method[0].testedBy?.unchangedDbLine &&
        method[0].testedBy?.forgedSelectorLine,
      "all four components must be source-linked, not inferred");
    }
  }
});
test("whole-batch proof uses three fictional preseeded employers and strict fixture guards", () => {
  const bootstrap = read("scripts/qa/tenant-dl02-closure-bootstrap.mjs");
  const runner = read("scripts/qa/tenant-dl02-closure-http.mjs");
  assert.match(bootstrap, /seedEmployer\("ATTA"/);
  assert.match(bootstrap, /seedEmployer\("ATTB"/);
  assert.match(bootstrap, /seedEmployer\("VICTIM"/);
  assert.doesNotMatch(bootstrap, /seedEmployer\("UNLISTED"/);
  for (const symbol of ["requireTenantTableDisposable", "TENANT_DL02_CLOSURE_PROOF"]) {
    assert.ok(bootstrap.includes(symbol));
    assert.ok(runner.includes(symbol));
  }
  assert.match(runner, /realVictimIdGreaterThanAttackerIds: true/);
  assert.match(runner, /victimSnapshot\(victim\)/);
  assert.match(runner, /assert\.deepEqual\(await victimSnapshot\(victim\), victimBefore/);
});
test("all three proof families assert real mutation, foreign denial and forged controls", () => {
  const families = [
    read("scripts/qa/tenant-dl02-rows/self-photo.mjs"),
    read("scripts/qa/tenant-dl02-rows/web-bundy.mjs"),
    read("scripts/qa/tenant-dl02-rows/demand-import.mjs"),
  ];
  for (const family of families) {
    for (const symbol of ["export const METHODS", "seedOwn", "verifyCrossEmployer", "ctx.exact", "ctx.noVictim"]) {
      assert.ok(family.includes(symbol), "family missing " + symbol);
    }
  }
  const scanner = read("scripts/qa/tenant-ci-synthetic-proof-scanner.mjs");
  assert.match(scanner, /TENANT_DL02_CLOSURE_PROOF === "isolated-ci-only"/);
  assert.match(scanner, /bytes\.equals\(fixturePng\)/,
    "synthetic PNG acceptance must compare exact fixture bytes");
  assert.match(scanner, /GITHUB_ACTIONS/);
});
