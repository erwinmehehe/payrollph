import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CANDIDATES, reviewExistingNonSessionGapCandidates,
} from "../scripts/qa/tenant-remaining-gap-evidence-review.mjs";

const MANIFEST_PATH = "scripts/qa/tenant-isolation-coverage-manifest.json";
const DOC = "docs/qa/tenant-remaining-api-gap-evidence-review.md";
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

test("three non-session classifications are candidates only; ZERO tenant method credits", () => {
  assert.deepEqual(reviewExistingNonSessionGapCandidates(manifest), [
    "GET setup", "POST intake-challenge", "POST hcm/work-items/escalate",
  ]);
  const methods = Object.values(manifest.allApiRouteFiles)
    .flatMap(route => route.methods.map(m => ({ key: m.name + " " + route.route, method: m })));
  const gaps = methods.filter(x => x.method.status === "GAP");
  assert.equal(gaps.length, manifest.metrics.gap);
  assert.ok(gaps.length >= CANDIDATES.length);
  assert.ok(CANDIDATES.every(item => gaps.some(x => x.key === item.verb + " " + item.route)));
});

test("altering a reviewed route or email-HMAC helper must invalidate this source-only decision record", () => {
  const paths = [...CANDIDATES.map(item => item.path), "src/lib/public-intake-proof.ts"];
  for (const changedPath of paths) {
    assert.throws(() => reviewExistingNonSessionGapCandidates(manifest, path => {
      const original = readFileSync(path);
      return path === changedPath
        ? Buffer.concat([original, Buffer.from("\n// source changed")])
        : original;
    }), /handler source changed|implementation changed/,
    "Wrong source pin stayed accepted: " + changedPath);
  }
});

test("a fake COVERED or public/worker classification cannot borrow negative-only source evidence", () => {
  for (const candidate of CANDIDATES) {
    const changed = structuredClone(manifest);
    const method = changed.allApiRouteFiles[candidate.path].methods
      .find(row => row.name === candidate.verb);
    method.status = candidate.proposedClass;
    assert.throws(() => reviewExistingNonSessionGapCandidates(changed),
      /no unapproved reclassification/, "Unapproved classification: " + candidate.route);
    method.status = "COVERED";
    method.testedBy = { file: "scripts/qa/tenant-remaining-gap-evidence-review.mjs" };
    assert.throws(() => reviewExistingNonSessionGapCandidates(changed),
      /no unapproved reclassification/, "Invented method credit: " + candidate.route);
    method.status = "GAP";
    assert.throws(() => reviewExistingNonSessionGapCandidates(changed),
      /source-only evidence is NOT tenant HTTP proof/, "Invented receipt: " + candidate.route);
  }
});

test("decision record preserves the existing GAPs, security holds and no-live-execution boundary", () => {
  const doc = readFileSync(DOC, "utf8");
  assert.match(doc, /17 remaining API method GAPs/);
  assert.match(doc, /zero method credits/i);
  for (const candidate of CANDIDATES) {
    assert.ok(doc.includes(candidate.verb + " /api/" + candidate.route),
      "Decision record omitted the specific API method: " + candidate.route);
  }
  for (const required of [
    "independent", "SAML metadata", "marketing/leads", "automation-studio",
    "xendit-payout", "signup/verify", "no production", "no live",
  ]) assert.ok(doc.toLowerCase().includes(required.toLowerCase()),
    "Decision record removed an unproven or sensitive boundary: " + required);
});
