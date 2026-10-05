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


test("SEO wave 2 pages use distinct meta titles and FAQ depth", () => {
  const content = read("src/lib/seo-content-wave2.ts");
  for (const title of [
    "Cloud vs On-Premise Payroll Philippines | Linaw",
    "Payroll Software RFP Checklist Philippines | Linaw",
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
    "/compliance/bir",
    "/resources/payroll-software-roi",
  ]) {
    assert.ok(page.includes(route), `calculator context links must include ${route}`);
  }
  assert.ok(page.includes("Use the estimate in context"), "calculator pages must explain the surrounding authority links");
});

test("structured product identity is global and not duplicated on the homepage", () => {
  const layout = read("src/app/layout.tsx");
  const home = read("src/app/page.tsx");
  for (const type of ['"@type": "Organization"', '"@type": "WebSite"', '"@type": "SoftwareApplication"']) {
    assert.ok(layout.includes(type), `global graph must include ${type}`);
  }
  assert.ok(layout.includes('"@id": `${PUBLIC_SITE_URL}/#software`'), "software entity must have a stable global ID");
  assert.ok(!home.includes("softwareSchema"), "homepage must not emit a second software graph");
  assert.ok(!home.includes('"@type": "SoftwareApplication"'), "homepage must not duplicate SoftwareApplication structured data");
});
