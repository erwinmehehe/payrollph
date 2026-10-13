import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExportsView } from "../src/components/workspace/exports";
import { PayoutMethodOptions } from "../src/components/payout-profiles-panel";
import { payoutUiFixture } from "./fixtures/payout-ui";

Object.assign(globalThis, { React });

test("disabled and absent server gate preserve the real rendered PayMongo export controls", () => {
  for (const enabled of [undefined, false]) {
    const markup = renderToStaticMarkup(React.createElement(ExportsView, {
      data: payoutUiFixture(enabled), notify: () => {}, onRefresh: async () => {},
    }));
    assert.doesNotMatch(markup, /Xendit|legacy/);
    assert.match(markup, /Primary payout: PayMongo/);
    assert.match(markup, /Run PayMongo preflight/);
    assert.match(markup, /PayMongo is Linaw/);
  }
});

test("the real profile selector offers Xendit only under the delivered boolean gate", () => {
  const off = renderToStaticMarkup(React.createElement(PayoutMethodOptions, {}));
  assert.doesNotMatch(off, /xendit|legacy/i);
  assert.match(off, /PayMongo PESONet\/InstaPay/);
  const on = renderToStaticMarkup(React.createElement(PayoutMethodOptions, { xenditEnabled: true }));
  assert.match(on, /value="xendit"/);
  const rolledBack = renderToStaticMarkup(React.createElement(PayoutMethodOptions, { currentMethod: "xendit" }));
  assert.match(rolledBack, /disabled=""/);
  assert.match(rolledBack, /review existing profile/);
});

test("enabled export controls do not render the Xendit panel to an HR role", () => {
  const markup = renderToStaticMarkup(React.createElement(ExportsView, {
    data: payoutUiFixture(true, "hr"), notify: () => {}, onRefresh: async () => {},
  }));
  assert.doesNotMatch(markup, /data-xendit|Xendit payroll payouts|Xendit payroll control/);
});
