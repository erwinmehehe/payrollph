import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { HELP_ARTICLES } from "../src/lib/help-center-content";

test("employee task help links are fixed public guides and never carry employee selectors", () => {
  const source = readFileSync("src/components/employee-home-dashboard.tsx", "utf8");
  for (const slug of ["find-released-payslips", "request-leave", "review-attendance"]) {
    assert.ok(HELP_ARTICLES.some((article) => article.slug === slug), slug + " must exist");
    assert.ok(source.includes('href="/help#' + slug + '"'));
  }
  assert.ok(source.includes('aria-label="Employee help guides"'));
  assert.ok(source.includes('min-h-11'), "Help links must have touch-friendly targets");
  assert.ok(!source.includes("fetch("), "Dashboard links cannot load employee data");
  assert.ok(!source.includes("localStorage"));
  assert.ok(!source.includes("sessionStorage"));
});

test("employee quick actions continue using existing self-service callbacks", () => {
  const source = readFileSync("src/components/employee-home-dashboard.tsx", "utf8");
  for (const callback of ["onPay", "onRequestLeave", "onAttendance", "onDocuments", "onProfile"]) {
    assert.ok(source.includes("onClick={" + callback + "}"));
  }
});
