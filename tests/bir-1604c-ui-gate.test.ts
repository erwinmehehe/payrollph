import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Bir1604cCandidatePanel } from "../src/components/workspace/bir-1604c-candidate-panel";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";
Object.assign(globalThis, { React });

test("actual BIR panel renders nothing when its server flag is missing or false", () => {
  const props = { organizationId: 1, legalEntityId: 11, taxYear: 2026,
    sourceDigest: null, setNotice: () => {} };
  for (const enabled of [undefined, false]) {
    assert.equal(renderToStaticMarkup(React.createElement(Bir1604cCandidatePanel, { ...props, enabled })), "");
  }
  assert.ok(renderToStaticMarkup(React.createElement(Bir1604cCandidatePanel, { ...props, enabled: true })).length > 100);
});

test("reviewed BIR candidate registry is default-off and requires exact true", () => {
  for (const value of [undefined, "", "false", "TRUE", "1"])
    assert.equal(criticalReleaseFlagEnabled("bir1604cReviewedCandidate", { BIR_1604C_DAT_CANDIDATE_ENABLED: value }), false);
  assert.equal(criticalReleaseFlagEnabled("bir1604cReviewedCandidate", { BIR_1604C_DAT_CANDIDATE_ENABLED: "true" }), true);
});
