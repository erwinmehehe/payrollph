import { and, desc, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { marketingLeads } from "@/db/schema";

type MarketingMetadata = {
  requestType: "demo" | "trial";
  headcount: string;
  landingPath: string;
  conversionPath: string;
  referrer: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  utmTerm: string;
};

function clean(value: unknown, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function ranked(map: Map<string, number>, limit = 20) {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

export async function marketingLeadReport(days = 90) {
  const boundedDays = Math.max(1, Math.min(Math.trunc(days), 365));
  const since = new Date(Date.now() - boundedDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      kind: marketingLeads.kind,
      headcount: marketingLeads.headcount,
      attribution: marketingLeads.attribution,
      createdAt: marketingLeads.createdAt,
    })
    .from(marketingLeads)
    .where(and(
      inArray(marketingLeads.kind, ["demo", "trial-access"]),
      gte(marketingLeads.createdAt, since),
    ))
    .orderBy(desc(marketingLeads.createdAt))
    .limit(5000);

  const requestType = new Map<string, number>();
  const landingPath = new Map<string, number>();
  const sourceMedium = new Map<string, number>();
  const campaign = new Map<string, number>();
  const headcount = new Map<string, number>();
  const daily = new Map<string, number>();

  let attributed = 0;

  for (const row of rows) {
    const raw = row.attribution && typeof row.attribution === "object"
      ? row.attribution as Record<string, unknown>
      : {};
    const marketing: MarketingMetadata = {
      requestType: row.kind === "trial-access" ? "trial" : "demo",
      headcount: clean(row.headcount, 40) || "not stated",
      landingPath: clean(raw.landingPath, 300) || "(unknown)",
      conversionPath: clean(raw.conversionPath, 300) || "(unknown)",
      referrer: clean(raw.referrer, 500),
      utmSource: clean(raw.utmSource, 120),
      utmMedium: clean(raw.utmMedium, 120),
      utmCampaign: clean(raw.utmCampaign, 160),
      utmContent: clean(raw.utmContent, 160),
      utmTerm: clean(raw.utmTerm, 160),
    };

    if (Object.keys(raw).length > 0) attributed += 1;
    increment(requestType, marketing.requestType);
    increment(landingPath, marketing.landingPath);
    increment(
      sourceMedium,
      marketing.utmSource || marketing.utmMedium
        ? `${marketing.utmSource || "(none)"} / ${marketing.utmMedium || "(none)"}`
        : marketing.referrer
          ? "referral / untagged"
          : "direct / untagged",
    );
    increment(campaign, marketing.utmCampaign || "(not tagged)");
    increment(headcount, marketing.headcount);
    increment(daily, row.createdAt.toISOString().slice(0, 10));
  }

  return {
    periodDays: boundedDays,
    since: since.toISOString(),
    totalRequests: rows.length,
    attributedRequests: attributed,
    unattributedRequests: rows.length - attributed,
    byRequestType: ranked(requestType, 10),
    byLandingPath: ranked(landingPath, 25),
    bySourceMedium: ranked(sourceMedium, 25),
    byCampaign: ranked(campaign, 25),
    byHeadcount: ranked(headcount, 25),
    byDay: ranked(daily, 366).sort((a, b) => a.key.localeCompare(b.key)),
  };
}
