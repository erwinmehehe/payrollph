import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { outbox } from "@/db/schema";

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

function marketingMetadata(value: unknown): MarketingMetadata | null {
  if (!value || typeof value !== "object") return null;
  const root = value as Record<string, unknown>;
  const raw = root.marketing;
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;

  return {
    requestType: input.requestType === "trial" ? "trial" : "demo",
    headcount: clean(input.headcount, 40) || "not stated",
    landingPath: clean(input.landingPath, 300) || "(unknown)",
    conversionPath: clean(input.conversionPath, 300) || "(unknown)",
    referrer: clean(input.referrer, 500),
    utmSource: clean(input.utmSource, 120),
    utmMedium: clean(input.utmMedium, 120),
    utmCampaign: clean(input.utmCampaign, 160),
    utmContent: clean(input.utmContent, 160),
    utmTerm: clean(input.utmTerm, 160),
  };
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
      metadata: outbox.metadata,
      createdAt: outbox.createdAt,
    })
    .from(outbox)
    .where(and(eq(outbox.purpose, "demo-request"), gte(outbox.createdAt, since)))
    .orderBy(desc(outbox.createdAt))
    .limit(5000);

  const requestType = new Map<string, number>();
  const landingPath = new Map<string, number>();
  const sourceMedium = new Map<string, number>();
  const campaign = new Map<string, number>();
  const headcount = new Map<string, number>();
  const daily = new Map<string, number>();

  let attributed = 0;

  for (const row of rows) {
    const marketing = marketingMetadata(row.metadata);
    if (!marketing) continue;

    attributed += 1;
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
