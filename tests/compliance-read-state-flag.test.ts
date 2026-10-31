import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { criticalReleaseFlagEnabled, CRITICAL_RELEASE_FLAGS } from "../src/lib/critical-release-flags";

const flag = CRITICAL_RELEASE_FLAGS.complianceReadStateUi.env;
const calendarUi = readFileSync("src/components/workspace/compliance-calendar-panel.tsx", "utf8");
const paymentUi = readFileSync("src/components/workspace/statutory-payment-proof.tsx", "utf8");
const calendarApi = readFileSync("src/app/api/compliance/calendar/route.ts", "utf8");
const proofApi = readFileSync("src/app/api/compliance/statutory-remittances/payment-evidence/route.ts", "utf8");
const parser = readFileSync("src/lib/compliance-calendar-read.ts", "utf8");

test("read-state UI flag defaults OFF, only exact true enables supplemental copy", () => {
  assert.equal(flag, "NEXT_PUBLIC_COMPLIANCE_READ_STATE_UI_ENABLED");
  for (const value of [undefined, "false", "TRUE", "1", "on", ""]) {
    assert.equal(criticalReleaseFlagEnabled("complianceReadStateUi", { [flag]: value }), false);
  }
  assert.equal(criticalReleaseFlagEnabled("complianceReadStateUi", { [flag]: "true" }), true);
});

test("flag-OFF keeps existing strict read and upload denial; flag is UI-only", () => {
  assert.match(calendarUi, /process\.env\.NEXT_PUBLIC_COMPLIANCE_READ_STATE_UI_ENABLED === "true"/);
  assert.match(paymentUi, /process\.env\.NEXT_PUBLIC_COMPLIANCE_READ_STATE_UI_ENABLED === "true"/);
  assert.match(calendarUi, /readVerifiedComplianceCalendar\(organizationId, fetch, signal\)/);
  assert.match(paymentUi, /readVerifiedPaymentProof\(organizationId, batchId, fetch, signal\)/);
  assert.match(paymentUi, /if \(!proof\)/);
  for (const s of [calendarApi, proofApi, parser]) {
    assert.doesNotMatch(s, /COMPLIANCE_READ_STATE_UI_ENABLED|complianceReadStateUi/,
      "Feature flag must not weaken server source checks or authorization");
  }
  assert.match(parser, /const requiredFamilies = \["sss", "philhealth", "pagibig", "bir-withholding", "wage-orders"\]/);
  assert.match(parser, /for \(const month of contributionMonths\)/);
  assert.match(parser, /for \(const month of birPayMonths\)/);
});

test("desktop and 390px snapshots preserve unchanged flag-OFF read-state markup and planner-safe empty copy", () => {
  const fixture = readFileSync("scripts/qa/compliance-read-state-browser.mjs", "utf8");
  assert.match(fixture, /baselineSha = "e920562cc869a8fd6402423cf3949c0ae7a63cee"/);
  assert.match(fixture, /screenWidths:\[1280,390\]/);
  // The planner intentionally adds read-only controls and replaces a misleading
  // green empty state. Compare every OTHER rendered subtree to the original
  // pre-flag baseline, rather than requiring obsolete full-document equality.
  assert.match(fixture, /assert\.equal\(sharedReadStateHtml\.off,sharedReadStateHtml\.legacy/);
  assert.ok(fixture.includes('copy.querySelector(\'[aria-label="Compliance deadline planner"]\')?.remove()'),
    "only the intentional planner control can be excluded from legacy parity");
  assert.ok(fixture.includes('copy.querySelectorAll("[data-compliance-calendar] .notice")'),
    "legacy parity must exclude only the intentional empty-notice change");
  assert.match(fixture, /if\(mode!=="error"\) assert\.equal\(html\.on,html\.off/);
  assert.match(fixture, /assert\.match\(txt,\/No obligations match the selected filters\//);
  assert.match(fixture, /assert\.match\(txt,\/This does not certify filing or remittance completion\//);
  assert.match(fixture, /assert\.match\(txt,\/No calendar items need attention\//);
  assert.match(fixture, /page\.screenshot/);
});
