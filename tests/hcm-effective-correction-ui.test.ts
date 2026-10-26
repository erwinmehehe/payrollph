import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { readFileSync } from "node:fs";
import { HcmEffectiveChangeCorrection } from "../src/components/hcm-effective-change-correction";

const props = { organizationId: 3, employeeId: 5, userId: 11, onChanged: async () => {},
  change: { id: 7, status: "pending_approval", movementType: "employment_type_change", requestedByUserId: 12, effectiveDate: "2099-01-01", reason: "Fictional correction reason" } };
test("worker history offers source-specific correction controls only to the appropriate maker/checker", () => {
  const html = renderToStaticMarkup(createElement(HcmEffectiveChangeCorrection, props));
  assert.match(html, /Return for correction/); assert.match(html, /aria-expanded="false"/);
  assert.equal(renderToStaticMarkup(createElement(HcmEffectiveChangeCorrection, { ...props, userId: 12 })), "");
  const returned = { ...props, userId: 12, change: { ...props.change, status: "returned_for_correction" } };
  assert.match(renderToStaticMarkup(createElement(HcmEffectiveChangeCorrection, returned)), /Correct and resubmit/);
  const replaced = renderToStaticMarkup(createElement(HcmEffectiveChangeCorrection, { ...returned, replacementId: 19 }));
  assert.match(replaced, /Resubmitted as request #19/); assert.doesNotMatch(replaced, /Correct and resubmit/);
  assert.equal(renderToStaticMarkup(createElement(HcmEffectiveChangeCorrection, { ...returned, userId: 11 })), "");
  for (const status of ["approved", "scheduled", "applied", "cancelled", "declined", "failed"]) assert.equal(renderToStaticMarkup(createElement(HcmEffectiveChangeCorrection, { ...props, change: { ...props.change, status } })), "");
  assert.equal(renderToStaticMarkup(createElement(HcmEffectiveChangeCorrection, { ...props, change: { ...props.change, movementType: "promotion" } })), "");
});
test("forms require explicit reason/date and verify response identity before refreshing", () => {
  const source = readFileSync("src/components/hcm-effective-change-correction.tsx", "utf8");
  assert.match(source, /<label htmlFor=/); assert.match(source, /required minLength=\{10\}/); assert.match(source, /type="date" required/);
  assert.ok(source.indexOf("verifyHcmCorrectionActionRead(response.ok") < source.indexOf("await onChanged()"));
  assert.match(source, /if \(!live.current\) return/); assert.match(source, /key=\{`\$\{props.organizationId\}/);
  const parent = readFileSync("src/components/workspace/people.tsx", "utf8");
  assert.match(parent, /connectedProfile.changeOptions.canManage && data.user\?\.id/);
  assert.match(parent, /<HcmEffectiveChangeCorrection/);
});
