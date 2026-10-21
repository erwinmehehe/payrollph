import assert from "node:assert/strict";
import test from "node:test";
import { readVerifiedLaunchReadiness } from "../src/lib/launch-readiness-read";

const empty = {
  organizationId: 13, status: "launch-ready", launchBlockersRemaining: 0,
  scaleGapsRemaining: 0, summary: "All gates verified",
  manualLaunch: { ready: true, summary: "Verified" }, generatedAt: "2026-10-21T00:00:00Z",
  gates: [],
};
test("launch readiness never shows clear for non-OK, partial or wrong employer", () => {
  assert.deepEqual(readVerifiedLaunchReadiness(true, empty, 13), empty);
  assert.equal(readVerifiedLaunchReadiness(false, empty, 13), null);
  assert.equal(readVerifiedLaunchReadiness(true, empty, 14), null);
  for (const v of [{}, { ...empty, gates: undefined }, { ...empty, manualLaunch: undefined },
    { ...empty, launchBlockersRemaining: undefined }, { ...empty, summary: undefined }]) {
    assert.equal(readVerifiedLaunchReadiness(true, v, 13), null);
  }
});
test("a failed gate cannot be silently considered launch ready and retry validates afresh", () => {
  const blocked = {
    ...empty, status: "not-launch-ready", launchBlockersRemaining: 1,
    gates: [{ key: "proof", label: "External acceptance", ready: false,
      detail: "Missing", blocks: "launch", manualWorkaround: null }],
  };
  assert.deepEqual(readVerifiedLaunchReadiness(true, blocked, 13), blocked);
  assert.equal(readVerifiedLaunchReadiness(true, { ...blocked, status: "launch-ready" }, 13), null);
  assert.equal(readVerifiedLaunchReadiness(false, blocked, 13), null);
  assert.deepEqual(readVerifiedLaunchReadiness(true, blocked, 13), blocked);
});
