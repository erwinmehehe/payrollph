import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { HELP_ARTICLES } from "../src/lib/help-center-content";

test("popular task links target real, public help guides", () => {
  const source = readFileSync("src/components/marketing/help-center-search.tsx", "utf8");
  const slugs = [
    "find-released-payslips", "request-leave", "review-attendance",
    "new-employee-checklists", "first-payroll-preparation",
  ];
  for (const slug of slugs) {
    assert.ok(HELP_ARTICLES.some((article) => article.slug === slug));
    assert.ok(source.includes('slug: "' + slug + '"'));
  }
  assert.ok(source.includes('aria-label="Popular help tasks"'));
  assert.ok(source.includes('type="button" onClick={() => openGuide(guide.slug)}'));
  assert.ok(source.includes('min-h-11'));
});

test("guide navigation resets filters, opens steps and supports direct hashes without private APIs", () => {
  const source = readFileSync("src/components/marketing/help-center-search.tsx", "utf8");
  assert.ok(source.includes('setAudience("All")'));
  assert.ok(source.includes('setQuery("")'));
  assert.ok(source.includes("window.location.hash.slice(1)"));
  assert.ok(source.includes('window.addEventListener("hashchange", openHashGuide)'));
  assert.ok(source.includes("details.open = true"));
  assert.ok(source.includes('article.querySelector<HTMLElement>("summary")?.focus'));
  assert.ok(!source.includes('fetch('));
  assert.ok(!source.includes('organizationId'));
});
