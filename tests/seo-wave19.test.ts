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

test("PayrollHero comparison uses Philippines-specific official sources", () => {
  const page = resourceWave19[0];
  assert.equal(page.lastReviewedIso, "2026-10-05");
  const sources = new Set(page.sources?.map((source) => source.href) ?? []);

  for (const source of [
    "https://payrollhero.com/philippine_payroll",
    "https://payrollhero.com/payroll",
    "https://payrollhero.com/faq",
    "https://support.payrollhero.com/article-categories/philippine-payroll-setup-guide/",
    "https://payrollhero.com/how-it-works",
  ]) {
    assert.ok(sources.has(source));
  }
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
    assert.ok(!page.includes(forbidden), `unsupported claim: ${forbidden}`);
  }
  assert.ok(page.includes("not claiming to be better"));
  assert.ok(page.includes("when might payrollhero fit well"));
});

test("PayrollHero guide is routed, discoverable and linked from comparison hub", () => {
  const route = read("src/app/resources/[slug]/page.tsx");
  const hub = read("src/app/resources/page.tsx");
  const compare = read("src/app/compare/page.tsx");
  const paths = new Set(resourceSitemapEntries.map((entry) => entry.path));

  assert.ok(route.includes("resourceWave19"));
  assert.ok(hub.includes("resourceWave19"));
  assert.ok(paths.has("/resources/payrollhero-alternative"));
  assert.ok(compare.includes('href: "/resources/payrollhero-alternative"'));
});

test("PayrollHero alternative stays separate from generic payroll intent", () => {
  const competitor = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/resources/payrollhero-alternative");
  const homepage = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/");
  assert.equal(competitor?.primaryIntent, "payrollhero alternative philippines");
  assert.equal(homepage?.primaryIntent, "payroll software philippines");
});
