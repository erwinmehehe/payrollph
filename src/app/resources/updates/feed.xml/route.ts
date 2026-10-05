import { absolutePublicUrl } from "@/lib/site-url";
import { regulatoryUpdates } from "@/lib/seo-content-wave3";

export const dynamic = "force-static";

function xml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function GET() {
  const items = [...regulatoryUpdates]
    .sort((a, b) => b.publishedDate.localeCompare(a.publishedDate))
    .map((update) => {
      const url = absolutePublicUrl(`/resources/updates/${update.slug}`);
      const pubDate = new Date(`${update.publishedDate}T00:00:00+08:00`).toUTCString();
      return `<item>
<title>${xml(update.title)}</title>
<link>${xml(url)}</link>
<guid isPermaLink="true">${xml(url)}</guid>
<pubDate>${xml(pubDate)}</pubDate>
<category>${xml(update.agency)}</category>
<description>${xml(update.summary)}</description>
</item>`;
    })
    .join("\n");

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>Linaw Philippine Payroll Regulatory Updates</title>
<link>${xml(absolutePublicUrl("/resources/updates"))}</link>
<description>Dated Philippine payroll regulatory updates with official-source references.</description>
<language>en-PH</language>
${items}
</channel>
</rss>`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
