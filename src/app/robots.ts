import type { MetadataRoute } from "next";

const SITE_URL = (process.env.APP_BASE_URL ?? "https://erwinmehehe-payrollph.vercel.app").replace(/\/+$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/app",
          "/workspace",
          "/setup",
          "/invite",
          "/reset-password",
          "/verify-email",
          "/login",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
