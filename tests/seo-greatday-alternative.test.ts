import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resourceWave20 } from "../src/lib/seo-content-wave20";
import {
  SEO_INTENT_OWNERS,
  duplicateSeoIntentOwners,
  normalizeSeoIntent,
} from "../src/lib/seo-intent-ownership";
import { resourceSitemapEntries } from "../src/lib/sitemap-data";

const read = (path: string) => readFileSync(path, "utf8");

test("GreatDay HR alternative guide is the only Wave 20 resource", () => {
  assert.deepEqual(resourceWave20.map((page) => page.slug), ["greatday-hr-alternative"]);
});

test("GreatDay HR alternative intent has one canonical owner", () => {
  const key = normalizeSeoIntent("greatday hr alternative philippines");
  const owners = SEO_INTENT_OWNERS.filter((entry) =>
    [entry.primaryIntent, ...(entry.supportingIntents ?? [])]
      .map(normalizeSeoIntent)
      .includes(key),
  );

  assert.deepEqual(owners.map((entry) => entry.ownerPath), ["/resources/greatday-hr-alternative"]);
  assert.deepEqual(duplicateSeoIntentOwners(), []);
});

test("GreatDay comparison stays distinct from generic payroll and buyer-guide intent", () => {
  const competitor = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/resources/greatday-hr-alternative");
  const homepage = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/");
  const buyer = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/resources/best-payroll-software-philippines");

  assert.equal(competitor?.primaryIntent, "greatday hr alternative philippines");
  assert.equal(homepage?.primaryIntent, "payroll software philippines");
  assert.equal(buyer?.primaryIntent, "best payroll software philippines");
});

test("GreatDay comparison uses current official GreatDay HR sources", () => {
  const page = resourceWave20[0];
  assert.equal(page.lastReviewedIso, "2026-10-05");

  const sources = new Set(page.sources?.map((source) => source.href) ?? []);
  assert.ok(sources.has("https://greatdayhr.com/en-en/features/payroll-software/"));
  assert.ok(sources.has("https://greatdayhr.com/en-en/features/attendance-management/"));
  assert.ok(sources.has("https://greatdayhr.com/en-en/features/payroll-software/online-payslip/"));
  assert.ok(sources.has("https://greatdayhr.com/en-en/"));
  assert.ok(sources.has("https://greatdayhr.com/en-en/features/"));
  assert.ok(sources.has("https://greatdayhr.com/en-en/why-greatday/"));
});

test("GreatDay comparison preserves the Philippines statutory-scope verification boundary", () => {
  const page = JSON.stringify(resourceWave20[0]).toLowerCase();

  assert.ok(page.includes("multi-country coverage that includes the philippines"));
  assert.ok(page.includes("indonesian payroll examples such as pph 21 and bpjs"));
  assert.ok(page.includes("verify the current philippines-specific"));
  assert.ok(page.includes("not claiming to be better than greatday hr"));

  for (const forbidden of [
    "greatday hr does not support philippines",
    "greatday hr is non-compliant",
    "greatday hr is insecure",
    "greatday hr is overpriced",
    "linaw is better than greatday hr",
    "guaranteed compliance",
  ]) {
    assert.ok(!page.includes(forbidden), `competitor page contains unsupported claim: ${forbidden}`);
  }
});

test("GreatDay alternative is routed, discoverable, audited and linked from comparison hub", () => {
  const route = read("src/app/resources/[slug]/page.tsx");
  const hub = read("src/app/resources/page.tsx");
  const compare = read("src/app/compare/page.tsx");
  const audit = read("scripts/seo-launch-audit.ts");
  const paths = new Set(resourceSitemapEntries.map((entry) => entry.path));

  assert.ok(route.includes("resourceWave20"));
  assert.ok(hub.includes("resourceWave20"));
  assert.ok(hub.includes('"greatday-hr-alternative"'));
  assert.ok(paths.has("/resources/greatday-hr-alternative"));
  assert.ok(compare.includes('href: "/resources/greatday-hr-alternative"'));
  assert.ok(audit.includes("resourceWave20"));
});

test("GreatDay guide links to neutral evaluation and product-proof surfaces", () => {
  const hrefs = new Set(resourceWave20[0].related.map((item) => item.href));
  assert.ok(hrefs.has("/resources/payroll-system-comparison"));
  assert.ok(hrefs.has("/resources/best-payroll-software-philippines"));
  assert.ok(hrefs.has("/resources/sprout-payroll-alternative"));
  assert.ok(hrefs.has("/demo"));
});
