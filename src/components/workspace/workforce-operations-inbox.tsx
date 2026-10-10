"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Clock3, RefreshCcw, ShieldCheck } from "lucide-react";
import {
  buildWfmOpsSignals,
  projectAttendanceOps,
  projectTimesheetOps,
  recentAttendanceWindow,
  suggestCompletedHalfMonth,
  type AttendanceOpsCounts,
  type TimesheetOpsCounts,
} from "@/lib/workforce-operations-inbox";
import { phWorkDateAt } from "@/lib/workforce-manager-actions";
import { Metric, Status } from "./ui";

type Source<T> =
  | { state: "loading" }
  | { state: "ok"; data: T }
  | { state: "unavailable"; reason: string };

type Snapshot = {
  scope: string;
  attendance: Source<AttendanceOpsCounts>;
  timesheets: Source<TimesheetOpsCounts>;
};

async function fetchSource<T>(url: string, signal: AbortSignal, project: (input: unknown) => T): Promise<Source<T>> {
  try {
    const response = await fetch(url, { cache: "no-store", signal });
    if (!response.ok) throw new Error(response.status === 403 ? "Access restricted" : "Source unavailable");
    const body: unknown = await response.json();
    return { state: "ok", data: project(body) };
  } catch (error) {
    if (signal.aborted) return { state: "loading" };
    return { state: "unavailable", reason: error instanceof Error ? error.message : "Source unavailable" };
  }
}

export function WorkforceOperationsInbox({
  organizationId,
  onOpenTab,
  onOpenAttendance,
}: {
  organizationId: number;
  onOpenTab: (tab: "timesheets" | "coverage") => void;
  onOpenAttendance: () => void;
}) {
  const [today] = useState(() => phWorkDateAt());
  const defaultPeriod = suggestCompletedHalfMonth(today);
  const [periodStart, setPeriodStart] = useState(defaultPeriod.periodStart);
  const [periodEnd, setPeriodEnd] = useState(defaultPeriod.periodEnd);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const sequence = useRef(0);
  const validDates = /^\d{4}-\d{2}-\d{2}$/;
  const periodValid = validDates.test(periodStart) && validDates.test(periodEnd) && periodEnd >= periodStart
    && !Number.isNaN(Date.parse(periodStart + "T00:00:00Z"))
    && !Number.isNaN(Date.parse(periodEnd + "T00:00:00Z"));
  const scope = [organizationId, periodStart, periodEnd].join(":");

  const load = useCallback(async (signal: AbortSignal, requestId: number) => {
    const attendanceWindow = recentAttendanceWindow(phWorkDateAt());
    const attendanceParams = new URLSearchParams({
      organizationId: String(organizationId), ...attendanceWindow, status: "open",
    });
    const timesheetParams = new URLSearchParams({
      organizationId: String(organizationId), periodStart, periodEnd,
    });
    const [attendance, timesheets] = await Promise.all([
      fetchSource("/api/workforce/attendance-exception-events?" + attendanceParams, signal, projectAttendanceOps),
      fetchSource("/api/workforce/timesheets?" + timesheetParams, signal, projectTimesheetOps),
    ]);
    if (signal.aborted || sequence.current !== requestId) return;
    setSnapshot({ scope, attendance, timesheets });
  }, [organizationId, periodStart, periodEnd, scope]);

  useEffect(() => {
    const requestId = ++sequence.current;
    if (!periodValid) return;
    const controller = new AbortController();
    void load(controller.signal, requestId);
    return () => controller.abort();
  }, [load, refreshIndex, periodValid]);

  const visible = periodValid && snapshot?.scope === scope ? snapshot : null;
  const attendance = visible?.attendance.state === "ok" ? visible.attendance.data : null;
  const timesheets = visible?.timesheets.state === "ok" ? visible.timesheets.data : null;
  const signals = buildWfmOpsSignals(attendance, timesheets);
  const loading = !visible && periodValid;
  const bothAvailable = attendance !== null && timesheets !== null;

  return (
    <article className="card" style={{ marginTop: 16 }} data-wfm-operations-inbox>
      <div className="card-header">
        <div>
          <div className="card-kicker">Workforce operations · read-only manager triage</div>
          <h2>Resolve workforce issues before payroll cut-off.</h2>
          <p>Attendance exception cases and timecard review are independently scoped by the existing source APIs. This is not a release decision, absence finding or automatic wage adjustment.</p>
        </div>
        <button type="button" className="secondary-button" disabled={!periodValid || loading} onClick={() => setRefreshIndex(n => n + 1)}>
          <RefreshCcw size={15} aria-hidden="true" /> Refresh
        </button>
      </div>
      <div className="setting-form" style={{ padding: "0 18px 16px" }}>
        <label>Timesheet period start
          <input type="date" aria-label="Operations timesheet start" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
        </label>
        <label>Timesheet period end
          <input type="date" aria-label="Operations timesheet end" value={periodEnd} min={periodStart} onChange={e => setPeriodEnd(e.target.value)} />
        </label>
        <small>Defaults to the last completed half-month. Select the actual authorized employer pay period before reviewing timecards. Attendance cases cover the last 14 Philippine work dates.</small>
      </div>
      {!periodValid && <div className="notice notice-amber" role="alert">Select a valid start and end date; no old-period data is displayed.</div>}
      {loading && <div className="notice notice-slate" role="status">Loading authorized WFM sources…</div>}
      {visible && (
        <>
          {(!bothAvailable) && (
            <div className="notice notice-amber" role="status">
              Partial data: {visible.attendance.state === "unavailable" ? "attendance " + visible.attendance.reason + ". " : ""}
              {visible.timesheets.state === "unavailable" ? "timesheets " + visible.timesheets.reason + "." : ""}
              Unavailable does not mean zero open cases or payroll-ready.
            </div>
          )}
          <section className="stats-grid" style={{ padding: "0 18px 18px" }}>
            <Metric label="Open attendance cases" value={attendance ? String(attendance.open) : "—"} hint="last 14 PH work dates" icon={<AlertTriangle size={15}/>} tone={attendance?.open ? "amber" : "slate"}/>
            <Metric label="Overdue attendance" value={attendance ? String(attendance.overdue) : "—"} hint="source case SLA" icon={<Clock3 size={15}/>} tone={attendance?.overdue ? "amber" : "slate"}/>
            <Metric label="Awaiting checker" value={timesheets ? String(timesheets.pendingReview) : "—"} hint="selected timesheet period" icon={<Clock3 size={15}/>} tone={timesheets?.pendingReview ? "amber" : "slate"}/>
            <Metric label="Expected missing" value={timesheets ? String(timesheets.missingExpected) : "—"} hint="frozen expected cohort" icon={<AlertTriangle size={15}/>} tone={timesheets?.missingExpected ? "amber" : "slate"}/>
            <Metric label="Timecard blockers" value={timesheets ? String(timesheets.blockers) : "—"} hint="affected latest timecards" icon={<ShieldCheck size={15}/>} tone={timesheets?.blockers ? "amber" : "slate"}/>
          </section>
          {timesheets && <div className="notice notice-slate" style={{ margin: "0 18px 18px" }}>
            Timesheet policy: <strong>{timesheets.enforcement === "block" ? "blocking when required" : "advisory"}</strong>. This screen does not verify all payroll release controls.
          </div>}
          {signals.length > 0 ? (
            <div className="policy-lines" style={{ padding: "0 18px 18px" }}>
              {signals.map(item => <div key={item.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div><Status value={item.priority === "urgent" ? "Urgent" : "Review"}/> <strong>{item.count} · {item.label}</strong></div>
                <button type="button" className="secondary-button" onClick={() => item.destination === "attendance" ? onOpenAttendance() : onOpenTab("timesheets")}>
                  Open source review →
                </button>
              </div>)}
            </div>
          ) : bothAvailable ? (
            <div className="notice notice-slate" style={{ margin: "0 18px 18px" }}>No triage signals in the selected source windows. This does not independently certify payroll readiness.</div>
          ) : null}
          <div className="notice notice-slate" style={{ margin: "0 18px 18px" }}>
            Staffing gaps, shift claims and schedule readiness remain in <button type="button" className="secondary-button" onClick={() => onOpenTab("coverage")}>Coverage operations →</button>
          </div>
        </>
      )}
    </article>
  );
}
