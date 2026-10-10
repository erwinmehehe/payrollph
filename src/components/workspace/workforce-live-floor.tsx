"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock3, RefreshCcw, UsersRound } from "lucide-react";
import type { FloorRow } from "@/lib/workforce-live-floor";
import { floorNeedsReview } from "@/lib/workforce-live-floor";
import { activeLiveFloorSnapshot, isCurrentLiveFloorRequest, liveFloorScopeKey, type ScopedLiveFloorSnapshot } from "@/lib/workforce-live-floor-client";
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
  const [snapshot, setSnapshot] = useState<ScopedLiveFloorSnapshot<FloorSnapshot> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"all" | "review" | "on_shift" | "upcoming" | "leave">("all");
  const [search, setSearch] = useState("");
  const pendingRequest = useRef<AbortController | null>(null);
  const scopeKey = liveFloorScopeKey(organizationId, page);
  const activeSnapshot = activeLiveFloorSnapshot(snapshot, scopeKey);
  const load = useCallback(async () => {
    // A manual refresh, page change, or tenant switch invalidates older
    // requests; an older private roster must never replace the current view.
    pendingRequest.current?.abort();
    const controller = new AbortController();
    pendingRequest.current = controller;
    const requestedScope = liveFloorScopeKey(organizationId, page);
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ organizationId: String(organizationId), page: String(page) });
      const response = await fetch("/api/workforce/live-floor?" + params, {
        cache: "no-store", signal: controller.signal,
      });
      const value = await response.json();
      if (!isCurrentLiveFloorRequest(controller, pendingRequest.current)) return;
      if (!response.ok) throw new Error(value?.error ?? "Live floor could not be loaded.");
      if (value?.page !== page) throw new Error("Live floor returned an unexpected worker page.");
      setSnapshot({ scopeKey: requestedScope, data: value as FloorSnapshot });
    } catch (err) {
      if (!isCurrentLiveFloorRequest(controller, pendingRequest.current)) return;
      setError(err instanceof Error ? err.message : "Could not load live floor.");
      setSnapshot(null);
    } finally {
      if (pendingRequest.current === controller) {
        pendingRequest.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  }, [organizationId, page]);

  useEffect(() => {
    void load();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    return () => { pendingRequest.current?.abort(); clearInterval(interval); };
  }, [load]);

  useEffect(() => { setPage(1); setSearch(""); setView("all"); }, [organizationId]);

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("en-PH");
    const matches = (activeSnapshot?.rows ?? []).filter(row => {
      const category = view === "all" ||
        (view === "review" && floorNeedsReview(row.status)) ||
        (view === "on_shift" && ["clocked_in", "break_recorded"].includes(row.status)) ||
        (view === "upcoming" && ["upcoming", "check_in_window"].includes(row.status)) ||
        (view === "leave" && row.status === "approved_leave");
      return category && (!needle ||
        (row.employeeName + " " + row.employeeNo + " " + row.shiftName).toLocaleLowerCase("en-PH").includes(needle));
    });
    return matches.sort((a, b) =>
      Number(floorNeedsReview(b.status)) - Number(floorNeedsReview(a.status)) ||
      a.startsAt.localeCompare(b.startsAt) || a.employeeId - b.employeeId);
  }, [activeSnapshot?.rows, view, search]);

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
      {activeSnapshot && <>
        <p className="id">As of {phTime(activeSnapshot.generatedAt)} (Asia/Manila), {activeSnapshot.workDate} · worker page {activeSnapshot.page} · {activeSnapshot.totalEmployees} visible employees</p>
        <div className="stats-grid">
          <Metric label="Shift segments" value={String(activeSnapshot.summary.shiftSegments)} hint="this page" icon={<UsersRound size={16} />} tone="slate" />
          <Metric label="Recorded clock-ins" value={String(activeSnapshot.summary.recordedIn)} hint="includes recorded breaks" icon={<Clock3 size={16} />} tone="blue" />
          <Metric label="Needs review" value={String(activeSnapshot.summary.requiresReview)} hint="not automatically absent" icon={<Clock3 size={16} />} tone={activeSnapshot.summary.requiresReview ? "amber" : "mint"} />
          <Metric label="Approved full leave" value={String(activeSnapshot.summary.approvedLeave)} hint="schedule context" icon={<Clock3 size={16} />} tone="slate" />
        </div>
        {activeSnapshot.unresolvedSchedules > 0 && <div role="status" className="notice notice-amber">{activeSnapshot.unresolvedSchedules} worker schedule(s) could not be resolved; do not treat this page as complete.</div>}
        <div className="setting-form" style={{ padding: "4px 0 12px", display: "flex", flexWrap: "wrap", alignItems: "end", gap: 12 }}>
          <label>Show
            <select aria-label="Filter live floor shift status" value={view} onChange={event => setView(event.target.value as typeof view)}>
              <option value="all">All shifts on this page</option>
              <option value="review">Needs manager review</option>
              <option value="on_shift">Clock-in or break recorded</option>
              <option value="upcoming">Upcoming / grace window</option>
              <option value="leave">Approved full-day leave</option>
            </select>
          </label>
          <label>Find worker on this page
            <input type="search" value={search} onChange={event => setSearch(event.target.value)}
              placeholder="Name, employee no. or shift" />
          </label>
          <span className="id" role="status">{visibleRows.length} of {activeSnapshot.rows.length} shift segment(s) on this page</span>
        </div>
        {visibleRows.length ? (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead><tr><th>Worker</th><th>Shift</th><th>Recorded status</th><th>Manager guidance</th></tr></thead>
              <tbody>{visibleRows.map(row => <tr key={row.key}>
                <td><strong>{row.employeeName}</strong><div className="id">{row.employeeNo}</div></td>
                <td>{row.shiftName}<div className="id">{row.workDate} · {phTime(row.startsAt)}–{phTime(row.endsAt)}</div></td>
                <td><Status value={floorNeedsReview(row.status) ? "Review" : ["upcoming", "check_in_window"].includes(row.status) ? "Upcoming" : row.status === "approved_leave" ? "Leave" : "Recorded"} /><div className="id">{labels[row.status] ?? row.status}</div></td>
                <td><small>{row.explanation}</small>{floorNeedsReview(row.status) && (
                  <div><a className="id" href="#wfm-labor-variance">Open attendance review →</a></div>
                )}</td>
              </tr>)}</tbody>
            </table>
          </div>
        ) : <div className="notice notice-slate">
          {activeSnapshot.rows.length > 0 ? "No shifts on this page match these filters." :
            "No shift segments in this employee page and live window. This does not mean the whole company has no active shifts."}
        </div>}
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", paddingTop: 12 }}>
          <button className="secondary-button" type="button" disabled={page <= 1 || loading} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous workers</button>
          <span className="id">Page {page}</span>
          <button className="secondary-button" type="button" disabled={!activeSnapshot.hasMore || loading} onClick={() => setPage(p => p + 1)}>Next workers</button>
          <span className="id">Counts and filters apply to this page only, independent of the Coverage Dynamic Group filter.</span>
        </div>
      </>}
    </section>
  );
}
