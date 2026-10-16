import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mobileNavOpenerSelector, mobileNavVisualFindings } from "./e2e/nav-sweep-visual-contract.mjs";

const good = () => ({
  viewportWidth: 375, documentWidth: 375, bodyWidth: 375,
  mainWidth: 375, mainLeft: 0, mainRight: 375,
  navVisible: true, navWidth: 40, navHeight: 40, navExpanded: "false",
});

test("normal 375px fictional workspace geometry is a visual-contract pass", () => {
  assert.deepEqual(mobileNavVisualFindings(good()), []);
});

test("375px employee ESS uses its actual More opener, not the staff drawer opener", () => {
  const employeeSelector = mobileNavOpenerSelector("employee");
  const staffSelector = mobileNavOpenerSelector("hr");
  assert.equal(employeeSelector, '.employee-mobile-nav button[aria-label="More employee pages"]');
  assert.equal(staffSelector, '.app-main button[aria-label="Open navigation"]');
  assert.notEqual(employeeSelector, staffSelector);
  const ess = readFileSync("src/components/self-service-portal.tsx", "utf8");
  const staff = readFileSync("src/components/workspace/shell.tsx", "utf8");
  assert.match(ess, /className="employee-tabs employee-mobile-nav"/);
  assert.match(ess, /aria-label="More employee pages"/);
  assert.match(staff, /aria-label="Open navigation"/);
  assert.deepEqual(mobileNavVisualFindings(good()), [], "Visible closed ESS More opener passes");
  assert.ok(mobileNavVisualFindings({ ...good(), navVisible: false }).length,
    "Missing ESS More opener must still fail");
  assert.ok(mobileNavVisualFindings({ ...good(), navExpanded: "true" }).length,
    "ESS More overlay left open must fail");
});

test("a deliberate document or body overflow never passes", () => {
  assert.ok(mobileNavVisualFindings({ ...good(), documentWidth: 1600 })
    .some(s => s.includes("horizontal overflow")));
  assert.ok(mobileNavVisualFindings({ ...good(), bodyWidth: 620 })
    .some(s => s.includes("horizontal overflow")));
});

test("hidden or open mobile navigation and unbounded main content are reported", () => {
  const issues = mobileNavVisualFindings({ ...good(), navVisible: false,
    navExpanded: "true", mainLeft: -20, mainRight: 400 });
  assert.ok(issues.some(s => s.includes("opener is hidden")));
  assert.ok(issues.some(s => s.includes("collapsed")));
  assert.ok(issues.some(s => s.includes("exceeds the viewport")));
});

test("missing geometry and incorrect viewport cannot become a fake green", () => {
  assert.ok(mobileNavVisualFindings(null).length);
  assert.ok(mobileNavVisualFindings({ ...good(), viewportWidth: 390 }).length);
  assert.ok(mobileNavVisualFindings({ ...good(), documentWidth: Number.NaN }).length);
});

test("the browser sweep gates 375px geometry, preserves role coverage, and injects negative proof", () => {
  const source = readFileSync("tests/e2e/nav-sweep.spec.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/nav-runtime-sweep.yml", "utf8");
  assert.match(source, /NAV_SWEEP_MOBILE_EDGE/);
  assert.match(source, /mobileNavVisualFindings\(geometry\)/);
  assert.match(source, /mobileNavOpenerSelector\(role\)/);
  assert.match(source, /NAV_SWEEP_INJECT_VISUAL_OVERFLOW/);
  assert.match(source, /sweepViewports/);
  assert.match(source, /compareNavSweepCaseCoverage\(expectedCases, observedCases\)/);
  assert.match(workflow, /NAV_SWEEP_MOBILE_EDGE=true NAV_SWEEP_FOCUS_ROLE=hr/);
  assert.match(workflow, /NAV_SWEEP_INJECT_VISUAL_OVERFLOW=true/);
});
