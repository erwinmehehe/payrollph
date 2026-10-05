import { calculatorSitemapEntries, renderSitemap, sitemapResponse } from "@/lib/sitemap-data";

export const dynamic = "force-static";

export function GET() {
  return sitemapResponse(renderSitemap(calculatorSitemapEntries));
}
