import type { MetadataRoute } from "next";
import { absolutePublicUrl } from "@/lib/site-url";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    { path: "/", priority: 1, changeFrequency: "weekly" as const },
    { path: "/hris", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/time-and-attendance", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/employee-self-service", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/compliance", priority: 0.9, changeFrequency: "weekly" as const },
    { path: "/implementation", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/security", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/industries/bpo", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/payroll-outsourcing", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/scorecard", priority: 0.7, changeFrequency: "weekly" as const },
    { path: "/demo", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/book-demo", priority: 0.6, changeFrequency: "monthly" as const },
  ];

  return routes.map((route) => ({
    url: absolutePublicUrl(route.path),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
