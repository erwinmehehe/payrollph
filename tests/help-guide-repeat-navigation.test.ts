import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clickedHelpGuideSlug } from "../src/lib/help-guide-navigation";

const valid = { href: "/help#manager-handoff", pathname: "/help", primaryUnmodified: true };

test("every unmodified role-guide link opens with unchanged, different or missing hash", () => {
  assert.equal(clickedHelpGuideSlug(valid), "manager-handoff");
  assert.equal(clickedHelpGuideSlug({ ...valid, pathname: "/help/" }), "manager-handoff");
  assert.equal(clickedHelpGuideSlug({ ...valid, href: "/help#payroll-checker-evidence" }), "payroll-checker-evidence");
});

test("unknown, external, modified and off-page links do not force reopening", () => {
  assert.equal(clickedHelpGuideSlug({ ...valid, href: "/help#nonexistent"  }), null);
  assert.equal(clickedHelpGuideSlug({ ...valid, pathname: "/dashboard" }), null);
  assert.equal(clickedHelpGuideSlug({ ...valid, href: "https://example.test/help#manager-handoff" }), null);
  assert.equal(clickedHelpGuideSlug({ ...valid, href: "/help#manager-handoff?ignore" }), null);
  assert.equal(clickedHelpGuideSlug({ ...valid, primaryUnmodified: false }), null);
  assert.equal(clickedHelpGuideSlug({ ...valid, href: null }), null);
});

test("client help component handles all in-page guide clicks before Next Link navigation", () => {
  const source = readFileSync("src/components/marketing/help-center-search.tsx", "utf8");
  assert.match(source, /document\.addEventListener\("click", openClickedGuide, true\)/);
  assert.match(source, /document\.removeEventListener\("click", openClickedGuide, true\)/);
  assert.match(source, /if \(slug\) openGuide\(slug\)/);
  assert.match(source, /window\.addEventListener\("hashchange", openHashGuide\)/);
  assert.match(source, /setGuideNavigation\(\(current\) => \(\{ slug, revision:/);
  assert.match(source, /details\.open = true/);
});
