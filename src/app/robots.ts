import type { MetadataRoute } from "next";
import { PUBLIC_SITE_URL, absolutePublicUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/app",
        "/workspace",
      ],
    },
    sitemap: absolutePublicUrl("/sitemap.xml"),
    host: PUBLIC_SITE_URL,
  };
}
