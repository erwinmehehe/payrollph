import { desc } from "drizzle-orm";
import { db } from "@/db";
import { healthSnapshots } from "@/db/schema";
import { currentStatusLabel, summarizeUptime } from "@/lib/status";

export const dynamic = "force-dynamic";

export default async function StatusPage() {
  let rows: Array<{ ok: boolean; latencyMs: number; createdAt: Date }> = [];
  try {
    rows = await db.select().from(healthSnapshots).orderBy(desc(healthSnapshots.createdAt)).limit(48);
  } catch {
    rows = [];
  }
  // All windowing/percentage math lives in src/lib/status.ts so this render
  // stays pure and the /api/status route reports identical numbers.
  const uptime = summarizeUptime(rows);
  const latest = rows[0];
  const status = currentStatusLabel(latest);

  return (
    <main className="content-area" style={{ maxWidth: 820 }}>
      <p className="eyebrow">PUBLIC STATUS</p>
      <h1 style={{ letterSpacing: "-.04em" }}>Linaw uptime</h1>
      <p className="heading-copy">Recorded from live `/api/health` checks against this instance. Not a third-party status-page vendor.</p>

      <section className="stats-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginTop: 24 }}>
        <article className="stat-card">
          <p>CURRENT</p>
          <h3>{status.label}</h3>
          <span>{latest ? `${latest.latencyMs} ms · ${new Date(latest.createdAt).toLocaleString("en-PH")}` : "Call /api/health to start history"}</span>
        </article>
        <article className="stat-card">
          <p>24H UPTIME</p>
          <h3>{uptime.uptimeLabel}</h3>
          <span>{uptime.samples} samples in window · median {uptime.medianLatencyMs ?? "—"} ms</span>
        </article>
        <article className="stat-card">
          <p>SCHEDULER</p>
          <h3>Opportunistic</h3>
          <span>Webhook drain ticks from health checks, not a dedicated cron</span>
        </article>
      </section>

      <article className="card" style={{ marginTop: 20 }}>
        <div className="card-header"><div><div className="card-kicker">RECENT CHECKS</div><h2>Newest first</h2></div></div>
        <div className="audit-list">
          {rows.length === 0 && <div className="empty-state">No snapshots yet.</div>}
          {rows.map((row, index) => (
            <div className="audit-row" key={`${row.createdAt}-${index}`}>
              <span className="audit-dot">{row.ok ? "●" : "!"}</span>
              <div>
                <strong>{row.ok ? "Healthy" : "Failed"}</strong>
                <p>{row.latencyMs} ms database round-trip</p>
              </div>
              <time>{new Date(row.createdAt).toLocaleString("en-PH")}</time>
            </div>
          ))}
        </div>
      </article>
    </main>
  );
}
