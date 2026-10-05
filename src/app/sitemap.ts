import type { MetadataRoute } from "next";
import { absolutePublicUrl } from "@/lib/site-url";
import { CALCULATORS } from "@/lib/calculators";
import { compliancePages, industryPages, resourcePages } from "@/lib/seo-content";
import { industryWave2, resourceWave2 } from "@/lib/seo-content-wave2";
import { complianceWave3, glossaryEntries, regulatoryUpdates, resourceWave3 } from "@/lib/seo-content-wave3";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = [
    { path: "/", priority: 1, changeFrequency: "weekly" as const },
    { path: "/hris", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/time-and-attendance", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/employee-self-service", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/compliance", priority: 0.9, changeFrequency: "weekly" as const },
    { path: "/implementation", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/security", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/trust", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/methodology", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/integrations", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/developers", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/compare", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/templates/payroll-rfp-checklist", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/templates/payroll-security-checklist", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/pricing", priority: 0.9, changeFrequency: "weekly" as const },
    { path: "/resources", priority: 0.9, changeFrequency: "weekly" as const },
    { path: "/resources/updates", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/glossary", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/industries", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/industries/bpo", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/calculators", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/payroll-health-check", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/payroll-outsourcing", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/scorecard", priority: 0.7, changeFrequency: "weekly" as const },
    { path: "/demo", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/book-demo", priority: 0.6, changeFrequency: "monthly" as const },
  ];

  const dynamicRoutes = [
    ...compliancePages.map(({ slug }) => ({ path: `/compliance/${slug}`, priority: 0.8, changeFrequency: "monthly" as const })),
    ...complianceWave3.map(({ slug }) => ({ path: `/compliance/${slug}`, priority: 0.8, changeFrequency: "monthly" as const })),
    ...[...resourcePages, ...resourceWave2, ...resourceWave3].map(({ slug }) => ({ path: `/resources/${slug}`, priority: 0.8, changeFrequency: "monthly" as const })),
    ...[...industryPages, ...industryWave2].map(({ slug }) => ({ path: `/industries/${slug}`, priority: 0.8, changeFrequency: "monthly" as const })),
    ...Object.keys(CALCULATORS).map((slug) => ({ path: `/calculators/${slug}`, priority: 0.8, changeFrequency: "monthly" as const })),
    ...glossaryEntries.map(({ slug }) => ({ path: `/glossary/${slug}`, priority: 0.6, changeFrequency: "monthly" as const })),
    ...regulatoryUpdates.map(({ slug }) => ({ path: `/resources/updates/${slug}`, priority: 0.7, changeFrequency: "yearly" as const })),
    ...["authentication", "employees", "payroll-runs", "webhooks"].map((slug) => ({ path: `/developers/${slug}`, priority: 0.7, changeFrequency: "monthly" as const })),
  ];

  return [...staticRoutes, ...dynamicRoutes].map((route) => ({
    url: absolutePublicUrl(route.path),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
