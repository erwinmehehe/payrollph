"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarRange, CheckCircle2, Clock3, RefreshCcw, ShieldAlert, UserRoundCheck } from "lucide-react";
import type { Notify } from "./types";
import { AttendanceLockControl } from "./attendance-lock-control";
import { readVerifiedAttendanceAnalysis, readVerifiedAttendanceOperations, type AttendanceAnalysisRead as ResponsePayload, type AttendanceOperationsRead as OperationsPayload } from "@/lib/attendance-exception-read";
import { EmptyState, ErrorState, Metric, Segmented, Spinner, Status } from "./ui";

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

function readFailureMessage(error: unknown, fallback: string) {
  if (error instanceof Error && /Unauthorized|access to this workspace|Only .*roles can/i.test(error.message)) {
    return "Your session or workspace permissions need attention. Sign in again or contact your administrator.";
  }
  return fallback;
}

type AttendanceExceptionsProps = {
  organizationId: number;
  notify: Notify;
};

// Remount persisted exception evidence, owner selections and resolution drafts
// whenever the selected legal employer changes.
export function AttendanceExceptionsPanel(props: AttendanceExceptionsProps) {
  return <ScopedAttendanceExceptionsPanel key={props.organizationId} {...props} />;
}

function ScopedAttendanceExceptionsPanel({
  organizationId,
  notify,
}: AttendanceExceptionsProps) {
  const today = useMemo(() => localToday(), []);
  const [startDate, setStartDate] = useState(() => addDays(today, -13));
  const [endDate, setEndDate] = useState(today);
  const [filter, setFilter] = useState<"review" | "all">("review");
  const [payload, setPayload] = useState<ResponsePayload | null>(null);
  const [operations, setOperations] = useState<OperationsPayload | null>(null);
  const [resolutionDrafts, setResolutionDrafts] = useState<Record<number, string>>({});
  const [actionBusyId, setActionBusyId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [operationsError, setOperationsError] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);
  const loadRevisionRef = useRef(0);
  const mutationRevisionRef = useRef(0);

  const load = useCallback(async () => {
    if (!mountedRef.current) return;
    activeRequest.current?.abort();
    const revision = ++loadRevisionRef.current;
    activeRequest.current = null;
    // A new date window can no longer use its previous exception owner
    // selections or pending resolution notes.
    setResolutionDrafts({});
    setActionBusyId(null);
    if (!startDate || !endDate || endDate < startDate) {
      setPayload(null);
      setOperations(null);
      setAnalysisError("Select a valid start and end date to review exceptions.");
      setOperationsError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    activeRequest.current = controller;
    const isCurrent = () =>
      mountedRef.current && !controller.signal.aborted
      && activeRequest.current === controller && revision === loadRevisionRef.current;
    // A new employer or date range must never display previously loaded results.
    setLoading(true);
    setPayload(null);
    setOperations(null);
    setAnalysisError(null);
    setOperationsError(null);

    try {
      // Keep attendance analysis available even if the separate persisted
      // exception-operations service is unavailable (e.g. schema not migrated).
      const [analysis, events] = await Promise.allSettled([
        readVerifiedAttendanceAnalysis(organizationId, startDate, endDate, fetch, controller.signal),
        readVerifiedAttendanceOperations(organizationId, startDate, endDate, fetch, controller.signal),
      ]);
      if (!isCurrent()) return;

      if (analysis.status === "fulfilled") {
        setPayload(analysis.value);
      } else {
        setAnalysisError(readFailureMessage(
          analysis.reason,
          "Attendance analysis could not be loaded. No attendance data has been changed.",
        ));
      }
      if (events.status === "fulfilled") {
        setOperations(events.value);
      } else {
        setOperationsError(readFailureMessage(
          events.reason,
          "Exception ownership and SLA information is unavailable. No case data has been changed.",
        ));
      }
    } finally {
      if (isCurrent()) {
        activeRequest.current = null;
        setLoading(false);
      }
    }
  }, [endDate, organizationId, startDate]);

  useEffect(() => {
    mountedRef.current = true;
    let retired = false;
    queueMicrotask(() => { if (!retired) void load(); });
    return () => {
      retired = true;
      mountedRef.current = false;
      loadRevisionRef.current += 1;
      mutationRevisionRef.current += 1;
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [load]);

  const mutateOperationalException = useCallback(async (
    eventId: number,
    action: "assign_owner" | "record_resolution",
    extra: Record<string, unknown>,
  ) => {
    if (!mountedRef.current) return;
    const mutationRevision = ++mutationRevisionRef.current;
    const readRevision = loadRevisionRef.current;
    const isCurrentMutation = () =>
      mountedRef.current && mutationRevision === mutationRevisionRef.current
      && readRevision === loadRevisionRef.current;
    setActionBusyId(eventId);
    try {
      const response = await fetch("/api/workforce/attendance-exception-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, eventId, action, ...extra }),
      });
      const body = await response.json().catch(() => ({}));
      if (!isCurrentMutation()) return;
      if (!response.ok) throw new Error(body.error ?? "Could not update attendance exception operations.");
      if (body.organizationId !== organizationId || body.eventId !== eventId ||
          !body.exception || body.exception.id !== eventId) {
        throw new Error("Attendance exception action response could not be verified. Refresh before retrying.");
      }
      if (action === "record_resolution") {
        setResolutionDrafts((current) => {
          const next = { ...current };
          delete next[eventId];
          return next;
        });
      }
      notify(
        action === "assign_owner"
          ? "Attendance exception owner updated."
          : "Attendance exception resolution evidence recorded.",
        "ok",
      );
      await load();
    } catch (error) {
      if (isCurrentMutation()) {
        notify(error instanceof Error ? error.message : "Could not update attendance exception operations.", "err");
      }
    } finally {
      if (mountedRef.current && mutationRevision === mutationRevisionRef.current) setActionBusyId(null);
    }
  }, [load, notify, organizationId]);

  const recordResolution = useCallback(async (eventId: number) => {
    const resolutionNote = String(resolutionDrafts[eventId] ?? "").trim();
    if (resolutionNote.length < 3) {
      notify("Add a short resolution note before recording evidence.", "err");
      return;
    }
    await mutateOperationalException(eventId, "record_resolution", { resolutionNote });
  }, [mutateOperationalException, notify, resolutionDrafts]);

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
          value={payload ? String(payload.summary.blockers) : "—"}
          hint="must be reviewed before payroll"
          icon={<ShieldAlert size={16} className="i-red" />}
          tone={(payload?.summary.blockers ?? 0) ? "red" : "slate"}
        />
        <Metric
          label="Warnings"
          value={payload ? String(payload.summary.warnings) : "—"}
          hint="late, undertime or unscheduled work"
          icon={<AlertTriangle size={16} className="i-amber" />}
          tone={(payload?.summary.warnings ?? 0) ? "amber" : "slate"}
        />
        <Metric
          label="Employees affected"
          value={payload ? String(payload.summary.employeesAffected) : "—"}
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

      {analysisError && (
        <ErrorState
          title="Attendance exception analysis unavailable"
          detail={analysisError}
          onRetry={() => void load()}
        />
      )}

      <AttendanceLockControl
        organizationId={organizationId}
        startDate={startDate}
        endDate={endDate}
        notify={notify}
      />

      <article className="card table-card" style={{ marginBottom: 16 }}>
        <div className="table-toolbar">
          <div>
            <div className="card-kicker">Operational control</div>
            <h3 style={{ margin: "3px 0 0" }}>Exception ownership &amp; SLA</h3>
          </div>
          <div className="toolbar-spacer" />
          <span className="id">Severity SLA: blocker 4h · warning 24h · info 72h</span>
        </div>

        <section className="stats-grid" style={{ padding: "0 14px 14px" }}>
          <Metric
            label="Open cases"
            value={operations ? String(operations.summary.open) : "—"}
            hint="persisted WFM exception events"
            icon={<ShieldAlert size={16} className="i-amber" />}
            tone={(operations?.summary.open ?? 0) ? "amber" : "slate"}
          />
          <Metric
            label="Overdue"
            value={operations ? String(operations.summary.overdue) : "—"}
            hint="past severity-based SLA"
            icon={<Clock3 size={16} className="i-red" />}
            tone={(operations?.summary.overdue ?? 0) ? "red" : "slate"}
          />
          <Metric
            label="Unassigned"
            value={operations ? String(operations.summary.unassigned) : "—"}
            hint="open cases without an owner"
            icon={<UserRoundCheck size={16} className="i-cyan" />}
            tone={(operations?.summary.unassigned ?? 0) ? "blue" : "slate"}
          />
          <Metric
            label="Resolved"
            value={operations ? String(operations.summary.resolved) : "—"}
            hint="closed by corrected attendance evidence"
            icon={<CheckCircle2 size={16} className="i-green" />}
            tone="slate"
          />
        </section>

        {operationsError && (
          <ErrorState
            title="Exception ownership unavailable"
            detail={operationsError}
            onRetry={() => void load()}
          />
        )}

        <div className="data-table-wrap slim-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Exception</th>
                <th>Owner</th>
                <th>SLA / age</th>
                <th>Resolution evidence</th>
              </tr>
            </thead>
            <tbody>
              {(operations?.exceptions ?? []).map((item) => {
                const employeeName = item.employee
                  ? `${item.employee.firstName} ${item.employee.lastName}`
                  : `Employee #${item.employeeId}`;
                const slaLabel = item.slaStatus === "overdue"
                  ? "Overdue"
                  : item.slaStatus === "on_track"
                    ? "On track"
                    : item.slaStatus === "resolved"
                      ? "Resolved"
                      : "Untracked";
                return (
                  <tr key={item.id}>
                    <td>
                      <strong>{employeeName}</strong>
                      <div className="id">{item.employee?.employeeNo ?? "—"} · {item.workDate}</div>
                    </td>
                    <td>
                      <Status value={item.severity === "blocker" ? "Blocking" : item.severity === "warning" ? "Warning" : "Info"} />
                      <div className="id" style={{ marginTop: 4 }}>{item.exceptionKind.replaceAll("_", " ")}</div>
                      <div className="id" style={{ marginTop: 3 }}>{item.message}</div>
                    </td>
                    <td>
                      {item.status === "open" ? (
                        <select
                          value={item.ownerUserId ?? ""}
                          disabled={actionBusyId === item.id}
                          onChange={(event) => {
                            const value = event.target.value;
                            void mutateOperationalException(item.id, "assign_owner", {
                              ownerUserId: value ? Number(value) : null,
                            });
                          }}
                        >
                          <option value="">Unassigned</option>
                          {(operations?.ownerCandidates ?? []).map((owner) => (
                            <option key={owner.userId} value={owner.userId}>
                              {owner.name} · {owner.role}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="id">{item.ownerName ?? "No owner recorded"}</span>
                      )}
                    </td>
                    <td>
                      <Status value={slaLabel} />
                      <div className="id" style={{ marginTop: 4 }}>
                        {item.ageHours == null ? "Age unavailable" : `${item.ageHours}h old`}
                      </div>
                      <div className="id">
                        {item.slaDueAt ? `Due ${new Date(item.slaDueAt).toLocaleString()}` : "No SLA due time"}
                      </div>
                    </td>
                    <td style={{ minWidth: 260 }}>
                      {item.status === "open" ? (
                        <span className="id">Resolve the underlying punch/schedule evidence first.</span>
                      ) : item.resolutionRecordedAt ? (
                        <>
                          <strong>{item.resolutionNote ?? "Resolved"}</strong>
                          <div className="id">
                            {item.resolvedByName ?? "System"} · {new Date(item.resolutionRecordedAt).toLocaleString()}
                          </div>
                        </>
                      ) : (
                        <div style={{ display: "grid", gap: 6 }}>
                          <input
                            value={resolutionDrafts[item.id] ?? ""}
                            onChange={(event) => setResolutionDrafts((current) => ({
                              ...current,
                              [item.id]: event.target.value,
                            }))}
                            placeholder="Resolution note / evidence"
                            maxLength={1000}
                          />
                          <button
                            className="secondary-button"
                            disabled={actionBusyId === item.id}
                            onClick={() => void recordResolution(item.id)}
                          >
                            <CheckCircle2 size={14} className="i-green" />
                            Record evidence
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!loading && operations !== null && operations.exceptions.length === 0 && (
            <EmptyState icon={<CheckCircle2 size={20} className="i-green" />} title="No persisted exception cases in this window">
              New attendance exceptions will appear here with owner and SLA tracking.
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
              { value: "review", label: `Needs review (${payload ? reviewCount : "—"})` },
              { value: "all", label: `All signals (${payload ? payload.days.length : "—"})` },
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

          {!loading && payload !== null && rows.length === 0 && (
            <EmptyState icon={<ShieldAlert size={20} className="i-green" />} title="No attendance exceptions in this view">
              Scheduled attendance and stored punches reconcile for the selected window.
            </EmptyState>
          )}
        </div>
      </article>
    </section>
  );
}
