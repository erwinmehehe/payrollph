import type { MetadataRoute } from "next";
import { absolutePublicUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/app/",
        "/workspace/",
        "/setup/",
        "/invite/",
        "/reset-password/",
        "/verify-email/",
      ],
    },
    sitemap: absolutePublicUrl("/sitemap.xml"),
    host: absolutePublicUrl("/"),
  };
}
