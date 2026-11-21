import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  OPERATIONS_COPILOT_SUPPLEMENT,
  verifyOperationsCopilotReviewOnly,
} from "../scripts/qa/operations-copilot-isolation-supplement-verify.mjs";

test("new copilot routes and page are explicitly inventoried as ZERO-CREDIT GAPs", () => {
  assert.deepEqual(verifyOperationsCopilotReviewOnly(), {
    apiRoutePaths: ["src/app/api/operations-copilot/route.ts"],
    pagePaths: ["src/app/hcm/operations-copilot/page.tsx"],
    apiMethods: 2, apiCredits: 0, pageCredits: 0, status: "GAP",
  });
});

test("a changed route, page, or privacy dependency must renew exact-source review", () => {
  for (const target of [
    "src/app/api/operations-copilot/route.ts",
    "src/app/hcm/operations-copilot/page.tsx",
    "src/lib/operations-copilot.ts",
    "src/lib/operations-copilot-ai.ts",
    "src/components/operations-copilot-panel.tsx",
  ]) {
    assert.throws(() => verifyOperationsCopilotReviewOnly(file =>
      file === target ? Buffer.from("tampered-reviewed-source") : readFileSync(file)),
    /source changed; renew tenant isolation review/, target);
  }
});

test("an unaccepted method or SSR page may never be silently promoted to COVERED", () => {
  const original = JSON.parse(readFileSync(OPERATIONS_COPILOT_SUPPLEMENT, "utf8"));
  const mutants = [];
  const promotedGet = structuredClone(original);
  promotedGet.apiRoutes[0].methods[0].status = "COVERED";
  mutants.push(promotedGet);
  const promotedPage = structuredClone(original);
  promotedPage.scopedPages[0].status = "COVERED";
  mutants.push(promotedPage);
  const fakeProof = structuredClone(original);
  fakeProof.exactHeadRealHttpProof = "PASS";
  mutants.push(fakeProof);
  const fakeProduction = structuredClone(original);
  fakeProduction.productionEnabled = true;
  mutants.push(fakeProduction);
  const fakeCredit = structuredClone(original);
  fakeCredit.newApiMethodCredits = 1;
  mutants.push(fakeCredit);

  for (const mutant of mutants) {
    assert.throws(() => verifyOperationsCopilotReviewOnly(file =>
      file === OPERATIONS_COPILOT_SUPPLEMENT
        ? JSON.stringify(mutant) : readFileSync(file)), /AssertionError|GAP|NOT_RUN|false|0/,
    "unreviewed promotion should fail closed");
  }
});

test("only exact PR-base and preexisting upstream manifest blobs are eligible", () => {
  const original = JSON.parse(readFileSync(OPERATIONS_COPILOT_SUPPLEMENT, "utf8"));
  assert.equal(original.baselineManifestBlob, "df3e1301b67ec1b2c271f4393f91511b7e8035c5");
  assert.equal(original.upstreamManifestBlob, "c024f9699f3770693625fcaf9982e7ed39eed57f");
  for (const wrong of [
    {baselineManifestBlob: "0".repeat(40)},
    {upstreamManifestBlob: "0".repeat(40)},
    {upstreamManifestBlob: original.baselineManifestBlob},
  ]) {
    const mutant = {...original, ...wrong};
    assert.throws(() => verifyOperationsCopilotReviewOnly(file =>
      file === OPERATIONS_COPILOT_SUPPLEMENT
        ? JSON.stringify(mutant) : readFileSync(file)), /AssertionError|Expected values to be strictly equal/,
      "An arbitrary upstream manifest or rebased pin must be rejected");
  }
});

test("sealed historic tenant ledger must remain exact and cannot borrow new-method credit", () => {
  assert.throws(() => verifyOperationsCopilotReviewOnly(file =>
    file === "scripts/qa/tenant-isolation-coverage-manifest.json"
      ? Buffer.from("unreviewed-repin") : readFileSync(file)),
  /Original executed tenant evidence was modified/);
});
