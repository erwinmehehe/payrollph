"use client";

import { useEffect, useState } from "react";

type Health = { ok: boolean; state: string; lastRanMinutesAgo: number | null };

/** Owner/admin only. The status endpoint independently checks membership and role. */
export function SchedulerAdminBanner({ organizationId }: { organizationId: number }) {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch("/api/jobs/admin-status?organizationId=" + organizationId, {
          cache: "no-store", credentials: "same-origin", signal: controller.signal,
        });
        if (!response.ok) throw new Error("Status unavailable");
        const data = await response.json() as Health;
        if (active) setHealth(data);
      } catch {
        if (active) setHealth({ ok: false, state: "monitor-unavailable", lastRanMinutesAgo: null });
      }
    }
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 60_000);
    return () => { active = false; clearInterval(interval); controller.abort(); };
  }, [organizationId]);
  if (!health) return null;
  const age = health.lastRanMinutesAgo;
  // "Off by design" during development is not an outage. Reserve live
  // accessibility alerts for a scheduler that is expected to work but isn't.
  const disabled = health.state === "scheduler-disabled";
  const alert = !health.ok && !disabled;
  const message = disabled
    ? "Scheduler is disabled (development mode)."
    : age === null
      ? "Scheduler has not reported a completed run."
      : "Scheduler last ran " + age + " minute" + (age === 1 ? "" : "s") + " ago.";
  return (
    <div role={alert ? "alert" : "status"} aria-label="Scheduler health"
      style={{ padding: "10px 14px", marginBottom: 12, border: "1px solid var(--line-strong)", borderRadius: 8, background: alert ? "var(--review-bg)" : health.ok ? "var(--success-bg)" : "var(--surface)", color: "var(--ink)" }}>
      <strong>Scheduler monitoring</strong>
      <span style={{ marginLeft: 8 }}>{message} {disabled ? "" : health.ok ? "Healthy." : "Attention required (" + health.state + ")."}</span>
    </div>
  );
}
