import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isReviewedHeldSsoSecondPassInput, reviewedSsoCallerProof, verifyReviewedHeldSsoCallerSource } from "../scripts/qa/payroll-run-sso-source-reproof.mjs";

const COMPAT = "scripts/qa/payroll-run-oracle-source-compat.mjs";
const CALLER = "scripts/qa/tenant-second-pass-http.mjs";

test("current default-off SSO probe reconstructs both executed historical inputs byte-for-byte", () => {
  const old = verifyReviewedHeldSsoCallerSource();
  assert.equal(old[COMPAT], "bf33eadf192888db0924c40df894c4ea38ea28aa");
  assert.equal(old[CALLER], "b053035fa0b0d3a0390c595fb34000206d3c3330");
  for (const [file, historical] of Object.entries(old))
    assert.equal(isReviewedHeldSsoSecondPassInput("secondPass", file, historical), true);
  assert.equal(isReviewedHeldSsoSecondPassInput("readTable", CALLER, old[CALLER]), false);
  assert.equal(isReviewedHeldSsoSecondPassInput("secondPass", "src/lib/access.ts", old[CALLER]), false);
  assert.equal(isReviewedHeldSsoSecondPassInput("secondPass", CALLER, "0".repeat(40)), false);
  assert.equal(reviewedSsoCallerProof.result.probedHttpMethods, 50);
  assert.equal(reviewedSsoCallerProof.previouslyCoveredReproofCredits, 0);
  assert.equal(reviewedSsoCallerProof.independentlyAccepted, false);
});

test("both status and oracle mutations fail closed instead of inheriting payroll credits", () => {
  for (const [file, replacements] of [
    [CALLER, [
      ['OIDC_SSO_RUNTIME_MODE !== "enabled" ? 503 : 200', 'OIDC_SSO_RUNTIME_MODE !== "enabled" ? 200 : 200'],
      ['"Public/auth-status or held SSO endpoint "', '"Forged SSO result "'],
    ]],
    [COMPAT, [
      ['originalOracleCallerSource', 'forgedOracleCallerSource'],
      ['"Exactly one reviewed disabled-SSO expectation"', '"Review bypass"'],
    ]],
  ]) {
    const original = readFileSync(file, "utf8");
    for (const [from, to] of replacements) {
      assert.ok(original.includes(from));
      const read = (path, ...args) => path === file
        ? original.replace(from, to) : readFileSync(path, ...args);
      assert.throws(() => verifyReviewedHeldSsoCallerSource(read), /changed; require fresh evidence/);
    }
  }
});
