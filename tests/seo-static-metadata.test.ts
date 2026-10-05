import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { STATIC_SEO_ROUTES } from "../src/lib/static-seo-routes";
import {
  pagesSitemapEntries,
  productSitemapEntries,
  complianceSitemapEntries,
  industrySitemapEntries,
  resourceSitemapEntries,
  calculatorSitemapEntries,
  glossarySitemapEntries,
  developerSitemapEntries,
} from "../src/lib/sitemap-data";

const sitemapPaths = new Set([
  ...pagesSitemapEntries,
  ...productSitemapEntries,
  ...complianceSitemapEntries,
  ...industrySitemapEntries,
  ...resourceSitemapEntries,
  ...calculatorSitemapEntries,
  ...glossarySitemapEntries,
  ...developerSitemapEntries,
].map((entry) => entry.path));

test("static SEO route registry has unique routes and page files", () => {
  const paths = STATIC_SEO_ROUTES.map((route) => route.path);
  const files = STATIC_SEO_ROUTES.map((route) => route.pageFile);
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(new Set(files).size, files.length);
});

test("every static SEO route is represented in public sitemap data", () => {
  for (const route of STATIC_SEO_ROUTES) {
    assert.ok(sitemapPaths.has(route.path), `${route.path} must be in public sitemap data`);
  }
});

test("every static SEO page has title description and matching self-canonical", () => {
  for (const route of STATIC_SEO_ROUTES) {
    assert.ok(existsSync(route.pageFile), `${route.pageFile} must exist`);
    const source = readFileSync(route.pageFile, "utf8");

    assert.match(source, /\btitle\s*:/, `${route.path} must have title metadata`);
    assert.match(source, /\bdescription\s*:/, `${route.path} must have description metadata`);

    const doubleQuotedCanonical = `alternates: { canonical: "${route.path}" }`;
    const singleQuotedCanonical = `alternates: { canonical: '${route.path}' }`;
    assert.ok(
      source.includes(doubleQuotedCanonical) || source.includes(singleQuotedCanonical),
      `${route.path} must self-canonicalize`,
    );

    assert.doesNotMatch(
      source,
      /robots\s*:\s*\{[\s\S]{0,120}?index\s*:\s*false/,
      `${route.path} is sitemap-listed and must not be noindex`,
    );
  }
});

test("contact page is included in static metadata governance", () => {
  const contact = STATIC_SEO_ROUTES.find((route) => route.path === "/contact");
  assert.equal(contact?.pageFile, "src/app/contact/page.tsx");
});

test("dynamic authority families remain outside static page registry", () => {
  for (const route of STATIC_SEO_ROUTES) {
    assert.ok(!route.path.includes("[slug]"));
    assert.ok(!route.pageFile.includes("[slug]"));
  }
});


test("core product SEO pages keep buyer FAQ depth and service schema", () => {
  const pages = [
    ["src/app/hris/page.tsx", "What is the difference between HRIS and payroll software?"],
    ["src/app/time-and-attendance/page.tsx", "What happens when a clock-in or clock-out is missing?"],
    ["src/app/employee-self-service/page.tsx", "Can one employee view another employee's payslip?"],
    ["src/app/implementation/page.tsx", "Should we run parallel payroll before going live?"],
  ] as const;

  for (const [path, faqQuestion] of pages) {
    const source = read(path);
    assert.ok(source.includes("<StructuredData"), `${path} must publish shared structured data`);
    assert.ok(source.includes("service={{"), `${path} must expose service schema`);
    assert.ok(source.includes("faq={faq}"), `${path} must expose FAQ structured data and visible FAQ content`);
    assert.ok(source.includes(faqQuestion), `${path} must retain buyer-focused FAQ depth`);
  }
});
