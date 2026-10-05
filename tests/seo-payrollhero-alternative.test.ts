import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resourceWave19 } from "../src/lib/seo-content-wave19";
import {
  SEO_INTENT_OWNERS,
  duplicateSeoIntentOwners,
  normalizeSeoIntent,
} from "../src/lib/seo-intent-ownership";
import { resourceSitemapEntries } from "../src/lib/sitemap-data";

const read = (path: string) => readFileSync(path, "utf8");

test("PayrollHero alternative guide is the only Wave 19 resource", () => {
  assert.deepEqual(resourceWave19.map((page) => page.slug), ["payrollhero-alternative"]);
});

test("PayrollHero alternative intent has one canonical owner", () => {
  const key = normalizeSeoIntent("payrollhero alternative philippines");
  const owners = SEO_INTENT_OWNERS.filter((entry) =>
    [entry.primaryIntent, ...(entry.supportingIntents ?? [])]
      .map(normalizeSeoIntent)
      .includes(key),
  );

  assert.deepEqual(owners.map((entry) => entry.ownerPath), ["/resources/payrollhero-alternative"]);
  assert.deepEqual(duplicateSeoIntentOwners(), []);
});

test("PayrollHero comparison stays separate from broad payroll intent", () => {
  const competitor = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/resources/payrollhero-alternative");
  const homepage = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/");
  const buyer = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/resources/best-payroll-software-philippines");

  assert.equal(competitor?.primaryIntent, "payrollhero alternative philippines");
  assert.equal(homepage?.primaryIntent, "payroll software philippines");
  assert.equal(buyer?.primaryIntent, "best payroll software philippines");
});

test("PayrollHero comparison uses official PayrollHero source pages", () => {
  const page = resourceWave19[0];
  assert.equal(page.lastReviewedIso, "2026-10-05");

  const sources = new Set(page.sources?.map((source) => source.href) ?? []);
  assert.ok(sources.has("https://payrollhero.com/philippine_payroll"));
  assert.ok(sources.has("https://payrollhero.com/payroll"));
  assert.ok(sources.has("https://payrollhero.com/faq"));
  assert.ok(sources.has("https://support.payrollhero.com/article-categories/philippine-payroll-setup-guide/"));
  assert.ok(sources.has("https://payrollhero.com/how-it-works"));
});

test("PayrollHero comparison avoids unsupported superiority and defect claims", () => {
  const page = JSON.stringify(resourceWave19[0]).toLowerCase();

  for (const forbidden of [
    "linaw is better than payrollhero",
    "linaw is the best",
    "payrollhero is insecure",
    "payrollhero is non-compliant",
    "payrollhero is overpriced",
    "payrollhero is worse",
    "guaranteed compliance",
  ]) {
    assert.ok(!page.includes(forbidden), `competitor page contains unsupported claim: ${forbidden}`);
  }

  assert.ok(page.includes("is linaw claiming to be better than payrollhero?"));
  assert.ok(page.includes("buyers should confirm current packaging"));
});

test("PayrollHero alternative is routed, discoverable, audited and linked from comparison hub", () => {
  const route = read("src/app/resources/[slug]/page.tsx");
  const hub = read("src/app/resources/page.tsx");
  const compare = read("src/app/compare/page.tsx");
  const audit = read("scripts/seo-launch-audit.ts");
  const paths = new Set(resourceSitemapEntries.map((entry) => entry.path));

  assert.ok(route.includes("resourceWave19"));
  assert.ok(hub.includes("resourceWave19"));
  assert.ok(hub.includes('"payrollhero-alternative"'));
  assert.ok(paths.has("/resources/payrollhero-alternative"));
  assert.ok(compare.includes('href: "/resources/payrollhero-alternative"'));
  assert.ok(audit.includes("resourceWave19"));
});

test("PayrollHero guide links to neutral evaluation and comparison surfaces", () => {
  const hrefs = new Set(resourceWave19[0].related.map((item) => item.href));
  assert.ok(hrefs.has("/resources/payroll-system-comparison"));
  assert.ok(hrefs.has("/resources/sprout-payroll-alternative"));
  assert.ok(hrefs.has("/resources/salarium-alternative"));
  assert.ok(hrefs.has("/demo"));
});
