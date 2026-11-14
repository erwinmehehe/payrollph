import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  verifyReviewedFivePageProbeEquivalence, isReviewedFiveScopedPageProbeInput,
} from "../scripts/qa/payroll-run-five-scoped-page-source-compat.mjs";

const PROBE = "scripts/qa/tenant-scoped-page-probes.mjs";
const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const HISTORICAL = "fe310ca93f2d6ae2fd48ce72d2ee1cf451b55e20";
const read = (name, ...args) => readFileSync(name, ...args);

test("one exact reviewed page-count delta reconstructs immutable second-pass input", () => {
  assert.equal(verifyReviewedFivePageProbeEquivalence(), HISTORICAL);
  assert.equal(isReviewedFiveScopedPageProbeInput("secondPass", PROBE, HISTORICAL), true);
  for (const [cohort, file, sha] of [
    ["readTable", PROBE, HISTORICAL],
    ["secondPass", "src/lib/auth.ts", HISTORICAL],
    ["secondPass", PROBE, "0".repeat(40)],
  ]) assert.equal(isReviewedFiveScopedPageProbeInput(cohort, file, sha), false);
});

test("never borrow the old payroll renewal for an arbitrary probe source change", () => {
  const source = read(PROBE, "utf8");
  for (const [from, to] of [
    ['probeManifestBusinessPages(f, { request, makeSession, expectStatus })', 'probeManifestBusinessPages(f, { request, makeSession })'],
    ['pageGaps.length', 'pageGaps.length + 1'],
    ['assert.ok(!foreignRes.text.includes(victimPrivateEmployeeMarker)', 'assert.ok(true || !foreignRes.text.includes(victimPrivateEmployeeMarker)'],
  ]) {
    assert.ok(source.includes(from), "Expected mutation token present");
    const custom = (path, ...args) => path === PROBE ? source.replace(from, to) : read(path, ...args);
    assert.throws(() => verifyReviewedFivePageProbeEquivalence(custom), /PAGE_COMPAT_REFUSED/);
  }
});

test("cannot trust forged five-page credits or changed proof, workflow or legacy verifier", () => {
  const raw = read(MANIFEST, "utf8");
  const original = JSON.parse(raw);
  const targeted = "src/app/app/engagement/page.tsx";
  for (const mutate of [
    m => { m.scopedPages.find(p => p.path === targeted).testedBy = null; },
    m => { m.scopedPages.find(p => p.path === targeted).testedBy.methodCredits = 1; },
    m => { m.scopedPages.find(p => p.path === targeted).testedBy.actualFinalHeadRunRequired = false; },
    m => { m.scopedPages.find(p => p.path === targeted).testedBy.independentlyAccepted = true; },
    m => { m.scopedPages.find(p => p.path === targeted).status = "GAP"; },
    m => { m.metrics.coveredAfter += 1; },
  ]) {
    const changed = structuredClone(original); mutate(changed);
    const custom = (path, ...args) => path === MANIFEST
      ? JSON.stringify(changed) : read(path, ...args);
    assert.throws(() => verifyReviewedFivePageProbeEquivalence(custom));
  }
  for (const path of [
    "scripts/qa/tenant-five-scoped-page-credit.mjs",
    ".github/workflows/tenant-five-scoped-pages-credit.yml",
    "scripts/qa/tenant-five-method-credit-verify.mjs",
  ]) {
    const custom = (name, ...args) => name === path
      ? String(read(name, ...args)) + "// unreviewed" : read(name, ...args);
    assert.throws(() => verifyReviewedFivePageProbeEquivalence(custom),
      /PAGE_COMPAT_REFUSED/);
  }
});
