import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { industryWave6 } from "../src/lib/seo-content-wave6";
import { SEO_INTENT_OWNERS } from "../src/lib/seo-intent-ownership";
import { industrySitemapEntries } from "../src/lib/sitemap-data";

const read = (path: string) => readFileSync(path, "utf8");

test("security agency payroll page owns distinct industry intent", () => {
  const page = industryWave6.find((entry) => entry.slug === "security-agencies");
  assert.ok(page);
  assert.equal(page.metaTitle, "Security Agency Payroll Software Philippines | Linaw");
  assert.equal(page.lastReviewedIso, "2026-10-05");

  const owner = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/industries/security-agencies");
  assert.equal(owner?.primaryIntent, "security agency payroll software philippines");
  assert.equal(owner?.intentClass, "industry");
});

test("security agency content stays limited to implemented payroll capabilities", () => {
  const page = industryWave6.find((entry) => entry.slug === "security-agencies");
  assert.ok(page);
  const content = JSON.stringify(page);

  for (const capability of [
    "Shift and attendance workflows",
    "Overtime and night-work payroll logic",
    "Maker-checker payroll release controls",
  ]) {
    assert.ok(content.includes(capability), `page must retain ${capability}`);
  }

  assert.ok(content.includes("Linaw does not claim SOSIA reporting"));
  assert.ok(content.includes("firearm tracking"));
  assert.ok(content.includes("guard-post deployment"));
  assert.ok(content.includes("guard-tour management"));
  assert.ok(content.includes("guard scheduling"));
  assert.ok(!content.includes("SOSIA integration"));
  assert.ok(!content.includes("guard tour tracking"));
});

test("security agency page is discoverable and indexable through existing industry contracts", () => {
  const hub = read("src/app/industries/page.tsx");
  const route = read("src/app/industries/[slug]/page.tsx");
  const paths = new Set(industrySitemapEntries.map((entry) => entry.path));

  assert.ok(hub.includes('"security-agencies"'));
  assert.ok(paths.has("/industries/security-agencies"));
  assert.ok(route.includes("industryWave6"));
  assert.ok(route.includes("generateStaticParams"));
  assert.ok(route.includes("generateMetadata"));
  assert.ok(route.includes("lastReviewed={page.lastReviewed}"));
});

test("security agency related links stay public and payroll-contextual", () => {
  const page = industryWave6.find((entry) => entry.slug === "security-agencies");
  assert.ok(page);
  assert.deepEqual(page.related.map((item) => item.href), [
    "/time-and-attendance",
    "/calculators/night-differential",
    "/integrations/biometrics",
    "/compliance",
  ]);
});
