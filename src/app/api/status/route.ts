import { desc } from "drizzle-orm";
import { db } from "@/db";
import { healthSnapshots } from "@/db/schema";
import { currentStatusLabel, summarizeUptime } from "@/lib/status";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.select().from(healthSnapshots).orderBy(desc(healthSnapshots.createdAt)).limit(200);
  // Shared maths with the /status page so the page and this JSON never disagree.
  const uptime = summarizeUptime(rows);
  const latest = rows[0] ?? null;

  return Response.json({
    current: latest
      ? { ok: latest.ok, latencyMs: latest.latencyMs, at: latest.createdAt, label: currentStatusLabel(latest).label }
      : { ok: null, note: "No snapshots yet. Hit /api/health." },
    samples24h: uptime.samples,
    uptimePercent24h: uptime.uptimePercent,
    medianLatencyMs: uptime.medianLatencyMs,
    history: rows.slice(0, 48).map((row) => ({
      ok: row.ok,
      latencyMs: row.latencyMs,
      at: row.createdAt,
    })),
    note: "Snapshots are recorded whenever /api/health is called. This is not a third-party status-page service.",
  });
}
