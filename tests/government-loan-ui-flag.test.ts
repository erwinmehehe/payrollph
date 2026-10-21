import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GovernmentLoanRemittancePanel } from "../src/components/government-loan-remittance-panel";
import { GovernmentLoanRemittancePanel as LegacyPanel } from "../src/components/government-loan-remittance-panel-legacy";
const props = { organizationId: 7, setNotice: () => {} };
test("government loan UI defaults to byte-identical legacy markup and exact-true opt-in", () => {
  const previous = process.env.NEXT_PUBLIC_GOVERNMENT_LOAN_REMITTANCE_UI_ENABLED;
  const legacy = renderToStaticMarkup(createElement(LegacyPanel, props));
  try {
    for (const flag of [undefined, "false", "TRUE", "1", ""]) {
      if (flag === undefined) delete process.env.NEXT_PUBLIC_GOVERNMENT_LOAN_REMITTANCE_UI_ENABLED;
      else process.env.NEXT_PUBLIC_GOVERNMENT_LOAN_REMITTANCE_UI_ENABLED = flag;
      assert.equal(renderToStaticMarkup(createElement(GovernmentLoanRemittancePanel, props)), legacy);
    }
    process.env.NEXT_PUBLIC_GOVERNMENT_LOAN_REMITTANCE_UI_ENABLED = "true";
    const markup = renderToStaticMarkup(createElement(GovernmentLoanRemittancePanel, props));
    assert.match(markup, /Verifying employer-scoped remittance and member evidence/);
    assert.match(markup, /disabled=""/);
    assert.doesNotMatch(markup, /No remittance batch is recorded/);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_GOVERNMENT_LOAN_REMITTANCE_UI_ENABLED;
    else process.env.NEXT_PUBLIC_GOVERNMENT_LOAN_REMITTANCE_UI_ENABLED = previous;
  }
});
