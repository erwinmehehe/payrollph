import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { HELP_ARTICLES, HELP_AUDIENCES } from "../src/lib/help-center-content";
import { HELP_ONBOARDING_PATHS } from "../src/lib/help-onboarding-paths";

test("each existing public role has its own guided path with real matching articles", () => {
  assert.deepEqual(HELP_ONBOARDING_PATHS.map((path) => path.audience), HELP_AUDIENCES);
  const slugs = new Set(HELP_ARTICLES.map((article) => article.slug));
  for (const path of HELP_ONBOARDING_PATHS) {
    assert.ok(path.description.length > 30);
    assert.ok(path.steps.length >= 3);
    assert.equal(new Set(path.steps.map((step) => step.guideSlug)).size, path.steps.length);
    for (const step of path.steps) {
      assert.match(step.guideSlug, /^[a-z0-9-]+$/);
      assert.ok(slugs.has(step.guideSlug));
      assert.equal(HELP_ARTICLES.find((article) => article.slug === step.guideSlug)?.audience, path.audience);
      assert.ok(step.purpose.length > 20);
    }
  }
});

test("role guides are public hash links to existing expandable help content", () => {
  const page = readFileSync("src/app/help/page.tsx", "utf8");
  const component = readFileSync("src/components/marketing/help-onboarding-paths.tsx", "utf8");
  const search = readFileSync("src/components/marketing/help-center-search.tsx", "utf8");
  assert.match(page, /<HelpOnboardingPaths \/>/);
  assert.match(page, /<HelpCenterSearch \/>/);
  assert.match(component, /href=\{"\/help#" \+ step\.guideSlug\}/);
  assert.match(component, /<ol className=/);
  assert.match(component, /aria-labelledby="role-onboarding-heading"/);
  assert.match(search, /window\.addEventListener\("hashchange", openHashGuide\)/);
  assert.match(search, /details\.open = true/);
  assert.ok(!component.includes("fetch("));
  assert.ok(!component.includes("/api/"));
});

test("public onboarding content does not claim payroll or manager approval authority", () => {
  const newSlugs = ["manager-team-view", "manager-handoff", "payroll-exceptions", "payroll-checker-evidence"];
  for (const slug of newSlugs) {
    const item = HELP_ARTICLES.find((article) => article.slug === slug);
    assert.ok(item);
    assert.equal(item.steps.length, 4);
    assert.ok(item.note);
    assert.ok(/not |does not |until |only /i.test(item.note));
    assert.ok(item.related.href.startsWith("/"));
  }
});
