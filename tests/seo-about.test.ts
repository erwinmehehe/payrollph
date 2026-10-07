import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { SEO_INTENT_OWNERS, normalizeSeoIntent } from "../src/lib/seo-intent-ownership";
import { pagesSitemapEntries } from "../src/lib/sitemap-data";

const read = (path: string) => readFileSync(path, "utf8");

test("About Linaw page uses branded trust intent, not generic payroll software ownership", () => {
  const about = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/about");
  const homepage = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/");

  assert.equal(about?.primaryIntent, "about linaw payrollph");
  assert.equal(about?.intentClass, "trust");
  assert.equal(homepage?.primaryIntent, "payroll software philippines");
  assert.notEqual(
    normalizeSeoIntent(about?.primaryIntent ?? ""),
    normalizeSeoIntent(homepage?.primaryIntent ?? ""),
  );
});

test("About page is indexable, canonical and included in public sitemap data", () => {
  const page = read("src/app/about/page.tsx");
  const paths = new Set(pagesSitemapEntries.map((entry) => entry.path));

  assert.ok(page.includes('title: "About Linaw | Philippine Payroll Software"'));
  assert.ok(page.includes('canonical: "/about"'));
  assert.equal(page.includes("robots: { index: false"), false);
  assert.ok(paths.has("/about"));
});

test("About page does not import unsupported JeonSoft history or client-count claims", () => {
  const page = read("src/app/about/page.tsx");

  assert.equal(/jeonsoft/i.test(page), false);
  assert.equal(/26\s*years/i.test(page), false);
  assert.equal(/2,?500\+?/i.test(page), false);
  assert.equal(/420,?000\+?/i.test(page), false);
  assert.equal(/most trusted/i.test(page), false);
  assert.equal(/\bmarket leader\b/i.test(page), false);
  assert.equal(/leading payroll/i.test(page), false);
});

test("About page directs buyers to evidence without inventing endorsements", () => {
  const page = read("src/app/about/page.tsx");
  assert.ok(page.includes("Review the controls behind the product."));
  assert.ok(page.includes('"/methodology"'));
  assert.ok(page.includes('"/trust"'));
  assert.doesNotMatch(page, /government[- ]endorsed|ISO[- ]certified|SOC[- ]2[- ]certified/i);
});

test("About page links to evidence and evaluation surfaces", () => {
  const page = read("src/app/about/page.tsx");
  for (const href of ["/trust", "/methodology", "/security", "/developers", "/demo", "/book-demo"]) {
    assert.ok(page.includes(`"${href}"`), `About page must link ${href}`);
  }
});

test("About page is discoverable from footer trust navigation and llms.txt", () => {
  const nav = read("src/components/marketing/public-navigation.ts");
  const llms = read("src/app/llms.txt/route.ts");

  assert.ok(nav.includes('{ label: "About Linaw", href: "/about" }'));
  assert.ok(llms.includes('absolutePublicUrl("/about")'));
});
