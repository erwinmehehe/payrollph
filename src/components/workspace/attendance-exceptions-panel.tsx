"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarRange, Clock3, RefreshCcw, ShieldAlert } from "lucide-react";
import type { Notify } from "./types";
import { EmptyState, Metric, Segmented, Spinner, Status } from "./ui";

type ExceptionItem = {
  kind: string;
  severity: "info" | "warning" | "blocker";
  message: string;
  punchId?: number;
  minutes?: number;
};

type AttendanceRow = {
  employee: {
    id: number;
    employeeNo: string;
    name: string;
    orgUnitId: number | null;
  };
  analysis: {
    date: string;
    source: "pattern" | "override" | "unassigned";
    isRestDay: boolean;
    scheduledSegments: number;
    punchCount: number;
    workedMinutes: number;
    overtimeMinutes: number;
    tardinessMinutes: number;
    undertimeMinutes: number;
    reviewRequired: boolean;
    exceptions: ExceptionItem[];
  };
};

type ExceptionEvent = {
  id: number;
  employeeId: number;
  workDate: string;
  exceptionKind: string;
  severity: "info" | "warning" | "blocker";
  message: string;
  status: "open" | "resolved";
  ownerUserId: number | null;
  ownerName: string | null;
  slaDueAt: string | null;
  firstDetectedAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  resolvedByName: string | null;
  resolutionRecordedAt: string | null;
  ageHours: number | null;
  slaStatus: "resolved" | "on_track" | "overdue" | "untracked";
};

type ResponsePayload = {
  range: { startDate: string; endDate: string; days: number };
  summary: {
    blockers: number;
    warnings: number;
    info: number;
    employeesAffected: number;
    openPersistedExceptions: number;
    overduePersistedExceptions: number;
    unassignedPersistedExceptions: number;
  };
  days: AttendanceRow[];
  eventLedger: ExceptionEvent[];
};

function localToday() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function addDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function minutesLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function AttendanceExceptionsPanel({
  organizationId,
  notify,
}: {
  organizationId: number;
  notify: Notify;
}) {
  const today = useMemo(localToday, []);
  const [startDate, setStartDate] = useState(() => addDays(today, -13));
  const [endDate, setEndDate] = useState(today);
  const [filter, setFilter] = useState<"review" | "all">("review");
  const [payload, setPayload] = useState<ResponsePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingEventId, setSavingEventId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!startDate || !endDate || endDate < startDate) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        organizationId: String(organizationId),
        startDate,
        endDate,
      });
      const response = await fetch(`/api/workforce/attendance-exceptions?${params.toString()}`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not load attendance exceptions.");
      setPayload(body as ResponsePayload);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load attendance exceptions.", "err");
    } finally {
      setLoading(false);
    }
  }, [endDate, notify, organizationId, startDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    const source = payload?.days ?? [];
    return source
      .filter((row) =>
        filter === "review"
          ? row.analysis.exceptions.some((item) => item.severity === "blocker" || item.severity === "warning")
          : true,
      )
      .sort((a, b) =>
        b.analysis.date.localeCompare(a.analysis.date)
        || a.employee.name.localeCompare(b.employee.name),
      );
  }, [filter, payload]);

  const reviewCount = useMemo(
    () => (payload?.days ?? []).filter((row) =>
      row.analysis.exceptions.some((item) => item.severity === "blocker" || item.severity === "warning"),
    ).length,
    [payload],
  );

  const eventLedger = useMemo(
    () => [...(payload?.eventLedger ?? [])].sort((a, b) =>
      (a.status === b.status ? 0 : a.status === "open" ? -1 : 1)
      || (a.slaStatus === b.slaStatus ? 0 : a.slaStatus === "overdue" ? -1 : 1)
      || String(a.slaDueAt ?? "9999").localeCompare(String(b.slaDueAt ?? "9999"))
      || b.firstDetectedAt.localeCompare(a.firstDetectedAt),
    ),
    [payload],
  );

  async function mutateEvent(
    eventId: number,
    action: "assign" | "record_resolution",
    resolutionNote?: string,
  ) {
    setSavingEventId(eventId);
    try {
      const response = await fetch("/api/workforce/attendance-exceptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          eventId,
          action,
          ...(resolutionNote ? { resolutionNote } : {}),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not update attendance exception.");
      notify(
        action === "assign"
          ? "Attendance exception assigned to you."
          : "Resolution evidence recorded.",
        "ok",
      );
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not update attendance exception.", "err");
    } finally {
      setSavingEventId(null);
    }
  }

  return (
    <section style={{ marginTop: 16 }}>
      <div className="table-toolbar" style={{ border: 0, padding: "0 0 14px" }}>
        <div>
          <div className="card-kicker">Scheduled vs actual</div>
          <h2 style={{ margin: "3px 0 0" }}>Attendance exception center</h2>
        </div>
        <div className="toolbar-spacer" />
        <label className="id">
          From
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} style={{ marginLeft: 7 }} />
        </label>
        <label className="id">
          To
          <input type="date" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} style={{ marginLeft: 7 }} />
        </label>
        <button className="secondary-button" onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner label="Loading" /> : <RefreshCcw size={14} className="i-cyan" />} Refresh
        </button>
      </div>

      <section className="stats-grid">
        <Metric
          label="Blocking"
          value={String(payload?.summary.blockers ?? 0)}
          hint="must be reviewed before payroll"
          icon={<ShieldAlert size={16} className="i-red" />}
          tone={(payload?.summary.blockers ?? 0) ? "red" : "slate"}
        />
        <Metric
          label="Overdue"
          value={String(payload?.summary.overduePersistedExceptions ?? 0)}
          hint="open exceptions beyond SLA"
          icon={<AlertTriangle size={16} className="i-amber" />}
          tone={(payload?.summary.overduePersistedExceptions ?? 0) ? "amber" : "slate"}
        />
        <Metric
          label="Unassigned"
          value={String(payload?.summary.unassignedPersistedExceptions ?? 0)}
          hint="open exceptions without an owner"
          icon={<Clock3 size={16} className="i-cyan" />}
          tone={(payload?.summary.unassignedPersistedExceptions ?? 0) ? "blue" : "slate"}
        />
        <Metric
          label="Window"
          value={payload ? `${payload.range.days}d` : "—"}
          hint={payload ? `${payload.range.startDate} → ${payload.range.endDate}` : "loading range"}
          icon={<CalendarRange size={16} className="i-purple" />}
          tone="purple"
        />
      </section>

      <article className="card table-card" data-wfm-exception-operations>
        <div className="table-toolbar">
          <div>
            <div className="card-kicker">Operational queue</div>
            <h3 style={{ margin: "3px 0 0" }}>Owned attendance exceptions</h3>
          </div>
          <div className="toolbar-spacer" />
          <span className="id">{payload?.summary.openPersistedExceptions ?? 0} open persisted exception(s)</span>
        </div>

        <div className="data-table-wrap slim-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Exception</th>
                <th>Status</th>
                <th>Owner</th>
                <th>SLA</th>
                <th>Evidence</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {eventLedger.map((event) => (
                <tr key={event.id}>
                  <td>
                    <strong>{event.exceptionKind.replaceAll("_", " ")}</strong>
                    <div className="id">{event.workDate} · employee #{event.employeeId}</div>
                    <div className="id">{event.message}</div>
                  </td>
                  <td><Status value={event.status === "open" ? event.severity : "Resolved"} /></td>
                  <td>{event.ownerName ?? <span className="id">Unassigned</span>}</td>
                  <td>
                    <Status value={event.slaStatus === "overdue" ? "Overdue" : event.slaStatus === "on_track" ? "On track" : event.slaStatus === "resolved" ? "Resolved" : "Untracked"} />
                    <div className="id">
                      {event.ageHours == null ? "Age unavailable" : `${event.ageHours}h old`}
                      {event.slaDueAt ? ` · due ${new Date(event.slaDueAt).toLocaleString()}` : ""}
                    </div>
                  </td>
                  <td>
                    {event.resolutionRecordedAt ? (
                      <>
                        <strong>{event.resolvedByName ?? "Recorded"}</strong>
                        <div className="id">{event.resolutionNote ?? "Resolution evidence recorded."}</div>
                      </>
                    ) : (
                      <span className="id">{event.status === "resolved" ? "Resolution note pending" : "Awaiting resolution"}</span>
                    )}
                  </td>
                  <td>
                    {event.status === "open" && event.ownerUserId == null ? (
                      <button
                        className="secondary-button"
                        disabled={savingEventId === event.id}
                        onClick={() => void mutateEvent(event.id, "assign")}
                      >
                        Assign to me
                      </button>
                    ) : event.status === "resolved" && !event.resolutionRecordedAt ? (
                      <button
                        className="secondary-button"
                        disabled={savingEventId === event.id}
                        onClick={() => {
                          const note = window.prompt("Resolution evidence / note");
                          if (note?.trim()) void mutateEvent(event.id, "record_resolution", note.trim());
                        }}
                      >
                        Add resolution note
                      </button>
                    ) : (
                      <span className="id">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && eventLedger.length === 0 && (
            <EmptyState icon={<ShieldAlert size={20} className="i-green" />} title="No persisted exception events">
              Attendance mutations have not produced any governed exception records in this window.
            </EmptyState>
          )}
        </div>
      </article>

      <article className="card table-card">
        <div className="table-toolbar">
          <div className="notice notice-slate" style={{ margin: 0, flex: 1 }}>
            <ShieldAlert size={14} className="i-green" />
            <span>
              OT authorization is a review control only. It never zeroes legally payable overtime from validated attendance.
            </span>
          </div>
          <Segmented
            label="Exception filter"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "review", label: `Needs review (${reviewCount})` },
              { value: "all", label: `All signals (${payload?.days.length ?? 0})` },
            ]}
          />
        </div>

        <div className="data-table-wrap slim-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Date</th>
                <th>Schedule</th>
                <th>Attendance</th>
                <th>Exception</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const strongest = row.analysis.exceptions.some((item) => item.severity === "blocker")
                  ? "Blocking"
                  : row.analysis.exceptions.some((item) => item.severity === "warning")
                    ? "Warning"
                    : "Info";
                return (
                  <tr key={`${row.employee.id}-${row.analysis.date}`}>
                    <td>
                      <strong>{row.employee.name}</strong>
                      <div className="id">{row.employee.employeeNo}</div>
                    </td>
                    <td className="num">{row.analysis.date}</td>
                    <td>
                      <Status value={row.analysis.isRestDay ? "Rest day" : row.analysis.source === "unassigned" ? "Unassigned" : "Scheduled"} />
                      <div className="id">{row.analysis.scheduledSegments} segment(s)</div>
                    </td>
                    <td>
                      <strong>{row.analysis.punchCount} punch record(s)</strong>
                      <div className="id">
                        worked {minutesLabel(row.analysis.workedMinutes)}
                        {row.analysis.overtimeMinutes > 0 ? ` · OT ${minutesLabel(row.analysis.overtimeMinutes)}` : ""}
                      </div>
                    </td>
                    <td>
                      <Status value={strongest} />
                      <div style={{ marginTop: 5, display: "grid", gap: 3 }}>
                        {row.analysis.exceptions.map((item, index) => (
                          <span className="id" key={`${item.kind}-${item.punchId ?? 0}-${index}`}>
                            {item.message}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!loading && rows.length === 0 && (
            <EmptyState icon={<ShieldAlert size={20} className="i-green" />} title="No attendance exceptions in this view">
              Scheduled attendance and stored punches reconcile for the selected window.
            </EmptyState>
          )}
        </div>
      </article>
    </section>
  );
}
