import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resourceWave14 } from "../src/lib/seo-content-wave14";
import { SEO_INTENT_OWNERS, normalizeSeoIntent } from "../src/lib/seo-intent-ownership";
import { resourceSitemapEntries } from "../src/lib/sitemap-data";

const read = (path: string) => readFileSync(path, "utf8");

test("Wave 14 adds the four remaining distinct BOFU guides", () => {
  const slugs = resourceWave14.map((page) => page.slug);
  assert.deepEqual(slugs.sort(), [
    "hris-vs-payroll-system",
    "payroll-outsourcing-cost",
    "payroll-outsourcing-guide",
    "payroll-system-comparison",
  ].sort());
});

test("Wave 14 pages have unique metadata titles", () => {
  const titles = resourceWave14.map((page) => page.metaTitle ?? `${page.title} | Linaw`);
  assert.equal(new Set(titles.map((title) => title.toLowerCase())).size, titles.length);
});

test("HRIS vs payroll guide stays distinct from HRIS commercial intent", () => {
  const commercial = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/hris");
  const guide = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/resources/hris-vs-payroll-system");

  assert.equal(commercial?.primaryIntent, "hris philippines");
  assert.equal(guide?.primaryIntent, "hris vs payroll system philippines");
  assert.notEqual(normalizeSeoIntent(commercial?.primaryIntent ?? ""), normalizeSeoIntent(guide?.primaryIntent ?? ""));
});

test("payroll outsourcing commercial page remains the only generic outsourcing owner", () => {
  const generic = normalizeSeoIntent("payroll outsourcing philippines");
  const owners = SEO_INTENT_OWNERS.filter((entry) =>
    [entry.primaryIntent, ...(entry.supportingIntents ?? [])].map(normalizeSeoIntent).includes(generic),
  );

  assert.deepEqual(owners.map((entry) => entry.ownerPath), ["/payroll-outsourcing"]);

  const processGuide = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/resources/payroll-outsourcing-guide");
  const costGuide = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/resources/payroll-outsourcing-cost");

  assert.equal(processGuide?.primaryIntent, "how payroll outsourcing works philippines");
  assert.equal(costGuide?.primaryIntent, "payroll outsourcing cost philippines");
});

test("payroll system comparison stays distinct from best-payroll-software buyer guide", () => {
  const comparison = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/resources/payroll-system-comparison");
  const best = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/resources/best-payroll-software-philippines");

  assert.equal(comparison?.primaryIntent, "payroll system comparison philippines");
  assert.equal(best?.primaryIntent, "best payroll software philippines");
  assert.notEqual(normalizeSeoIntent(comparison?.primaryIntent ?? ""), normalizeSeoIntent(best?.primaryIntent ?? ""));
});

test("outsourcing cost guide explains cost drivers without inventing price figures", () => {
  const page = resourceWave14.find((entry) => entry.slug === "payroll-outsourcing-cost");
  assert.ok(page);
  const text = JSON.stringify(page);

  assert.ok(text.includes("Headcount affects recurring processing volume"));
  assert.ok(text.includes("Service scope changes the commercial model"));
  assert.ok(!/₱\s*\d|PHP\s*\d|\$\s*\d/.test(text));
});

test("outsourcing guide preserves employer approval responsibility", () => {
  const page = resourceWave14.find((entry) => entry.slug === "payroll-outsourcing-guide");
  assert.ok(page);
  const text = JSON.stringify(page);

  assert.ok(text.includes("Employer approval should remain explicit"));
  assert.ok(text.includes("authorized employer representatives should retain control"));
  assert.ok(!text.includes("guaranteed"));
});

test("Wave 14 resources are routed, discoverable and included in sitemap data", () => {
  const route = read("src/app/resources/[slug]/page.tsx");
  const hub = read("src/app/resources/page.tsx");
  const paths = new Set(resourceSitemapEntries.map((entry) => entry.path));

  assert.ok(route.includes("resourceWave14"));
  assert.ok(hub.includes("resourceWave14"));

  for (const page of resourceWave14) {
    assert.ok(paths.has(`/resources/${page.slug}`), `${page.slug} must be in resource sitemap data`);
  }
});

test("Wave 14 related links remain contextual and public", () => {
  for (const page of resourceWave14) {
    assert.ok(page.related.length >= 3);
    for (const related of page.related) {
      assert.ok(related.href.startsWith("/"));
      assert.ok(!related.href.startsWith("/login"));
      assert.ok(!related.href.startsWith("/signup"));
      assert.ok(!related.href.startsWith("/app"));
    }
  }
});
