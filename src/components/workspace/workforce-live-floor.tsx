"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock3, RefreshCcw, UsersRound } from "lucide-react";
import type { FloorRow } from "@/lib/workforce-live-floor";
import { floorNeedsReview } from "@/lib/workforce-live-floor";
import { Metric, Status } from "./ui";

type FloorSnapshot = {
  generatedAt: string; timezone: string; workDate: string;
  page: number; totalEmployees: number; hasMore: boolean; unresolvedSchedules: number;
  rows: FloorRow[]; summary: {
    shiftSegments: number; requiresReview: number; recordedIn: number;
    recordedOut: number; scheduledLater: number; approvedLeave: number;
  };
};

const labels: Record<string, string> = {
  clocked_in: "Clock-in recorded", break_recorded: "Break recorded",
  clocked_out: "Clock-out recorded", upcoming: "Upcoming",
  check_in_window: "Check-in window", clock_in_unconfirmed: "Check-in unconfirmed",
  missing_punch_review: "Missing punch review", approved_leave: "Approved leave",
  leave_timing_review: "Leave timing review", leave_punch_review: "Leave/punch conflict",
  punch_evidence_review: "Punch review", employment_review: "Employment review",
};
function phTime(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(new Date(value));
}

export function WorkforceLiveFloor({ organizationId }: { organizationId: number }) {
  const [page, setPage] = useState(1);
  const [snapshot, setSnapshot] = useState<FloorSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ organizationId: String(organizationId), page: String(page) });
      const response = await fetch("/api/workforce/live-floor?" + params, { cache: "no-store", signal });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "Live floor could not be loaded.");
      if (signal?.aborted) return;
      setSnapshot(value as FloorSnapshot); setError("");
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : "Could not load live floor.");
      setSnapshot(null);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [organizationId, page]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void load(controller.signal);
    }, 60_000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [load]);

  useEffect(() => { setPage(1); }, [organizationId]);

  return (
    <section className="card" data-wfm-live-floor aria-label="Live workforce floor" style={{ margin: "0 18px 18px" }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">Live floor · advisory snapshot</div>
          <h3>Who is scheduled? Which clock-ins need review?</h3>
          <p>Philippine time · recorded punches only · refreshes every minute while visible. Not proof of onsite presence or an absence finding.</p>
        </div>
        <button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>
          <RefreshCcw size={15} aria-hidden="true" /> {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {error && <div role="alert" className="notice notice-amber">{error}</div>}
      {snapshot && <>
        <p className="id">As of {phTime(snapshot.generatedAt)} (Asia/Manila), {snapshot.workDate} · worker page {snapshot.page} · {snapshot.totalEmployees} visible employees</p>
        <div className="stats-grid">
          <Metric label="Shift segments" value={String(snapshot.summary.shiftSegments)} hint="this page" icon={<UsersRound size={16} />} tone="slate" />
          <Metric label="Recorded clock-ins" value={String(snapshot.summary.recordedIn)} hint="includes recorded breaks" icon={<Clock3 size={16} />} tone="blue" />
          <Metric label="Needs review" value={String(snapshot.summary.requiresReview)} hint="not automatically absent" icon={<Clock3 size={16} />} tone={snapshot.summary.requiresReview ? "amber" : "mint"} />
          <Metric label="Approved full leave" value={String(snapshot.summary.approvedLeave)} hint="schedule context" icon={<Clock3 size={16} />} tone="slate" />
        </div>
        {snapshot.unresolvedSchedules > 0 && <div role="status" className="notice notice-amber">{snapshot.unresolvedSchedules} worker schedule(s) could not be resolved; do not treat this page as complete.</div>}
        {snapshot.rows.length ? (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead><tr><th>Worker</th><th>Shift</th><th>Recorded status</th><th>Manager guidance</th></tr></thead>
              <tbody>{snapshot.rows.map(row => <tr key={row.key}>
                <td><strong>{row.employeeName}</strong><div className="id">{row.employeeNo}</div></td>
                <td>{row.shiftName}<div className="id">{row.workDate} · {phTime(row.startsAt)}–{phTime(row.endsAt)}</div></td>
                <td><Status value={floorNeedsReview(row.status) ? "Review" : "Recorded"} /><div className="id">{labels[row.status] ?? row.status}</div></td>
                <td><small>{row.explanation}</small></td>
              </tr>)}</tbody>
            </table>
          </div>
        ) : <div className="notice notice-slate">No shift segments in this employee page and live window. This does not mean the whole company has no active shifts.</div>}
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", paddingTop: 12 }}>
          <button className="secondary-button" type="button" disabled={page <= 1 || loading} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous workers</button>
          <span className="id">Page {page}</span>
          <button className="secondary-button" type="button" disabled={!snapshot.hasMore || loading} onClick={() => setPage(p => p + 1)}>Next workers</button>
          <span className="id">Counts apply to this page only; never company-wide totals.</span>
        </div>
      </>}
    </section>
  );
}
