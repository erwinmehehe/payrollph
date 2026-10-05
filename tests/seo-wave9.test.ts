import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("sitemap.xml is an index with segmented child sitemaps", () => {
  assert.ok(existsSync("src/app/sitemap.xml/route.ts"));
  const indexRoute = read("src/app/sitemap.xml/route.ts");
  const data = read("src/lib/sitemap-data.ts");

  assert.ok(indexRoute.includes("renderSitemapIndex"));
  assert.ok(data.includes("<sitemapindex"));
  for (const path of [
    "/pages-sitemap.xml",
    "/products-sitemap.xml",
    "/compliance-sitemap.xml",
    "/industries-sitemap.xml",
    "/resources-sitemap.xml",
    "/calculators-sitemap.xml",
    "/glossary-sitemap.xml",
    "/developers-sitemap.xml",
  ]) {
    assert.ok(data.includes(path), `sitemap index must include ${path}`);
  }
});

test("each segmented sitemap has an explicit route handler", () => {
  for (const path of [
    "src/app/pages-sitemap.xml/route.ts",
    "src/app/products-sitemap.xml/route.ts",
    "src/app/compliance-sitemap.xml/route.ts",
    "src/app/industries-sitemap.xml/route.ts",
    "src/app/resources-sitemap.xml/route.ts",
    "src/app/calculators-sitemap.xml/route.ts",
    "src/app/glossary-sitemap.xml/route.ts",
    "src/app/developers-sitemap.xml/route.ts",
    "src/app/customer-stories-sitemap.xml/route.ts",
  ]) {
    assert.ok(existsSync(path), `${path} must exist`);
    const route = read(path);
    assert.ok(route.includes("sitemapResponse"));
    assert.ok(route.includes('dynamic = "force-static"'));
  }
});

test("operational and authentication routes never enter sitemap data", () => {
  const data = read("src/lib/sitemap-data.ts");
  for (const route of [
    'path: "/login"',
    'path: "/signup"',
    'path: "/app"',
    'path: "/workspace"',
    'path: "/setup"',
    'path: "/invite"',
    'path: "/reset-password"',
    'path: "/verify-email"',
    'path: "/api"',
  ]) {
    assert.ok(!data.includes(route), `sitemap data must exclude ${route}`);
  }
});

test("customer sitemap is omitted from the index until approved proof exists", () => {
  const data = read("src/lib/sitemap-data.ts");
  assert.ok(data.includes("CUSTOMER_STORIES.filter((story) => story.approved)"));
  assert.ok(data.includes("if (approvedStories.length === 0) return []"));
  assert.ok(data.includes('"/customer-stories-sitemap.xml"'));
  assert.ok(data.includes("approvedCustomerSitemapEntries().length > 0"));
});

test("robots points to sitemap index and only blocks private app/API surfaces", () => {
  const robots = read("src/app/robots.ts");
  assert.ok(robots.includes('sitemap: absolutePublicUrl("/sitemap.xml")'));
  assert.ok(robots.includes('"/api/"'));
  assert.ok(robots.includes('"/app"'));
  assert.ok(robots.includes('"/workspace"'));

  for (const crawlableNoindexRoute of [
    '"/setup/"',
    '"/invite/"',
    '"/reset-password/"',
    '"/verify-email/"',
    '"/login/"',
    '"/signup/"',
  ]) {
    assert.ok(!robots.includes(crawlableNoindexRoute));
  }
});

test("setup workflow is explicitly noindex", () => {
  const setup = read("src/app/setup/page.tsx");
  assert.ok(setup.includes("robots: { index: false, follow: false }"));
});

test("old monolithic Next.js metadata sitemap is removed", () => {
  assert.equal(existsSync("src/app/sitemap.ts"), false);
});

test("segmented sitemap sources preserve all major SEO families", () => {
  const data = read("src/lib/sitemap-data.ts");
  for (const signal of [
    "resourceWave2",
    "resourceWave3",
    "industryWave2",
    "industryWave6",
    "integrationWave6",
    "complianceWave3",
    "glossaryEntries",
    "regulatoryUpdates",
    "Object.keys(CALCULATORS)",
  ]) {
    assert.ok(data.includes(signal), `segmented sitemap data must preserve ${signal}`);
  }
});


test("canonical site fallback is payroll.ph, never the preview deployment", () => {
  const siteUrl = read("src/lib/site-url.ts");
  assert.ok(siteUrl.includes('"https://payroll.ph"'));
  assert.ok(!siteUrl.includes("vercel.app"));
  assert.ok(siteUrl.includes("APP_BASE_URL"));
});

test("production canonical environment guidance is documented", () => {
  const env = read(".env.local.example");
  assert.ok(env.includes("Production must set the canonical public origin"));
  assert.ok(env.includes("https://payroll.ph"));
});
