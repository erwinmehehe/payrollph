"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { manilaInboxToday, scheduleChangeInbox, type InboxState } from "@/lib/workforce-schedule-change-inbox";

/** Only GETs the session-bound receipt endpoint. Never stores a delivered/read event. */
export function EmployeeScheduleChangeInbox({ identityScope }: { identityScope: string }) {
  const [version, setVersion] = useState(0);
  const [source, setSource] = useState<{ scope: string; result: InboxState } | null>(null);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setSource(null); setFailure(null); setLoading(true);
    try {
      const response = await fetch("/api/self/schedule-receipts", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Schedule review is not available. Refresh or contact your People administrator.");
      const json: unknown = await response.json();
      const today = manilaInboxToday();
      const result = scheduleChangeInbox(json, today);
      if (controller.signal.aborted || abort.current !== controller) return;
      if (today !== manilaInboxToday()) throw new Error("The Philippine work date changed. Refresh your schedule.");
      setSource({ scope: identityScope, result });
    } catch {
      if (!controller.signal.aborted && abort.current === controller) {
        setFailure({ scope: identityScope, message: "Current schedule alerts could not be verified. Refresh to try again." });
      }
    } finally {
      if (!controller.signal.aborted && abort.current === controller) setLoading(false);
    }
  }, [identityScope]);
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_WFM_SCHEDULE_CHANGE_INBOX_ENABLED !== "true" || !identityScope) return;
    void load();
    return () => abort.current?.abort();
  }, [load, version, identityScope]);
  if (process.env.NEXT_PUBLIC_WFM_SCHEDULE_CHANGE_INBOX_ENABLED !== "true" || !identityScope) return null;
  const active = source?.scope === identityScope && source.result.today === manilaInboxToday() ? source.result : null;
  const error = failure?.scope === identityScope ? failure.message : "";
  return <section className="card" style={{ marginTop: 16 }} aria-label="Schedule change inbox" data-wfm-schedule-change-inbox>
    <div className="card-header"><div><div className="card-kicker">My schedule</div><h2>Schedule updates</h2>
      <p>Current seven Philippine work dates. In-app review only; no email or SMS is sent.</p></div>
      <button type="button" className="secondary-button" disabled={loading}
        onClick={() => setVersion(n => n + 1)}>Refresh</button></div>
    <p className="id" style={{ padding: "0 18px 12px" }}>An unacknowledged schedule is not proof of absence, lateness, message delivery, or agreement to a pay change.</p>
    {loading && <p role="status" style={{ padding: 18 }}>Checking your current schedule…</p>}
    {error && <div className="notice notice-amber" role="alert" style={{ margin: "0 18px 16px" }}>{error}</div>}
    {!loading && !error && !active && <p role="status" style={{ padding: 18 }}>No verified current schedule view. Refresh before acting.</p>}
    {active && <><div className="stats-grid" style={{ padding: "0 18px 16px" }}>
      <div className="metric"><div className="metric-label">Needs review</div><strong>{active.notices.length}</strong></div>
      <div className="metric"><div className="metric-label">Changed since acknowledged</div><strong>{active.notices.filter(n => n.kind === "changed").length}</strong></div>
      <div className="metric"><div className="metric-label">Acknowledged current version</div><strong>{active.acknowledged}</strong></div>
      <div className="metric"><div className="metric-label">Source unavailable</div><strong>{active.unavailable}</strong></div>
    </div>
      {active.notices.length === 0 && <p className="notice notice-slate" style={{ margin: "0 18px 18px" }}>No reviewable outstanding schedules in this window.</p>}
      <ul style={{ padding: "0 18px 18px", margin: 0, listStyle: "none", display: "grid", gap: 10 }}>
        {active.notices.map(n => <li key={n.date} className="notice notice-slate">
          <strong>{n.title} · {n.date}</strong>
          <p>Review the latest shift, rest day and worksite details before recording a receipt.</p>
          <Link href="/self/schedule-receipts" className="secondary-button">Review current schedule</Link>
        </li>)}
      </ul></>}
  </section>;
}
