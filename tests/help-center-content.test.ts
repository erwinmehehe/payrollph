import assert from "node:assert/strict";
import test from "node:test";
import { HELP_ARTICLES, HELP_AUDIENCES, searchHelpArticles } from "../src/lib/help-center-content";

test("help catalog has useful, unique, static and accessible steps", () => {
  assert.ok(HELP_ARTICLES.length >= 10);
  assert.equal(new Set(HELP_ARTICLES.map((article) => article.slug)).size, HELP_ARTICLES.length);
  for (const article of HELP_ARTICLES) {
    assert.match(article.slug, /^[a-z0-9-]+$/);
    assert.ok(article.title.trim() && article.summary.trim());
    assert.ok(HELP_AUDIENCES.includes(article.audience));
    assert.ok(article.steps.length >= 3);
    assert.ok(article.steps.every((step) => step.trim().length > 10));
    assert.match(article.related.href, /^\/(?!\/)[a-z0-9/-]+$/);
    assert.equal(article.related.href.includes("/api/"), false);
  }
});

test("search is case-insensitive, role-scoped and has an honest empty result", () => {
  assert.ok(searchHelpArticles("PAYSLIP").some((article) => article.slug === "find-released-payslips"));
  assert.ok(searchHelpArticles("leave", "Employees").every((article) => article.audience === "Employees"));
  assert.ok(searchHelpArticles("leave", "Managers").every((article) => article.audience === "Managers"));
  assert.equal(searchHelpArticles("no-such-topic-123").length, 0);
  assert.equal(searchHelpArticles("  ").length, HELP_ARTICLES.length);
});
