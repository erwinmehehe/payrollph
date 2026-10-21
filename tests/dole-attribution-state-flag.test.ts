import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { CRITICAL_RELEASE_FLAGS, criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";
import { unavailableMultiEntityDoleReport } from "../src/lib/dole-reporting-entity-boundary";

const ui = readFileSync("src/components/workspace/dole-thirteenth-month-report-panel.tsx", "utf8");
const route = readFileSync("src/app/api/compliance/dole-13th-month/route.ts", "utf8");
const builder = readFileSync("src/lib/dole-thirteenth-month-report-server.ts", "utf8");
const name = CRITICAL_RELEASE_FLAGS.doleAttributionStateUi.env;

test("new DOLE attribution UI notice defaults OFF and only exact true enables it", () => {
  assert.equal(name, "NEXT_PUBLIC_DOLE_ATTRIBUTION_STATE_UI_ENABLED");
  for (const flagValue of [undefined, "", "on", "1", "TRUE", "false", "False"]) {
    assert.equal(criticalReleaseFlagEnabled("doleAttributionStateUi", { [name]: flagValue }), false);
  }
  assert.equal(criticalReleaseFlagEnabled("doleAttributionStateUi", { [name]: "true" }), true);
  assert.match(ui, /process\.env\.NEXT_PUBLIC_DOLE_ATTRIBUTION_STATE_UI_ENABLED === "true"/);
  assert.match(ui, /doleAttributionStateUiEnabled &&\s*error\.includes/);
});

test("DOLE multi-entity GET, CSV, POST and direct builder deny regardless of UI flag state", async () => {
  for (const val of [undefined, "false", "true"]) {
    assert.equal(criticalReleaseFlagEnabled("doleAttributionStateUi", { [name]: val }), val === "true");
    const blocked = unavailableMultiEntityDoleReport(true);
    assert.equal(blocked?.status, 503);
    const body = await blocked?.json() as Record<string, unknown>;
    assert.equal(body.code, "DOLE_ENTITY_SOURCE_ATTRIBUTION_REQUIRED");
    assert.ok(!Object.hasOwn(body, "report"));
    assert.ok(!Object.hasOwn(body, "submissionHistory"));
  }
  assert.equal((route.match(/unavailableMultiEntityDoleReport\(criticalReleaseFlagEnabled\("multiEntity"\)\)/g)??[]).length, 2);
  assert.match(builder,/assertSingleEmployerDoleSource\(criticalReleaseFlagEnabled\("multiEntity"\)\)/);
  assert.doesNotMatch(route, /NEXT_PUBLIC_DOLE_ATTRIBUTION_STATE_UI_ENABLED|doleAttributionStateUi/);
  assert.doesNotMatch(builder, /NEXT_PUBLIC_DOLE_ATTRIBUTION_STATE_UI_ENABLED|doleAttributionStateUi/);
});

test("browser QA checks source-parity and actual 390px/desktop state suppression", () => {
  const proof = readFileSync("scripts/qa/dole-attribution-state-browser.mjs","utf8");
  assert.match(proof,/baselineSha="694703b2745b5171df6da067ee433b2741ae2c63"/);
  assert.match(proof,/widths:\[1280,390\]/);
  assert.match(proof,/assert\.equal\(markup\.off,markup\.legacy/);
  assert.match(proof,/page\.screenshot/);
});
