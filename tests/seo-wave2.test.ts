import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("SEO wave 2 adds procurement and deployment decision content", () => {
  const content = read("src/lib/seo-content-wave2.ts");
  for (const slug of [
    "cloud-vs-on-premise-payroll",
    "payroll-rfp-checklist",
    "payroll-implementation-guide",
    "payroll-software-roi",
    "build-vs-buy-payroll-software",
  ]) {
    assert.ok(content.includes(`slug: "${slug}"`), `missing resource: ${slug}`);
  }
});

test("SEO wave 2 expands industry coverage", () => {
  const content = read("src/lib/seo-content-wave2.ts");
  for (const slug of ["retail", "healthcare", "hospitality", "banking-finance", "education"]) {
    assert.ok(content.includes(`slug: "${slug}"`), `missing industry: ${slug}`);
  }
});

test("calculator catalog includes holiday pay and employer payroll cost", () => {
  const catalog = read("src/lib/calculators.ts");
  const calculator = read("src/components/marketing/payroll-calculator.tsx");
  assert.ok(catalog.includes('"holiday-pay"'));
  assert.ok(catalog.includes('"payroll-cost"'));
  assert.ok(calculator.includes('slug === "holiday-pay"'));
  assert.ok(calculator.includes('slug === "payroll-cost"'));
  assert.ok(calculator.includes("employerStatutory"));
});

test("global structured data identifies the site and product without unsupported claims", () => {
  const layout = read("src/app/layout.tsx");
  assert.ok(layout.includes('"@type": "Organization"'));
  assert.ok(layout.includes('"@type": "WebSite"'));
  assert.ok(layout.includes('"@type": "SoftwareApplication"'));
  assert.ok(!layout.includes("aggregateRating"));
  assert.ok(!layout.includes("reviewRating"));
  assert.ok(!layout.includes("ISO 27001"));
});

test("wave 2 routes are included in the sitemap", () => {
  const sitemap = read("src/app/sitemap.ts");
  assert.ok(sitemap.includes("resourceWave2"));
  assert.ok(sitemap.includes("industryWave2"));
  assert.ok(sitemap.includes("Object.keys(CALCULATORS)"));
});
