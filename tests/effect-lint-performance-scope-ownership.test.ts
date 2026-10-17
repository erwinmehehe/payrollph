import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const paths = [
  "src/components/performance-governance-panel.tsx",
  "src/components/performance-competency-architecture-panel.tsx",
  "src/components/performance-calibration-panel.tsx",
];
const read = (path: string) => readFileSync(path, "utf8");

test("all performance governance and rating drafts remount with the selected employer", () => {
  const [governance, competency, calibration] = paths.map(read);
  for (const [source, inner] of [
    [governance, "PerformanceGovernanceContent"],
    [competency, "PerformanceCompetencyArchitectureContent"],
    [calibration, "PerformanceCalibrationContent"],
  ]) {
    assert.ok(source.includes("<" + inner + " key={props.organizationId} {...props} />"));
    assert.ok(source.indexOf("function " + inner + "(") < source.indexOf("const ["));
  }
  assert.match(governance, /setNotice=\{announce\}/);
});

test("all three GETs use abortable single-owner revision checks and defer mount work", () => {
  for (const path of paths) {
    const source = read(path);
    assert.match(source, /const revision = \+\+loadRevisionRef\.current/);
    assert.match(source, /const isCurrent = \(\) => mountedRef\.current && !controller\.signal\.aborted && revision === loadRevisionRef\.current/);
    assert.match(source, /if \(!isCurrent\(\)\) return;/);
    assert.match(source, /cache: "no-store",\s*signal: controller\.signal/);
    assert.match(source, /queueMicrotask\(\(\) => \{ if \(!retired\) void load\(\); \}\)/);
    assert.match(source, /retired = true;\s*mountedRef\.current = false;\s*loadRevisionRef\.current \+= 1/);
    assert.match(source, /loadControllerRef\.current\?\.abort\(\)/);
    assert.match(source, /if \(!mountedRef\.current\) return;/);
    assert.match(source, /if \(mountedRef\.current\) setNotice\(message\)/);
    assert.equal((source.match(/\buseEffect\(/g) ?? []).length, 1);
    assert.doesNotMatch(source, /useEffect\(\(\) => \{ void load\(\); \}, \[load\]\)/);
  }
});

test("retired performance mutation responses cannot rewrite the next company's drafts", () => {
  for (const path of paths.slice(1)) {
    const source = read(path);
    assert.match(source, /const payload = await response\.json\(\)\.catch\(\(\) => \(\{\}\)\);\s*if \(!mountedRef\.current\) return;/);
    assert.match(source, /await load\(\);/);
  }
});

test("old performance evidence export cannot download after company switch or a newer export", () => {
  const source = read(paths[0]);
  assert.match(source, /const revision = \+\+exportRevisionRef\.current/);
  assert.match(source, /exportControllerRef\.current\?\.abort\(\)/);
  assert.match(source, /exportRevisionRef\.current \+= 1/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /const blob = await response\.blob\(\);\s*if \(!isCurrentExport\(\)\) return;/);
  assert.ok(source.indexOf("if (!isCurrentExport()) return;", source.indexOf("const blob = await response.blob()")) <
    source.indexOf("anchor.click();"));
  assert.match(source, /if \(isCurrentExport\(\)\) setEvidenceExporting\(false\)/);
});

test("server authorization and all performance write actions remain in place", () => {
  const governance = read(paths[0]);
  const competency = read(paths[1]);
  const calibration = read(paths[2]);
  const route = read("src/app/api/performance/route.ts");
  assert.ok(governance.includes('entityType: "review"'));
  assert.ok(governance.includes('entityType: "review_item"'));
  assert.ok(governance.includes('entityType: "cycle"'));
  assert.ok(governance.includes('method: "PATCH"'));
  assert.ok(competency.includes('entityType: "template_mapping"'));
  assert.ok(competency.includes('entityType: "expectation_default"'));
  assert.ok(calibration.includes('action: "score"'));
  assert.ok(calibration.includes('action: "finalize"'));
  assert.ok(calibration.includes('action: "flag"'));
  assert.ok(route.includes("companyWide"));
});

test("only the three fixed effect lint allowances are removed", () => {
  const manifest = JSON.parse(read("eslint-suppressions.json")) as Record<string, unknown>;
  for (const path of paths) assert.equal(manifest[path], undefined, path);
  assert.ok(read("scripts/check-lint-warning-debt.mjs").includes("warningDebt"));
});
