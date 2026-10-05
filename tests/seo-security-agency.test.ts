import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { industryWave6 } from "../src/lib/seo-content-wave6";
import { SEO_INTENT_OWNERS } from "../src/lib/seo-intent-ownership";
import { industrySitemapEntries } from "../src/lib/sitemap-data";

const read = (path: string) => readFileSync(path, "utf8");

test("security agency payroll page exists with distinct industry intent", () => {
  const page = industryWave6.find((entry) => entry.slug === "security-agencies");
  assert.ok(page);
  assert.equal(page.metaTitle, "Security Agency Payroll Software Philippines | Linaw");

  const owner = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/industries/security-agencies");
  assert.equal(owner?.primaryIntent, "security agency payroll software philippines");
  assert.equal(owner?.intentClass, "industry");
});

test("security agency page stays scoped to implemented payroll capabilities", () => {
  const page = industryWave6.find((entry) => entry.slug === "security-agencies");
  assert.ok(page);
  const text = JSON.stringify(page);

  assert.ok(text.includes("Shift and attendance workflows"));
  assert.ok(text.includes("Overtime and night-work payroll logic"));
  assert.ok(text.includes("Maker-checker payroll release controls"));
  assert.ok(text.includes("Linaw does not claim SOSIA reporting"));
  assert.ok(text.includes("firearm tracking"));
  assert.ok(text.includes("guard-post deployment"));
  assert.ok(text.includes("guard-tour management"));
  assert.ok(!text.includes("SOSIA integration"));
  assert.ok(!text.includes("guard tour tracking"));
});

test("security agency page is discoverable from hub and sitemap", () => {
  const hub = read("src/app/industries/page.tsx");
  const paths = new Set(industrySitemapEntries.map((entry) => entry.path));

  assert.ok(hub.includes('"security-agencies"'));
  assert.ok(paths.has("/industries/security-agencies"));
});

test("security agency related links stay public and contextual", () => {
  const page = industryWave6.find((entry) => entry.slug === "security-agencies");
  assert.ok(page);
  const hrefs = page.related.map((item) => item.href);

  assert.deepEqual(hrefs, [
    "/time-and-attendance",
    "/calculators/night-differential",
    "/integrations/biometrics",
    "/compliance",
  ]);
  assert.ok(hrefs.every((href) => href.startsWith("/")));
});

test("security agency page uses existing dynamic industry route contract", () => {
  const route = read("src/app/industries/[slug]/page.tsx");
  assert.ok(route.includes("industryWave6"));
  assert.ok(route.includes("generateStaticParams"));
  assert.ok(route.includes("generateMetadata"));
  assert.ok(route.includes("service={{ name: page.title"));
});
