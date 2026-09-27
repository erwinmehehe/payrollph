/**
 * Uptime math shared by the public status page and /api/status, so the two can
 * never report different numbers for the same data.
 *
 * Kept free of React and of impure calls inside components: `now` is injected,
 * which makes the windowing deterministic under test.
 */

export type Snapshot = {
  ok: boolean;
  latencyMs: number;
  createdAt: Date | string;
};

export type UptimeSummary = {
  samples: number;
  ok: number;
  failed: number;
  /** Percentage to one decimal, or null when there are no samples to judge. */
  uptimePercent: number | null;
  uptimeLabel: string;
  slowestMs: number;
  medianLatencyMs: number | null;
};

const DAY_MS = 86_400_000;

export function summarizeUptime(snapshots: Snapshot[], now: number = Date.now(), windowMs = DAY_MS): UptimeSummary {
  const inWindow = snapshots.filter((row) => now - new Date(row.createdAt).getTime() < windowMs);
  const ok = inWindow.filter((row) => row.ok).length;
  const samples = inWindow.length;

  const uptimePercent = samples === 0 ? null : Math.round((ok / samples) * 1000) / 10;
  const latencies = inWindow.map((row) => row.latencyMs).sort((a, b) => a - b);
  const medianLatencyMs = latencies.length
    ? latencies.length % 2 === 1
      ? latencies[(latencies.length - 1) / 2]
      : Math.round(((latencies[latencies.length / 2 - 1] + latencies[latencies.length / 2]) / 2) * 10) / 10
    : null;

  return {
    samples,
    ok,
    failed: samples - ok,
    uptimePercent,
    uptimeLabel: uptimePercent === null ? "No samples yet" : `${uptimePercent}%`,
    slowestMs: latencies.length ? latencies[latencies.length - 1] : 0,
    medianLatencyMs,
  };
}

/** Current status wording is derived from the newest snapshot only. */
export function currentStatusLabel(latest: Snapshot | undefined | null): { label: string; tone: "operational" | "degraded" | "unknown" } {
  if (!latest) return { label: "Unknown", tone: "unknown" };
  return latest.ok
    ? { label: "Operational", tone: "operational" }
    : { label: "Degraded", tone: "degraded" };
}
