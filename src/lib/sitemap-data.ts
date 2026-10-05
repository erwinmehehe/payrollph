import { CALCULATORS } from "@/lib/calculators";
import { compliancePages, industryPages, resourcePages } from "@/lib/seo-content";
import { industryWave2, resourceWave2 } from "@/lib/seo-content-wave2";
import { complianceWave3, glossaryEntries, regulatoryUpdates, resourceWave3 } from "@/lib/seo-content-wave3";
import { industryWave6, integrationWave6 } from "@/lib/seo-content-wave6";
import { resourceWave14 } from "@/lib/seo-content-wave14";
import { resourceWave16 } from "@/lib/seo-content-wave16";
import { resourceWave17 } from "@/lib/seo-content-wave17";
import { resourceWave18 } from "@/lib/seo-content-wave18";
import { PUBLISHABLE_CUSTOMER_STORIES } from "@/lib/customer-stories";
import { absolutePublicUrl } from "@/lib/site-url";

export type SitemapEntry = {
  path: string;
  changeFrequency: "daily" | "weekly" | "monthly" | "yearly";
};

export const pagesSitemapEntries: SitemapEntry[] = [
  { path: "/about", changeFrequency: "monthly" },
  { path: "/contact", changeFrequency: "monthly" },
  { path: "/trust", changeFrequency: "monthly" },
  { path: "/security", changeFrequency: "monthly" },
  { path: "/status", changeFrequency: "daily" },
  { path: "/methodology", changeFrequency: "monthly" },
  { path: "/scorecard", changeFrequency: "weekly" },
  { path: "/compare", changeFrequency: "monthly" },
  { path: "/templates/payroll-rfp-checklist", changeFrequency: "monthly" },
  { path: "/templates/payroll-security-checklist", changeFrequency: "monthly" },
  { path: "/demo", changeFrequency: "monthly" },
  { path: "/book-demo", changeFrequency: "monthly" },
  { path: "/trial", changeFrequency: "monthly" },
];

export const productSitemapEntries: SitemapEntry[] = [
  { path: "/", changeFrequency: "weekly" },
  { path: "/hris", changeFrequency: "monthly" },
  { path: "/time-and-attendance", changeFrequency: "monthly" },
  { path: "/employee-self-service", changeFrequency: "monthly" },
  { path: "/integrations", changeFrequency: "monthly" },
  ...integrationWave6.map(({ slug }) => ({ path: `/integrations/${slug}`, changeFrequency: "monthly" as const })),
  { path: "/implementation", changeFrequency: "monthly" },
  { path: "/pricing", changeFrequency: "weekly" },
  { path: "/small-business-payroll", changeFrequency: "monthly" },
  { path: "/payroll-outsourcing", changeFrequency: "monthly" },
  { path: "/payroll-health-check", changeFrequency: "monthly" },
  { path: "/workforce-analytics", changeFrequency: "monthly" },
];

export const complianceSitemapEntries: SitemapEntry[] = [
  { path: "/compliance", changeFrequency: "weekly" },
  ...[...compliancePages, ...complianceWave3].map(({ slug }) => ({
    path: `/compliance/${slug}`,
    changeFrequency: "monthly" as const,
  })),
];

export const industrySitemapEntries: SitemapEntry[] = [
  { path: "/industries", changeFrequency: "monthly" },
  { path: "/industries/bpo", changeFrequency: "monthly" },
  ...[...industryPages, ...industryWave2, ...industryWave6]
    .filter(({ slug }) => slug !== "bpo")
    .map(({ slug }) => ({ path: `/industries/${slug}`, changeFrequency: "monthly" as const })),
];

export const resourceSitemapEntries: SitemapEntry[] = [
  { path: "/resources", changeFrequency: "weekly" },
  { path: "/resources/updates", changeFrequency: "weekly" },
  ...[...resourcePages, ...resourceWave2, ...resourceWave3, ...resourceWave14, ...resourceWave16, ...resourceWave17, ...resourceWave18].map(({ slug }) => ({
    path: `/resources/${slug}`,
    changeFrequency: "monthly" as const,
  })),
  ...regulatoryUpdates.map(({ slug }) => ({
    path: `/resources/updates/${slug}`,
    changeFrequency: "yearly" as const,
  })),
];

export const calculatorSitemapEntries: SitemapEntry[] = [
  { path: "/calculators", changeFrequency: "monthly" },
  ...Object.keys(CALCULATORS).map((slug) => ({
    path: `/calculators/${slug}`,
    changeFrequency: "monthly" as const,
  })),
];

export const glossarySitemapEntries: SitemapEntry[] = [
  { path: "/glossary", changeFrequency: "monthly" },
  ...glossaryEntries.map(({ slug }) => ({
    path: `/glossary/${slug}`,
    changeFrequency: "monthly" as const,
  })),
];

export const developerSitemapEntries: SitemapEntry[] = [
  { path: "/developers", changeFrequency: "monthly" },
  ...["authentication", "employees", "payroll-runs", "webhooks"].map((slug) => ({
    path: `/developers/${slug}`,
    changeFrequency: "monthly" as const,
  })),
];

export function approvedCustomerSitemapEntries(): SitemapEntry[] {
  const approvedStories = PUBLISHABLE_CUSTOMER_STORIES;
  if (approvedStories.length === 0) return [];

  return [
    { path: "/customers", changeFrequency: "monthly" },
    ...approvedStories.map(({ slug }) => ({
      path: `/customers/${slug}`,
      changeFrequency: "monthly" as const,
    })),
  ];
}

export const publicSitemapPaths = [
  "/pages-sitemap.xml",
  "/products-sitemap.xml",
  "/compliance-sitemap.xml",
  "/industries-sitemap.xml",
  "/resources-sitemap.xml",
  "/calculators-sitemap.xml",
  "/glossary-sitemap.xml",
  "/developers-sitemap.xml",
] as const;

export function sitemapIndexPaths() {
  return approvedCustomerSitemapEntries().length > 0
    ? [...publicSitemapPaths, "/customer-stories-sitemap.xml"]
    : [...publicSitemapPaths];
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function renderSitemap(entries: SitemapEntry[]) {
  const urls = entries
    .map(
      ({ path, changeFrequency }) =>
        `<url><loc>${xmlEscape(absolutePublicUrl(path))}</loc><changefreq>${changeFrequency}</changefreq></url>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

export function renderSitemapIndex(paths = sitemapIndexPaths()) {
  const entries = paths
    .map((path) => `<sitemap><loc>${xmlEscape(absolutePublicUrl(path))}</loc></sitemap>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</sitemapindex>`;
}

export function sitemapResponse(body: string) {
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
