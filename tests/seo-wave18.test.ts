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

test("Salarium comparison uses official Salarium support sources", () => {
  const page = resourceWave18[0];
  assert.equal(page.lastReviewedIso, "2026-10-05");
  const sources = new Set(page.sources?.map((source) => source.href) ?? []);

  for (const source of [
    "https://support.salarium.com/portal/en/kb/articles/download-employee-201-files",
    "https://support.salarium.com/portal/en/kb/articles/regenerate-attendance",
    "https://support.salarium.com/portal/en/kb/articles/what-is-scheduled-overtime",
    "https://support.salarium.com/portal/en/kb/articles/generate-sss-forms",
    "https://support.salarium.com/portal/en/kb/articles/clock-in-and-out-via-ess-web-bundy",
  ]) {
    assert.ok(sources.has(source));
  }
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
    assert.ok(!page.includes(forbidden), `unsupported claim: ${forbidden}`);
  }
  assert.ok(page.includes("is linaw claiming to be better than salarium?"));
  assert.ok(page.includes("no. this is an alternative-comparison guide"));
  assert.ok(page.includes("when might salarium fit well"));
});

test("Salarium guide is routed, discoverable and linked from comparison hub", () => {
  const route = read("src/app/resources/[slug]/page.tsx");
  const hub = read("src/app/resources/page.tsx");
  const compare = read("src/app/compare/page.tsx");
  const paths = new Set(resourceSitemapEntries.map((entry) => entry.path));

  assert.ok(route.includes("resourceWave18"));
  assert.ok(hub.includes("resourceWave18"));
  assert.ok(paths.has("/resources/salarium-alternative"));
  assert.ok(compare.includes('href: "/resources/salarium-alternative"'));
});

test("Salarium alternative stays separate from generic payroll software intent", () => {
  const competitor = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/resources/salarium-alternative");
  const homepage = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/");
  assert.equal(competitor?.primaryIntent, "salarium alternative philippines");
  assert.equal(homepage?.primaryIntent, "payroll software philippines");
});
