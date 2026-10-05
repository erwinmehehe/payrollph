import type { MetadataRoute } from "next";

const SITE_URL = (process.env.APP_BASE_URL ?? "https://erwinmehehe-payrollph.vercel.app").replace(/\/+$/, "");

const publicRoutes = [
  { path: "", changeFrequency: "weekly", priority: 1 },
  { path: "/payroll-outsourcing", changeFrequency: "monthly", priority: 0.9 },
  { path: "/demo", changeFrequency: "monthly", priority: 0.8 },
  { path: "/scorecard", changeFrequency: "weekly", priority: 0.7 },
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return publicRoutes.map((route) => ({
    url: `${SITE_URL}${route.path}`,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
