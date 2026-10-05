import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resourceWave18 } from "../src/lib/seo-content-wave18";
import {
  SEO_INTENT_OWNERS,
  duplicateSeoIntentOwners,
  normalizeSeoIntent,
} from "../src/lib/seo-intent-ownership";
import { resourceSitemapEntries } from "../src/lib/sitemap-data";

const read = (path: string) => readFileSync(path, "utf8");

test("Salarium alternative guide is the only Wave 18 resource", () => {
  assert.deepEqual(resourceWave18.map((page) => page.slug), ["salarium-alternative"]);
});

test("Salarium alternative intent has one canonical owner", () => {
  const key = normalizeSeoIntent("salarium alternative philippines");
  const owners = SEO_INTENT_OWNERS.filter((entry) =>
    [entry.primaryIntent, ...(entry.supportingIntents ?? [])]
      .map(normalizeSeoIntent)
      .includes(key),
  );

  assert.deepEqual(owners.map((entry) => entry.ownerPath), ["/resources/salarium-alternative"]);
  assert.deepEqual(duplicateSeoIntentOwners(), []);
});

test("Salarium comparison stays separate from generic payroll-software intent", () => {
  const competitor = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/resources/salarium-alternative");
  const homepage = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/");
  const buyer = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/resources/best-payroll-software-philippines");

  assert.equal(competitor?.primaryIntent, "salarium alternative philippines");
  assert.equal(homepage?.primaryIntent, "payroll software philippines");
  assert.equal(buyer?.primaryIntent, "best payroll software philippines");
});

test("Salarium comparison uses current official Salarium support sources", () => {
  const page = resourceWave18[0];
  assert.equal(page.lastReviewedIso, "2026-10-05");

  const sources = page.sources ?? [];
  assert.ok(sources.length >= 5);
  assert.ok(sources.every((source) => source.href.startsWith("https://support.salarium.com/")));
  assert.ok(sources.some((source) => source.href.includes("download-employee-201-files")));
  assert.ok(sources.some((source) => source.href.includes("regenerate-attendance")));
  assert.ok(sources.some((source) => source.href.includes("what-is-scheduled-overtime")));
  assert.ok(sources.some((source) => source.href.includes("generate-sss-forms")));
  assert.ok(sources.some((source) => source.href.includes("clock-in-and-out-via-ess-web-bundy")));
});

test("Salarium comparison avoids unsupported superiority and defect claims", () => {
  const page = JSON.stringify(resourceWave18[0]).toLowerCase();

  for (const forbidden of [
    "linaw is better than salarium",
    "linaw is the best",
    "salarium is insecure",
    "salarium is non-compliant",
    "salarium is overpriced",
    "salarium is worse",
    "guaranteed compliance",
  ]) {
    assert.ok(!page.includes(forbidden), `competitor page contains unsupported claim: ${forbidden}`);
  }

  assert.ok(page.includes("is linaw claiming to be better than salarium?"));
  assert.ok(page.includes("buyers should verify current product packaging"));
});

test("Salarium alternative is routed, discoverable, audited and linked from comparison hub", () => {
  const route = read("src/app/resources/[slug]/page.tsx");
  const hub = read("src/app/resources/page.tsx");
  const compare = read("src/app/compare/page.tsx");
  const audit = read("scripts/seo-launch-audit.ts");
  const paths = new Set(resourceSitemapEntries.map((entry) => entry.path));

  assert.ok(route.includes("resourceWave18"));
  assert.ok(hub.includes("resourceWave18"));
  assert.ok(hub.includes('"salarium-alternative"'));
  assert.ok(paths.has("/resources/salarium-alternative"));
  assert.ok(compare.includes('href: "/resources/salarium-alternative"'));
  assert.ok(audit.includes("resourceWave18"));
});

test("Salarium guide links to neutral evaluation and proof surfaces", () => {
  const hrefs = new Set(resourceWave18[0].related.map((item) => item.href));
  assert.ok(hrefs.has("/resources/payroll-system-comparison"));
  assert.ok(hrefs.has("/resources/best-payroll-software-philippines"));
  assert.ok(hrefs.has("/resources/sprout-payroll-alternative"));
  assert.ok(hrefs.has("/demo"));
});
