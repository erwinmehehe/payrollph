"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, PencilLine, RefreshCcw } from "lucide-react";

type ScheduleSegment = {
  shiftDefinitionId: number;
  shiftCode: string;
  shiftName: string;
  segmentOrder: number;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  spansMidnight: boolean;
};

type ScheduleDay = {
  date: string;
  source: "pattern" | "override" | "unassigned";
  isRestDay: boolean;
  overrideId: number | null;
  worksiteId: number | null;
  segments: ScheduleSegment[];
};

type Punch = {
  id: number;
  workDate: string;
  timeIn: string | null;
  timeOut: string | null;
  breakStart: string | null;
  breakEnd: string | null;
  status: string;
  source: string | null;
};

type Correction = {
  id: number;
  punchId: number;
  workDate: string;
  status: string;
  reason: string;
  decisionNote: string | null;
  decidedBy: string | null;
  createdAt: string;
};

type Payload = {
  range: { startDate: string; endDate: string };
  schedule: ScheduleDay[];
  punches: Punch[];
  corrections: Correction[];
};

function phDateLabel(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Manila",
  }).format(new Date(`${value}T12:00:00+08:00`));
}

function phTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}

function toManilaInput(value: string | null) {
  if (!value) return "";
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return "";
  return new Date(instant.getTime() + 8 * 60 * 60_000).toISOString().slice(0, 16);
}

function fromManilaInput(value: string) {
  return value ? `${value}:00+08:00` : null;
}

export function EmployeeWorkforcePanel() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Punch | null>(null);
  const [timeIn, setTimeIn] = useState("");
  const [timeOut, setTimeOut] = useState("");
  const [breakStart, setBreakStart] = useState("");
  const [breakEnd, setBreakEnd] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/self/workforce", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not load your workforce schedule.");
      setPayload(body as Payload);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your workforce schedule.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingByPunch = useMemo(
    () => new Map(
      (payload?.corrections ?? [])
        .filter((row) => row.status === "pending")
        .map((row) => [row.punchId, row]),
    ),
    [payload],
  );

  function openCorrection(punch: Punch) {
    setSelected(punch);
    setTimeIn(toManilaInput(punch.timeIn));
    setTimeOut(toManilaInput(punch.timeOut));
    setBreakStart(toManilaInput(punch.breakStart));
    setBreakEnd(toManilaInput(punch.breakEnd));
    setReason("");
    setError("");
  }

  async function submitCorrection(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || reason.trim().length < 3) return;
    setSaving(true);
    try {
      const response = await fetch("/api/self/workforce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "request_correction",
          punchId: selected.id,
          proposedTimeIn: fromManilaInput(timeIn),
          proposedTimeOut: fromManilaInput(timeOut),
          proposedBreakStart: fromManilaInput(breakStart),
          proposedBreakEnd: fromManilaInput(breakEnd),
          reason: reason.trim(),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not submit the attendance correction.");
      setSelected(null);
      setReason("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not submit the attendance correction.");
    } finally {
      setSaving(false);
    }
  }

  const workingSchedule = (payload?.schedule ?? []).filter(
    (day) => day.source !== "unassigned" || day.isRestDay || day.segments.length > 0,
  );

  return (
    <div style={{ display: "grid", gap: 16, marginTop: 16 }}>
      <article className="employee-list-card">
        <div className="employee-list-card-head">
          <div>
            <span className="card-kicker">MY SCHEDULE</span>
            <h3>Effective workforce schedule</h3>
          </div>
          <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>
            <RefreshCcw size={13} /> {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
        {error && <div className="notice notice-amber"><span>{error}</span></div>}
        {!loading && workingSchedule.length === 0 ? (
          <div className="employee-empty-row">No governed workforce schedule is assigned in this window.</div>
        ) : (
          workingSchedule.map((day) => (
            <div className="employee-attendance-row" key={day.date}>
              <div>
                <strong>{phDateLabel(day.date)}</strong>
                <span>
                  {day.isRestDay
                    ? "Rest day"
                    : day.source === "override"
                      ? "Approved schedule override"
                      : "Assigned schedule"}
                </span>
              </div>
              <div className="employee-attendance-times">
                {day.isRestDay || day.segments.length === 0 ? (
                  <span>Off</span>
                ) : (
                  <span>
                    {day.segments.map((segment) =>
                      `${segment.startTime}–${segment.endTime}${segment.spansMidnight ? " +1" : ""}`,
                    ).join(" · ")}
                  </span>
                )}
              </div>
              <span className={"employee-status-pill " + (day.source === "override" ? "warn" : "good")}>
                {day.source === "override" ? "Changed" : day.isRestDay ? "Rest" : "Scheduled"}
              </span>
            </div>
          ))
        )}
      </article>

      <article className="employee-list-card">
        <div className="employee-list-card-head">
          <div>
            <span className="card-kicker">ATTENDANCE CORRECTIONS</span>
            <h3>Request a correction</h3>
          </div>
          <span className="employee-mini-meta">Manager approval required</span>
        </div>
        <div className="notice notice-slate" style={{ margin: "0 0 10px" }}>
          <span>Your request cannot change attendance or payroll by itself. A separate authorized manager must review it.</span>
        </div>
        {(payload?.punches ?? []).length === 0 ? (
          <div className="employee-empty-row">No punch records are available in this workforce window.</div>
        ) : (
          (payload?.punches ?? []).map((punch) => {
            const pending = pendingByPunch.get(punch.id);
            return (
              <div className="employee-attendance-row" key={punch.id}>
                <div>
                  <strong>{phDateLabel(punch.workDate)}</strong>
                  <span>{punch.source === "web_bundy" ? "Web time clock" : punch.source ?? "Attendance"}</span>
                </div>
                <div className="employee-attendance-times">
                  <span>{phTime(punch.timeIn)}</span>
                  <small>to</small>
                  <span>{phTime(punch.timeOut)}</span>
                </div>
                {pending ? (
                  <span className="employee-status-pill warn">Pending review</span>
                ) : (
                  <button className="secondary-button" type="button" onClick={() => openCorrection(punch)}>
                    <PencilLine size={13} /> Request correction
                  </button>
                )}
              </div>
            );
          })
        )}
      </article>

      {(payload?.corrections ?? []).length > 0 && (
        <article className="employee-list-card">
          <div className="employee-list-card-head">
            <div>
              <span className="card-kicker">MY REQUESTS</span>
              <h3>Correction history</h3>
            </div>
          </div>
          {(payload?.corrections ?? []).map((row) => (
            <div className="employee-attendance-row" key={row.id}>
              <div>
                <strong>{phDateLabel(row.workDate)}</strong>
                <span>{row.reason}</span>
              </div>
              <div>
                {row.decisionNote && <span className="employee-mini-meta">{row.decisionNote}</span>}
              </div>
              <span className={"employee-status-pill " + (row.status === "approved" ? "good" : row.status === "rejected" ? "bad" : "warn")}>
                {row.status}
              </span>
            </div>
          ))}
        </article>
      )}

      {selected && (
        <div className="employee-modal-backdrop" role="presentation">
          <section className="employee-modal" role="dialog" aria-modal="true" aria-labelledby="attendance-correction-title">
            <div className="employee-modal-head">
              <div>
                <span className="card-kicker">ATTENDANCE CORRECTION</span>
                <h3 id="attendance-correction-title">{phDateLabel(selected.workDate)}</h3>
              </div>
              <button className="secondary-button" type="button" onClick={() => setSelected(null)}>Cancel</button>
            </div>
            <form onSubmit={submitCorrection}>
              <div className="employee-form-two">
                <label>Time in<input type="datetime-local" value={timeIn} onChange={(event) => setTimeIn(event.target.value)} /></label>
                <label>Time out<input type="datetime-local" value={timeOut} onChange={(event) => setTimeOut(event.target.value)} /></label>
                <label>Break start<input type="datetime-local" value={breakStart} onChange={(event) => setBreakStart(event.target.value)} /></label>
                <label>Break end<input type="datetime-local" value={breakEnd} onChange={(event) => setBreakEnd(event.target.value)} /></label>
              </div>
              <label>
                Reason
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={240}
                  placeholder="Explain what should be corrected and why."
                  required
                />
              </label>
              <div className="notice notice-slate">
                <CheckCircle2 size={14} />
                <span>This creates a pending request only. Your stored punch remains unchanged until independently approved.</span>
              </div>
              <div className="employee-modal-actions">
                <button className="secondary-button" type="button" onClick={() => setSelected(null)}>Cancel</button>
                <button className="primary-button brand" disabled={saving || reason.trim().length < 3}>
                  <CalendarDays size={14} /> {saving ? "Submitting…" : "Submit for review"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
