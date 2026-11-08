import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { repeatedHelpGuideSlug } from "../src/lib/help-guide-navigation";

const valid = { href: "/help#manager-handoff", pathname: "/help", currentHash: "#manager-handoff", primaryUnmodified: true };

test("an unmodified repeated role-guide link reopens the same guide", () => {
  assert.equal(repeatedHelpGuideSlug(valid), "manager-handoff");
  assert.equal(repeatedHelpGuideSlug({ ...valid, pathname: "/help/" }), "manager-handoff");
  assert.equal(repeatedHelpGuideSlug({ ...valid, href: "/help#payroll-checker-evidence", currentHash: "#payroll-checker-evidence" }), "payroll-checker-evidence");
});

test("different hashes, unknown slugs, external and modified navigation do not force reopening", () => {
  assert.equal(repeatedHelpGuideSlug({ ...valid, currentHash: "#account-help" }), null);
  assert.equal(repeatedHelpGuideSlug({ ...valid, href: "/help#nonexistent" , currentHash: "#nonexistent" }), null);
  assert.equal(repeatedHelpGuideSlug({ ...valid, pathname: "/dashboard" }), null);
  assert.equal(repeatedHelpGuideSlug({ ...valid, href: "https://example.test/help#manager-handoff" }), null);
  assert.equal(repeatedHelpGuideSlug({ ...valid, href: "/help#manager-handoff?ignore" }), null);
  assert.equal(repeatedHelpGuideSlug({ ...valid, primaryUnmodified: false }), null);
  assert.equal(repeatedHelpGuideSlug({ ...valid, href: null }), null);
});

test("client help component catches same-hash click before Next Link's default handling", () => {
  const source = readFileSync("src/components/marketing/help-center-search.tsx", "utf8");
  assert.match(source, /document\.addEventListener\("click", reopenSameHashGuide, true\)/);
  assert.match(source, /document\.removeEventListener\("click", reopenSameHashGuide, true\)/);
  assert.match(source, /if \(slug\) openGuide\(slug\)/);
  assert.match(source, /window\.addEventListener\("hashchange", openHashGuide\)/);
  assert.match(source, /setGuideNavigation\(\(current\) => \(\{ slug, revision:/);
  assert.match(source, /details\.open = true/);
});
