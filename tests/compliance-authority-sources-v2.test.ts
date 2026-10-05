import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("core compliance guides expose current review dates, FAQs and official regulator sources", () => {
  const content = read("src/lib/seo-content.ts");
  const complianceRoute = read("src/app/compliance/[slug]/page.tsx");

  assert.ok(complianceRoute.includes("lastReviewed={page.lastReviewed}"));
  assert.ok(complianceRoute.includes("sources={page.sources}"));
  assert.ok(complianceRoute.includes("faq={page.faq}"));

  for (const slug of ["bir", "sss", "philhealth", "pag-ibig", "dole"]) {
    const start = content.indexOf(`slug: "${slug}"`);
    const end = content.indexOf("\n  },", start);
    assert.ok(start >= 0 && end > start, `compliance guide ${slug} must exist`);
    const block = content.slice(start, end);
    assert.ok(block.includes('lastReviewed: "October 5, 2026"'), `${slug} must expose review date`);
    assert.ok(block.includes('lastReviewedIso: "2026-10-05"'), `${slug} must expose ISO review date`);
    assert.ok(block.includes("faq: ["), `${slug} must include FAQ depth`);
    assert.ok(block.includes("sources: ["), `${slug} must include official references`);
  }

  for (const officialDomain of ["bir.gov.ph", "sss.gov.ph", "philhealth.gov.ph", "pagibigfund.gov.ph", "dole.gov.ph"]) {
    assert.ok(content.includes(officialDomain), `compliance references must include ${officialDomain}`);
  }
});

test("SSS compliance copy preserves the current official employed-member schedule", () => {
  const content = read("src/lib/seo-content.ts");
  assert.ok(content.includes("15% contribution rate"));
  assert.ok(content.includes("10% employer and 5% employee"));
  assert.ok(content.includes("₱35,000 maximum MSC"));
  assert.ok(content.includes("Employees' Compensation contribution is an employer-paid amount"));
});

test("PhilHealth compliance copy preserves the latest official premium context", () => {
  const content = read("src/lib/seo-content.ts");
  assert.ok(content.includes("premium rate for direct contributors at 5%"));
  assert.ok(content.includes("₱10,000 monthly basic salary floor"));
  assert.ok(content.includes("₱100,000 ceiling"));
  assert.ok(content.includes("Monthly Basic Salary"));
});

test("DOLE compliance copy preserves statutory premium-pay boundaries", () => {
  const content = read("src/lib/seo-content.ts");
  assert.ok(content.includes("not less than 10% of the regular wage"));
  assert.ok(content.includes("at least 25% of the regular wage"));
  assert.ok(content.includes("automated screening should surface a review rather than replace legal classification"));
});

test("newer statutory contribution issue-resolution guidance is retained", () => {
  const content = read("src/lib/seo-content.ts");
  assert.ok(content.includes("What should happen when an employee contribution record needs correction?"));
  assert.ok(content.includes("What should payroll review when a PhilHealth contribution appears wrong?"));
  assert.ok(content.includes("What should be checked when a Pag-IBIG contribution issue is reported?"));
});
