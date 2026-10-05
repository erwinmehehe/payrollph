import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resourceWave17 } from "../src/lib/seo-content-wave17";
import {
  SEO_INTENT_OWNERS,
  duplicateSeoIntentOwners,
  normalizeSeoIntent,
} from "../src/lib/seo-intent-ownership";
import { resourceSitemapEntries } from "../src/lib/sitemap-data";

const read = (path: string) => readFileSync(path, "utf8");

test("Sprout alternative guide is the only Wave 17 resource", () => {
  assert.deepEqual(resourceWave17.map((page) => page.slug), ["sprout-payroll-alternative"]);
});

test("Sprout alternative intent has one canonical owner", () => {
  const key = normalizeSeoIntent("sprout payroll alternative philippines");
  const owners = SEO_INTENT_OWNERS.filter((entry) =>
    [entry.primaryIntent, ...(entry.supportingIntents ?? [])]
      .map(normalizeSeoIntent)
      .includes(key),
  );

  assert.deepEqual(owners.map((entry) => entry.ownerPath), ["/resources/sprout-payroll-alternative"]);
  assert.deepEqual(duplicateSeoIntentOwners(), []);
});

test("Sprout alternative page remains distinct from broad payroll intent", () => {
  const competitor = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/resources/sprout-payroll-alternative");
  const homepage = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/");
  const buyer = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/resources/best-payroll-software-philippines");

  assert.equal(competitor?.primaryIntent, "sprout payroll alternative philippines");
  assert.equal(homepage?.primaryIntent, "payroll software philippines");
  assert.equal(buyer?.primaryIntent, "best payroll software philippines");
});

test("Sprout comparison uses current official Sprout source pages", () => {
  const page = resourceWave17[0];
  assert.equal(page.lastReviewedIso, "2026-10-05");

  const sources = new Set(page.sources?.map((source) => source.href) ?? []);
  assert.ok(sources.has("https://sprout.ph/product/payroll-management/"));
  assert.ok(sources.has("https://sprout.ph/"));
  assert.ok(sources.has("https://sprout.ph/product/payroll-outsourcing/"));
  assert.ok(sources.has("https://sprout.ph/product/sprout-comply/"));
});

test("Sprout comparison avoids unsupported universal superiority claims", () => {
  const page = JSON.stringify(resourceWave17[0]).toLowerCase();

  for (const forbidden of [
    "linaw is better than sprout",
    "linaw is the best",
    "sprout is insecure",
    "sprout is non-compliant",
    "sprout is overpriced",
    "sprout is worse",
    "guaranteed compliance",
  ]) {
    assert.ok(!page.includes(forbidden), `competitor page contains unsupported claim: ${forbidden}`);
  }

  assert.ok(page.includes("not a universal ranking"));
  assert.ok(page.includes("when might sprout be a better fit"));
  assert.ok(page.includes("buyers should verify current product scope and commercial terms directly with sprout"));
});

test("Sprout alternative guide is routed, discoverable and linked from comparison hub", () => {
  const route = read("src/app/resources/[slug]/page.tsx");
  const hub = read("src/app/resources/page.tsx");
  const compare = read("src/app/compare/page.tsx");
  const paths = new Set(resourceSitemapEntries.map((entry) => entry.path));

  assert.ok(route.includes("resourceWave17"));
  assert.ok(hub.includes("resourceWave17"));
  assert.ok(paths.has("/resources/sprout-payroll-alternative"));
  assert.ok(compare.includes('href: "/resources/sprout-payroll-alternative"'));
});

test("Sprout alternative guide links to neutral evaluation and proof surfaces", () => {
  const hrefs = new Set(resourceWave17[0].related.map((item) => item.href));
  assert.ok(hrefs.has("/resources/payroll-system-comparison"));
  assert.ok(hrefs.has("/resources/best-payroll-software-philippines"));
  assert.ok(hrefs.has("/scorecard"));
  assert.ok(hrefs.has("/demo"));
});
