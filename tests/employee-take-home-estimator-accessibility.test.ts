import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const component = readFileSync("src/components/employee-take-home-estimator.tsx", "utf8");

test("the employee estimator is a labelled region with a matching heading ID", () => {
  assert.match(component, /const headingId = useId\(\)/);
  assert.match(component, /<article className="employee-list-card" aria-labelledby=\{headingId\}>/);
  assert.match(component, /<h3 id=\{headingId\}>/);
});

test("estimator loading and failure messages have screen-reader roles", () => {
  assert.match(component, /<div role="status" aria-live="polite"/);
  assert.match(component, /\{error && <div role="alert" className="notice notice-amber"/);
  assert.match(component, /<div role="alert" className="notice notice-amber"><span>\{t\("Enter amounts from 0 to 100,000,000\."\)\}/);
});

test("the four scenario controls retain visible associated labels", () => {
  for (const label of [
    "Monthly basic salary",
    "Taxable allowances / month",
    "De minimis / month",
    "Voluntary Pag-IBIG / month",
  ]) {
    assert.ok(component.includes(`<span>{t("${label}")}</span>`), label);
  }
  assert.equal((component.match(/<label className="field">/g) ?? []).length, 4);
});
