import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmployeeHrCasesPanel } from "../src/components/employee-hr-cases-panel";

test("actual employee HR panel has no markup when its server flag is absent or off", () => {
  const target = globalThis as typeof globalThis & { React?: typeof React };
  const previous = target.React;
  target.React = React;
  try {
    assert.equal(renderToStaticMarkup(React.createElement(EmployeeHrCasesPanel, { language: "en" })), "");
    assert.equal(renderToStaticMarkup(React.createElement(EmployeeHrCasesPanel, { language: "en", enabled: false })), "");
    assert.match(renderToStaticMarkup(React.createElement(EmployeeHrCasesPanel, { language: "en", enabled: true })), /Loading HR requests/);
  } finally {
    if (previous === undefined) Reflect.deleteProperty(target, "React");
    else target.React = previous;
  }
});
