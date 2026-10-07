"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarRange, Clock3, RefreshCcw, ShieldAlert } from "lucide-react";
import type { Notify } from "./types";
import { AttendanceLockControl } from "./attendance-lock-control";
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

type ResponsePayload = {
  range: { startDate: string; endDate: string; days: number };
  summary: { blockers: number; warnings: number; info: number; employeesAffected: number };
  days: AttendanceRow[];
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
          label="Warnings"
          value={String(payload?.summary.warnings ?? 0)}
          hint="late, undertime or unscheduled work"
          icon={<AlertTriangle size={16} className="i-amber" />}
          tone={(payload?.summary.warnings ?? 0) ? "amber" : "slate"}
        />
        <Metric
          label="Employees affected"
          value={String(payload?.summary.employeesAffected ?? 0)}
          hint="with blocking or warning items"
          icon={<Clock3 size={16} className="i-cyan" />}
          tone={(payload?.summary.employeesAffected ?? 0) ? "blue" : "slate"}
        />
        <Metric
          label="Window"
          value={payload ? `${payload.range.days}d` : "—"}
          hint={payload ? `${payload.range.startDate} → ${payload.range.endDate}` : "loading range"}
          icon={<CalendarRange size={16} className="i-purple" />}
          tone="purple"
        />
      </section>

      <AttendanceLockControl
        organizationId={organizationId}
        startDate={startDate}
        endDate={endDate}
        notify={notify}
      />

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
