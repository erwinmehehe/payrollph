import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductionPilotSignoffCard } from "../src/components/workspace/production-pilot-signoff";
import { dashboardFixture, sampleRun } from "./fixtures/dashboard-ui";

test("pilot reconciliation displays the released total including its centavos", () => {
  for (const netPay of ["13271.30", "0.01", "10000.00"]) {
    const html = renderToStaticMarkup(createElement(ProductionPilotSignoffCard, {
      data: { ...dashboardFixture, payrollRuns: [{ ...sampleRun, status: "Released", netPay }] },
      notify: () => {}, onRefresh: async () => {},
    }));
    const expected = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(netPay));
    assert.ok(html.includes(expected), `missing exact released total ${expected}`);
  }
});
