import assert from "node:assert/strict";
import test from "node:test";
import { verifyHostedDemoObservation } from "../scripts/qa/verify-1102-hosted-ui-evidence.mjs";

function fictionalTestOnly() {
  return {
    runningSha: "a".repeat(40),
    observedAt: "2026-10-25T03:00:00.000Z",
    verifiedOriginalDbTarget: true,
    verifiedServedAppDbBinding: true,
    observerRole: "fictional-test-observer",
    runs: [
      { runId: 1, status: "Released", period: "Aug 16–31, 2026", detailCount: 6,
        dbGross: "181300.00", dbNet: "147400.00",
        apiGross: "181300.00", apiNet: "147400.00",
        uiGross: "₱181,300.00", uiNet: "₱147,400.00" },
      { runId: 2, status: "Pending approval", period: "Sep 1–15, 2026", detailCount: 6,
        dbGross: "182800.00", dbNet: "148600.00",
        apiGross: "182800.00", apiNet: "148600.00",
        uiGross: "₱182,800.00", uiNet: "₱148,600.00" },
      { runId: 3, status: "Needs review", period: "Sep 16–30, 2026", detailCount: 6,
        dbGross: "184300.00", dbNet: "149800.00",
        apiGross: "184300.00", apiNet: "149800.00",
        uiGross: "₱184,300.00", uiNet: "₱149,800.00" },
    ],
  };
}

test("all three fictional corrected headers match claimed DB, API and UI amounts", () => {
  const outcome = verifyHostedDemoObservation(fictionalTestOnly());
  assert.equal(outcome.amountsCompared, 18);
  assert.equal(outcome.ownerAcceptanceGranted, false);
  assert.equal(outcome.actualDbQueriedByScript, false);
});

test("detects historical stale gross or net values on any one of three surfaces", () => {
  for (const field of ["dbGross", "apiNet", "uiGross"]) {
    const e = fictionalTestOnly();
    e.runs[0][field] = "176300.00";
    assert.throws(() => verifyHostedDemoObservation(e), /HOSTED_UI_MISMATCH/);
  }
});

test("rejects false deployment/DB attestations and invented or incomplete observations", () => {
  for (const key of ["verifiedOriginalDbTarget", "verifiedServedAppDbBinding"]) {
    const e = fictionalTestOnly();
    e[key] = false;
    assert.throws(() => verifyHostedDemoObservation(e), /NOT_VERIFIED/);
  }
  const tooFew = fictionalTestOnly();
  tooFew.runs.pop();
  assert.throws(() => verifyHostedDemoObservation(tooFew), /THREE_ACTUAL_UI_RUNS_REQUIRED/);
  const extra = fictionalTestOnly();
  extra.runs[0].employeeNames = ["DO_NOT_INCLUDE_PII"];
  assert.throws(() => verifyHostedDemoObservation(extra), /UNKNOWN_FIELD/);
});
