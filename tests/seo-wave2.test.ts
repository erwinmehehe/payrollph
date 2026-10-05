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

test("Wave 2 preserves the homepage-owned product and FAQ structured data", () => {
  const home = read("src/app/page.tsx");
  const layout = read("src/app/layout.tsx");
  assert.ok(home.includes('"@type": "Organization"'));
  assert.ok(home.includes('"@type": "WebSite"'));
  assert.ok(home.includes('"@type": "SoftwareApplication"'));
  assert.ok(home.includes('"@type": "FAQPage"'));
  assert.ok(!home.includes("aggregateRating"));
  assert.ok(!home.includes("reviewRating"));
  assert.ok(!layout.includes("softwareJsonLd"), "Wave 2 must not add a duplicate global software graph");
});

test("wave 2 routes are included in the sitemap", () => {
  const sitemap = read("src/lib/sitemap-data.ts");
  assert.ok(sitemap.includes("resourceWave2"));
  assert.ok(sitemap.includes("industryWave2"));
  assert.ok(sitemap.includes("Object.keys(CALCULATORS)"));
});


test("SEO wave 2 pages use distinct meta titles and FAQ depth", () => {
  const content = read("src/lib/seo-content-wave2.ts");
  for (const title of [
    "Cloud vs On-Premise Payroll Philippines | Linaw",
    "Payroll RFP Checklist Guide Philippines | Linaw",
    "Payroll System Implementation Guide Philippines | Linaw",
    "Payroll Software ROI Philippines | Evaluation Guide | Linaw",
    "Build vs Buy Payroll Software Philippines | Linaw",
    "Retail Payroll Software Philippines | Linaw",
    "Healthcare Payroll Software Philippines | Linaw",
    "Hospitality Payroll Software Philippines | Linaw",
    "Payroll Software for Finance Companies Philippines | Linaw",
    "Payroll Software for Schools Philippines | Linaw",
  ]) {
    assert.ok(content.includes(title), `missing Wave 2 meta title: ${title}`);
  }

  for (const slug of [
    "cloud-vs-on-premise-payroll",
    "payroll-rfp-checklist",
    "payroll-implementation-guide",
    "payroll-software-roi",
    "build-vs-buy-payroll-software",
    "retail",
    "healthcare",
    "hospitality",
    "banking-finance",
    "education",
  ]) {
    const start = content.indexOf(`slug: "${slug}"`);
    const end = content.indexOf("\n  },", start);
    assert.ok(start >= 0 && end > start, `missing Wave 2 page block: ${slug}`);
    assert.ok(content.slice(start, end).includes("faq: ["), `Wave 2 page must include FAQ depth: ${slug}`);
  }
});

test("BPO page carries the same FAQ depth as dynamic industry pages", () => {
  const bpo = read("src/app/industries/bpo/page.tsx");
  assert.ok(bpo.includes("What makes BPO payroll difficult in the Philippines?"));
  assert.ok(bpo.includes("Can night differential and overtime apply to the same shift?"));
});

test("calculator pages link estimates into the relevant authority cluster", () => {
  const page = read("src/app/calculators/[slug]/page.tsx");
  for (const route of [
    "/compliance/dole",
    "/compliance/sss",
    "/compliance/philhealth",
    "/compliance/pag-ibig",
    "/compliance/withholding-tax",
    "/resources/payroll-software-roi",
  ]) {
    assert.ok(page.includes(route), `calculator context links must include ${route}`);
  }
  assert.ok(page.includes("Use the estimate in context"), "calculator pages must explain the surrounding authority links");
});


