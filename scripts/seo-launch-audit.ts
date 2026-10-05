import { existsSync, readFileSync } from "node:fs";
import {
  compliancePages,
  industryPages,
  resourcePages,
  type AuthorityPage,
} from "../src/lib/seo-content";
import { industryWave2, resourceWave2 } from "../src/lib/seo-content-wave2";
import {
  complianceWave3,
  glossaryEntries,
  resourceWave3,
} from "../src/lib/seo-content-wave3";
import { industryWave6, integrationWave6 } from "../src/lib/seo-content-wave6";
import { resourceWave14 } from "../src/lib/seo-content-wave14";
import { resourceWave16 } from "../src/lib/seo-content-wave16";
import { resourceWave17 } from "../src/lib/seo-content-wave17";
import { STATIC_SEO_ROUTES } from "../src/lib/static-seo-routes";
import { DYNAMIC_SEO_ROUTE_CONTRACTS } from "../src/lib/dynamic-seo-routes";
import {
  SEO_INTENT_OWNERS,
  SEO_PRIVATE_ROUTE_PREFIXES,
  duplicateSeoIntentOwners,
  duplicateSeoOwnerPaths,
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

type AuditIssue = {
  code: string;
  message: string;
};

const issues: AuditIssue[] = [];

const sitemapEntries = [
  ...pagesSitemapEntries,
  ...productSitemapEntries,
  ...complianceSitemapEntries,
  ...industrySitemapEntries,
  ...resourceSitemapEntries,
  ...calculatorSitemapEntries,
  ...glossarySitemapEntries,
  ...developerSitemapEntries,
  ...approvedCustomerSitemapEntries(),
];

const sitemapPaths = new Set(sitemapEntries.map((entry) => entry.path));

for (const duplicate of duplicateSeoIntentOwners()) {
  issues.push({
    code: "duplicate-intent",
    message: `Intent "${duplicate.intent}" has multiple owners: ${duplicate.ownerPaths.join(", ")}`,
  });
}

for (const duplicate of duplicateSeoOwnerPaths()) {
  issues.push({
    code: "duplicate-owner-path",
    message: `Owner path "${duplicate.path}" appears ${duplicate.count} times in the intent registry.`,
  });
}

for (const owner of SEO_INTENT_OWNERS) {
  if (!sitemapPaths.has(owner.ownerPath)) {
    issues.push({
      code: "owner-not-in-sitemap",
      message: `SEO intent owner ${owner.ownerPath} for "${owner.primaryIntent}" is missing from segmented sitemap data.`,
    });
  }

  const privatePrefix = SEO_PRIVATE_ROUTE_PREFIXES.find(
    (prefix) => owner.ownerPath === prefix || owner.ownerPath.startsWith(`${prefix}/`),
  );
  if (privatePrefix) {
    issues.push({
      code: "private-owner",
      message: `SEO intent "${owner.primaryIntent}" points to private route ${owner.ownerPath}.`,
    });
  }
}

const sitemapCounts = new Map<string, number>();
for (const entry of sitemapEntries) {
  sitemapCounts.set(entry.path, (sitemapCounts.get(entry.path) ?? 0) + 1);
}
for (const [path, count] of sitemapCounts) {
  if (count > 1) {
    issues.push({
      code: "duplicate-sitemap-path",
      message: `Public path ${path} appears in ${count} sitemap segments.`,
    });
  }
}

const authorityFamilies: Array<{ prefix: string; pages: AuthorityPage[] }> = [
  { prefix: "/compliance", pages: [...compliancePages, ...complianceWave3] },
  { prefix: "/resources", pages: [...resourcePages, ...resourceWave2, ...resourceWave3, ...resourceWave14, ...resourceWave16, ...resourceWave17] },
  { prefix: "/industries", pages: [...industryPages, ...industryWave2, ...industryWave6] },
  { prefix: "/integrations", pages: integrationWave6 },
];

const titleOwners = new Map<string, string[]>();

for (const family of authorityFamilies) {
  for (const page of family.pages) {
    const path = `${family.prefix}/${page.slug}`;
    const title = (page.metaTitle ?? `${page.title} | Linaw`).trim().toLowerCase();
    const owners = titleOwners.get(title) ?? [];
    owners.push(path);
    titleOwners.set(title, owners);

    for (const related of page.related) {
      if (!related.href.startsWith("/")) {
        issues.push({
          code: "non-internal-related-link",
          message: `${path} has non-internal related link ${related.href}.`,
        });
        continue;
      }

      const privatePrefix = SEO_PRIVATE_ROUTE_PREFIXES.find(
        (prefix) => related.href === prefix || related.href.startsWith(`${prefix}/`),
      );
      if (privatePrefix) {
        issues.push({
          code: "private-related-link",
          message: `${path} links authority content to private route ${related.href}.`,
        });
      }

      if (!sitemapPaths.has(related.href)) {
        issues.push({
          code: "orphan-related-link",
          message: `${path} links to ${related.href}, which is not present in public sitemap data.`,
        });
      }
    }
  }
}

for (const [title, owners] of titleOwners) {
  if (owners.length > 1) {
    issues.push({
      code: "duplicate-authority-title",
      message: `Authority title "${title}" is shared by: ${owners.join(", ")}`,
    });
  }
}


for (const route of STATIC_SEO_ROUTES) {
  if (!existsSync(route.pageFile)) {
    issues.push({
      code: "missing-static-page-file",
      message: "Static SEO route " + route.path + " is mapped to missing file " + route.pageFile + ".",
    });
    continue;
  }

  const source = readFileSync(route.pageFile, "utf8");

  if (!/\btitle\s*:/.test(source)) {
    issues.push({
      code: "missing-static-title",
      message: "Static SEO route " + route.path + " is missing page-level title metadata.",
    });
  }

  if (!/\bdescription\s*:/.test(source)) {
    issues.push({
      code: "missing-static-description",
      message: "Static SEO route " + route.path + " is missing page-level description metadata.",
    });
  }

  const doubleQuotedCanonical = 'alternates: { canonical: "' + route.path + '" }';
  const singleQuotedCanonical = "alternates: { canonical: '" + route.path + "' }";
  if (!source.includes(doubleQuotedCanonical) && !source.includes(singleQuotedCanonical)) {
    issues.push({
      code: "missing-or-mismatched-canonical",
      message: "Static SEO route " + route.path + " must declare a self-canonical matching its route.",
    });
  }

  if (/robots\s*:\s*\{[\s\S]{0,120}?index\s*:\s*false/.test(source)) {
    issues.push({
      code: "indexable-route-noindex",
      message: "Static SEO route " + route.path + " is in public sitemap data but declares noindex.",
    });
  }
}

for (const route of DYNAMIC_SEO_ROUTE_CONTRACTS) {
  if (!existsSync(route.pageFile)) {
    issues.push({
      code: "missing-dynamic-page-file",
      message: "Dynamic SEO route " + route.routePattern + " is mapped to missing file " + route.pageFile + ".",
    });
    continue;
  }

  const source = readFileSync(route.pageFile, "utf8");

  for (const required of [
    "generateStaticParams",
    "generateMetadata",
    "notFound()",
    "StructuredData",
    route.canonicalSignal,
    route.schemaSignal,
    ...(route.additionalSignals ?? []),
  ]) {
    if (!source.includes(required)) {
      issues.push({
        code: "missing-dynamic-contract",
        message: "Dynamic SEO route " + route.routePattern + " is missing required signal: " + required,
      });
    }
  }

  if (!/\btitle\s*:/.test(source)) {
    issues.push({
      code: "missing-dynamic-title",
      message: "Dynamic SEO route " + route.routePattern + " is missing generated title metadata.",
    });
  }

  if (!/\bdescription\s*:/.test(source)) {
    issues.push({
      code: "missing-dynamic-description",
      message: "Dynamic SEO route " + route.routePattern + " is missing generated description metadata.",
    });
  }

  if (!route.allowConditionalNoindex && /robots\s*:\s*\{[\s\S]{0,120}?index\s*:\s*false/.test(source)) {
    issues.push({
      code: "dynamic-route-noindex",
      message: "Dynamic SEO route " + route.routePattern + " declares noindex despite being an indexable SEO family.",
    });
  }
}

const glossarySlugs = new Set<string>();
for (const entry of glossaryEntries) {
  if (glossarySlugs.has(entry.slug)) {
    issues.push({
      code: "duplicate-glossary-slug",
      message: `Glossary slug "${entry.slug}" is duplicated.`,
    });
  }
  glossarySlugs.add(entry.slug);
}

if (issues.length > 0) {
  console.error(`SEO launch audit failed with ${issues.length} issue(s):`);
  for (const issue of issues) {
    console.error(`- [${issue.code}] ${issue.message}`);
  }
  process.exitCode = 1;
} else {
  console.log("SEO launch audit passed.");
  console.log(`Intent owners: ${SEO_INTENT_OWNERS.length}`);
  console.log(`Public sitemap URLs: ${sitemapEntries.length}`);
  console.log(`Authority pages checked: ${authorityFamilies.reduce((sum, family) => sum + family.pages.length, 0)}`);
  console.log(`Glossary entries checked: ${glossaryEntries.length}`);
  console.log(`Dynamic SEO route contracts checked: ${DYNAMIC_SEO_ROUTE_CONTRACTS.length}`);
}
