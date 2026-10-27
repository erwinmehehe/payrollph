import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tenantFamilyCatalog } from "../scripts/qa/tenant-table-catalog.mjs";
import { METHODS, verifyCredit } from "../scripts/qa/tenant-performance-development-actions.mjs";

test("WRK-02 supplemental proofs keep four exact identities and all original family bytes", () => {
  assert.deepEqual(METHODS, ["POST performance/competencies", "PATCH performance/competencies", "POST performance/continuous", "POST performance/development-plans"]);
  const file = "scripts/qa/tenant-table-rows/write/performance-growth.mjs";
  // This family was frozen by the independently reviewed reconciliation receipt.
  // Compare its exact SHA-256 rather than a floating origin/main ref: isolated
  // GitHub Actions checkouts often have no remote-tracking branch at all.
  const familySha256 = "93b7902cf9058b62a89cbf16d7c5626397eaec96d2d967fff9310ccefd747a83";
  const receipt = JSON.parse(readFileSync("scripts/qa/tenant-merged-family-reconciliation.json", "utf8"));
  assert.equal(receipt.sources[file], familySha256, "reviewed family source pin must not drift");
  assert.equal(createHash("sha256").update(readFileSync(file, "utf8").replaceAll("\r\n", "\n")).digest("hex"),
    familySha256, "all originally reviewed performance-growth family bytes must remain unchanged");
  for (const key of METHODS) assert.equal(tenantFamilyCatalog("write").filter(row => row.key === key).length, 1);
});
test("generated four-method credits pin executable supplemental proof and leave incomplete methods GAP", () => {
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json"));
  const file = "scripts/qa/tenant-performance-development-actions.mjs", source = readFileSync(file, "utf8");
  for (const key of METHODS) {
    const [verb, route] = key.split(" ");
    const method = Object.values(manifest.allApiRouteFiles).find(r => r.route === route).methods.find(m => m.name === verb);
    assert.equal(method.status, "COVERED");
    const proof = method.testedBy.supplementalProof; assert.equal(proof.file, file);
    verifyCredit(key, method);
    const missing = structuredClone(method); delete missing.testedBy.supplementalProof;
    assert.throws(() => verifyCredit(key, missing));
    const drift = structuredClone(method); drift.testedBy.supplementalProof.sha256 = "0".repeat(64);
    assert.throws(() => verifyCredit(key, drift), /source drift/);
    const wrongPin = structuredClone(method); wrongPin.testedBy.supplementalProof.forgedSelectorLine = 1;
    assert.throws(() => verifyCredit(key, wrongPin), /forgedSelectorLine/);
    assert.throws(() => verifyCredit("POST workforce/worksites", method), /only independently completed/);
    assert.equal(proof.sha256, createHash("sha256").update(source).digest("hex"));
    for (const [field, fragment] of [["ownPositiveLine", "const owned = io.expectStatus"], ["foreignDenialLine", "const victim = io.expectStatus"], ["forgedSelectorLine", "const denied = io.expectStatus"], ["unchangedDbLine", "all supplemental victim tables and audit remain unchanged"]]) assert.ok(source.split("\n")[proof[field]-1].includes(fragment));
  }
  for (const route of ["performance/follow-through-governance", "performance/calibration"]) assert.equal(Object.values(manifest.allApiRouteFiles).find(r => r.route === route).methods.find(m => m.name === "PATCH").status, "GAP");
});
test("supplemental actions cannot replace or shift the original shared own/foreign/victim proofs", () => {
  const file = "scripts/qa/tenant-write-table-http.mjs";
  const source = readFileSync(file, "utf8");
  // Strip only the three intended, one-line supplemental hooks, then compare
  // every other byte with the SHA-256 of the reviewed main base. This is stricter
  // than comparing a handful of statements, works with shallow checkouts, and
  // rejects unrelated edits or moved primary proof assertions.
  const hooks = [
    [
      'const supplemental = await import("./tenant-performance-development-actions.mjs"); await supplemental.prepare(rows, employers); const victimBefore = await victimSnapshot(victim.org.id);',
      'const victimBefore = await victimSnapshot(victim.org.id);',
    ],
    [
      'await supplemental.exercise(item.key, ctx, { request, expectStatus, cookie: own.cookie }); passed.add(item.key + "#" + idx);',
      'passed.add(item.key + "#" + idx);',
    ],
    [
      'await supplemental.finish(); const victimAfter = await victimSnapshot(victim.org.id);',
      'const victimAfter = await victimSnapshot(victim.org.id);',
    ],
  ];
  let original = source;
  for (const [supplemental, baseline] of hooks) {
    assert.equal(original.split(supplemental).length - 1, 1,
      "exactly one reviewed supplemental hook must exist, without shifting shared proof lines");
    original = original.replace(supplemental, baseline);
  }
  assert.equal(
    createHash("sha256").update(original).digest("hex"),
    "3caaf33b85e4f7c0417efdf62617a1a1a55b24960b9f8a8c25a168939042fac4",
    "all original shared HTTP runner bytes must match the reviewed c269df59 base",
  );
  const actualLines = source.split("\n"), baselineLines = original.split("\n");
  for (const fragment of ["const owned = expectStatus", "const foreign = expectStatus",
    "assert.deepEqual(victimAfter, victimBefore", "expect accepts another employer's data"]) {
    const line = baselineLines.findIndex(text => text.includes(fragment));
    assert.ok(line >= 0, "required primary proof missing: " + fragment);
    assert.equal(actualLines[line], baselineLines[line],
      "primary own/foreign/victim/discrimination proof must stay on its original line");
  }
  assert.ok(source.indexOf("await supplemental.exercise") > source.indexOf("a forged victim reference must write nothing"));
  assert.ok(source.indexOf("await supplemental.finish") < source.indexOf("assert.deepEqual(victimAfter, victimBefore"));
});

test("WRK-02 supplementary job profile avoids existing primary-row titles", () => {
  const supplemental = readFileSync("scripts/qa/tenant-performance-development-actions.mjs", "utf8");
  const primary = readFileSync("scripts/qa/tenant-table-rows/write/performance-growth.mjs", "utf8");
  assert.match(supplemental, /title: e\.marker \+ "-WRK02-DEVELOPMENT", familyId: family\.id/);
  assert.match(primary, /title: e\.marker \+ suffix/);
  const marker = "TTBL-ATTA-fictional";
  for (const title of [marker, marker + "-CGNEW", marker + "-CGEDIT"]) {
    assert.notEqual(marker + "-WRK02-DEVELOPMENT", title);
  }
  assert.doesNotMatch(supplemental, /onConflictDoNothing\(\)/,
    "a fixture collision must be prevented, not silently ignored");
});
