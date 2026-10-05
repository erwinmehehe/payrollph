import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  SEO_INTENT_OWNERS,
  SEO_PRIVATE_ROUTE_PREFIXES,
  duplicateSeoIntentOwners,
  duplicateSeoOwnerPaths,
  normalizeSeoIntent,
} from "../src/lib/seo-intent-ownership";
import {
  approvedCustomerSitemapEntries,
  calculatorSitemapEntries,
  complianceSitemapEntries,
  developerSitemapEntries,
  glossarySitemapEntries,
  industrySitemapEntries,
  pagesSitemapEntries,
  productSitemapEntries,
  resourceSitemapEntries,
} from "../src/lib/sitemap-data";
import { compliancePages, industryPages, resourcePages } from "../src/lib/seo-content";
import { industryWave2, resourceWave2 } from "../src/lib/seo-content-wave2";
import { complianceWave3, resourceWave3 } from "../src/lib/seo-content-wave3";
import { industryWave6, integrationWave6 } from "../src/lib/seo-content-wave6";
import { resourceWave14 } from "../src/lib/seo-content-wave14";
import { resourceWave16 } from "../src/lib/seo-content-wave16";
import { resourceWave17 } from "../src/lib/seo-content-wave17";
import { resourceWave18 } from "../src/lib/seo-content-wave18";

const read = (path: string) => readFileSync(path, "utf8");

const sitemapPaths = new Set([
  ...pagesSitemapEntries,
  ...productSitemapEntries,
  ...complianceSitemapEntries,
  ...industrySitemapEntries,
  ...resourceSitemapEntries,
  ...calculatorSitemapEntries,
  ...glossarySitemapEntries,
  ...developerSitemapEntries,
  ...approvedCustomerSitemapEntries(),
].map((entry) => entry.path));

test("every declared primary/supporting SEO intent has exactly one owner", () => {
  assert.deepEqual(duplicateSeoIntentOwners(), []);
});

test("every owner path appears once in the central intent registry", () => {
  assert.deepEqual(duplicateSeoOwnerPaths(), []);
});

test("every intent owner is public and represented in sitemap data", () => {
  for (const owner of SEO_INTENT_OWNERS) {
    assert.ok(sitemapPaths.has(owner.ownerPath), `${owner.ownerPath} must be present in public sitemap data`);

    for (const prefix of SEO_PRIVATE_ROUTE_PREFIXES) {
      assert.ok(
        owner.ownerPath !== prefix && !owner.ownerPath.startsWith(`${prefix}/`),
        `${owner.primaryIntent} must not be owned by private route ${owner.ownerPath}`,
      );
    }
  }
});

test("homepage exclusively owns core payroll software intent", () => {
  const key = normalizeSeoIntent("payroll software philippines");
  const owners = SEO_INTENT_OWNERS.filter((entry) =>
    [entry.primaryIntent, ...(entry.supportingIntents ?? [])]
      .map(normalizeSeoIntent)
      .includes(key),
  );
  assert.deepEqual(owners.map((entry) => entry.ownerPath), ["/"]);
});

test("buyer guide does not steal homepage commercial intent", () => {
  const buyer = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/resources/best-payroll-software-philippines");
  assert.equal(buyer?.primaryIntent, "best payroll software philippines");
  assert.notEqual(normalizeSeoIntent(buyer?.primaryIntent ?? ""), normalizeSeoIntent("payroll software philippines"));
});

test("13th-month guide and calculator own distinct intents", () => {
  const guide = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/resources/13th-month-pay-philippines");
  const calculator = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/calculators/13th-month-pay");
  assert.equal(guide?.intentClass, "guide");
  assert.equal(calculator?.intentClass, "calculator");
  assert.notEqual(normalizeSeoIntent(guide?.primaryIntent ?? ""), normalizeSeoIntent(calculator?.primaryIntent ?? ""));
});

test("withholding compliance, calculator and glossary remain separate intent classes", () => {
  const compliance = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/compliance/withholding-tax");
  const calculator = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/calculators/withholding-tax");
  assert.equal(compliance?.intentClass, "compliance");
  assert.equal(calculator?.intentClass, "calculator");

  const glossaryData = read("src/lib/seo-content-wave3.ts");
  assert.ok(glossaryData.includes('slug: "withholding-tax"'));
});

test("authority page slugs are unique inside each route family", () => {
  const families = [
    ["compliance", [...compliancePages, ...complianceWave3]],
    ["resources", [...resourcePages, ...resourceWave2, ...resourceWave3, ...resourceWave14, ...resourceWave16, ...resourceWave17, ...resourceWave18]],
    ["industries", [...industryPages, ...industryWave2, ...industryWave6]],
    ["integrations", integrationWave6],
  ] as const;

  for (const [name, pages] of families) {
    const seen = new Set<string>();
    for (const page of pages) {
      assert.equal(seen.has(page.slug), false, `duplicate ${name} slug: ${page.slug}`);
      seen.add(page.slug);
    }
  }
});

test("authority metadata titles do not collide across dynamic SEO pages", () => {
  const pages = [
    ...compliancePages.map((page) => ({ prefix: "/compliance", page })),
    ...complianceWave3.map((page) => ({ prefix: "/compliance", page })),
    ...resourcePages.map((page) => ({ prefix: "/resources", page })),
    ...resourceWave2.map((page) => ({ prefix: "/resources", page })),
    ...resourceWave3.map((page) => ({ prefix: "/resources", page })),
    ...resourceWave14.map((page) => ({ prefix: "/resources", page })),
    ...resourceWave16.map((page) => ({ prefix: "/resources", page })),
    ...resourceWave17.map((page) => ({ prefix: "/resources", page })),
    ...resourceWave18.map((page) => ({ prefix: "/resources", page })),
    ...industryPages.map((page) => ({ prefix: "/industries", page })),
    ...industryWave2.map((page) => ({ prefix: "/industries", page })),
    ...industryWave6.map((page) => ({ prefix: "/industries", page })),
    ...integrationWave6.map((page) => ({ prefix: "/integrations", page })),
  ];

  const owners = new Map<string, string[]>();
  for (const { prefix, page } of pages) {
    const title = (page.metaTitle ?? `${page.title} | Linaw`).trim().toLowerCase();
    const paths = owners.get(title) ?? [];
    paths.push(`${prefix}/${page.slug}`);
    owners.set(title, paths);
  }

  const collisions = [...owners.entries()].filter(([, paths]) => paths.length > 1);
  assert.deepEqual(collisions, []);
});

test("authority related links stay internal, public and discoverable", () => {
  const pages = [
    ...compliancePages,
    ...complianceWave3,
    ...resourcePages,
    ...resourceWave2,
    ...resourceWave3,
    ...resourceWave14,
    ...resourceWave16,
    ...resourceWave17,
    ...resourceWave18,
    ...industryPages,
    ...industryWave2,
    ...industryWave6,
    ...integrationWave6,
  ];

  for (const page of pages) {
    for (const related of page.related) {
      assert.ok(related.href.startsWith("/"), `${page.slug} related link must be internal: ${related.href}`);
      assert.ok(sitemapPaths.has(related.href), `${page.slug} related link must be discoverable: ${related.href}`);

      for (const prefix of SEO_PRIVATE_ROUTE_PREFIXES) {
        assert.ok(
          related.href !== prefix && !related.href.startsWith(`${prefix}/`),
          `${page.slug} must not link authority content to private route ${related.href}`,
        );
      }
    }
  }
});

test("CI executes the SEO launch audit before build", () => {
  const ci = read(".github/workflows/ci.yml");
  const pkg = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  assert.equal(pkg.scripts?.["seo:audit"], "tsx scripts/seo-launch-audit.ts");
  assert.ok(ci.includes("- run: npm run seo:audit"));
  assert.ok(ci.indexOf("npm run seo:audit") < ci.indexOf("npx next build"));
});
