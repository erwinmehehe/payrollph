"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScheduleReceiptDay, ScheduleReceiptView } from "@/lib/workforce-schedule-receipt";

function dateLabel(date: string) {
  return new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: "Asia/Manila" })
    .format(new Date(date + "T12:00:00+08:00"));
}
function timestamp(value: string) {
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date(value));
}
function validView(raw: unknown): raw is ScheduleReceiptView {
  if (!raw || typeof raw !== "object") return false;
  const view = raw as ScheduleReceiptView;
  return typeof view.boundary === "string" && Array.isArray(view.days) && view.days.length === 7 && view.days.every(day =>
    day && typeof day.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day.date) &&
    ["pending", "acknowledged", "changed", "unavailable"].includes(day.state) &&
    (day.snapshotHash === null || /^[a-f0-9]{64}$/.test(day.snapshotHash)) &&
    (day.acknowledgedAt === null || Number.isFinite(Date.parse(day.acknowledgedAt))) &&
    (day.snapshot === null || (Array.isArray(day.snapshot.segments) && typeof day.snapshot.isRestDay === "boolean")));
}
export function EmployeeScheduleReceipts() {
  const [view, setView] = useState<ScheduleReceiptView | null>(null);
  const [selected, setSelected] = useState<ScheduleReceiptDay | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const read = useRef<AbortController | null>(null);
  const write = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const request = ++generation.current;
    read.current?.abort();
    const controller = new AbortController(); read.current = controller;
    setView(null); setSelected(null); setConfirmed(false); setLoading(true);
    try {
      const response = await fetch("/api/self/schedule-receipts", { cache: "no-store", signal: controller.signal });
      const body: unknown = await response.json().catch(() => null);
      if (controller.signal.aborted || request !== generation.current) return;
      if (response.status === 404) { setDisabled(true); return; }
      if (!response.ok || !validView(body)) throw new Error("Your schedule receipts could not be verified. Refresh to try again.");
      setDisabled(false); setView(body);
    } catch (error) {
      if (!controller.signal.aborted && request === generation.current) {
        setView(null); setMessage(error instanceof Error ? error.message : "Schedule receipts unavailable.");
      }
    } finally {
      if (!controller.signal.aborted && request === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    return () => { generation.current++; read.current?.abort(); write.current?.abort(); };
  }, [load]);

  async function acknowledge() {
    if (!selected?.snapshotHash || !confirmed || saving || write.current) return;
    const request = generation.current;
    const target = selected;
    const controller = new AbortController(); write.current = controller;
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/self/schedule-receipts", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ workDate: target.date, snapshotHash: target.snapshotHash, acknowledged: true }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (controller.signal.aborted || request !== generation.current) return;
      if (!response.ok) {
        setMessage(response.status === 409 ? "Your schedule changed. Review the refreshed details before acknowledging."
          : "Acknowledgment was not confirmed. Refresh before retrying.");
        await load(); return;
      }
      if (!body || typeof body !== "object" || !("snapshotHash" in body) || body.snapshotHash !== target.snapshotHash) {
        throw new Error("The acknowledgment response could not be verified. Refresh before retrying.");
      }
      setMessage("Schedule receipt recorded. Attendance and payroll were not changed.");
      await load();
    } catch (error) {
      if (!controller.signal.aborted && request === generation.current) {
        setMessage(error instanceof Error ? error.message : "The connection was interrupted. Refresh to verify your receipt before retrying.");
        setSelected(null); setConfirmed(false);
      }
    } finally {
      if (write.current === controller) { write.current = null; if (!controller.signal.aborted) setSaving(false); }
    }
  }
  if (disabled) return null;
  return <article className="employee-list-card" data-employee-schedule-receipts>
    <div className="employee-list-card-head">
      <div><span className="card-kicker">SCHEDULE RECEIPTS</span><h3>Confirm the schedule you have seen</h3></div>
      <button type="button" className="secondary-button" disabled={loading || saving} onClick={() => { setMessage(""); void load(); }}>Refresh receipts</button>
    </div>
    <p style={{ padding: "0 16px" }}>Receipt only: this is not a clock-in, an agreement to a pay change, or an absence finding. No email or text message is sent.</p>
    {loading && <p role="status" style={{ padding: 16 }}>Loading your current schedule snapshots...</p>}
    {message && <div className="notice notice-slate" role="status" style={{ margin: 16 }}>{message}</div>}
    {view?.days.map(day => <div className="employee-attendance-row" key={day.date}>
      <div><strong>{dateLabel(day.date)}</strong><span>{day.state === "unavailable" ? "No complete published schedule"
        : day.state === "changed" ? "Schedule changed since your last acknowledgment"
        : day.state === "acknowledged" ? "Current snapshot acknowledged" : "Not yet acknowledged"}</span>
        {day.acknowledgedAt && <small>{timestamp(day.acknowledgedAt)} (Philippine time)</small>}
      </div>
      {(day.state === "pending" || day.state === "changed") && <button type="button" className="secondary-button" disabled={saving || loading}
        onClick={() => { setSelected(day); setConfirmed(false); setMessage(""); }}>Review schedule</button>}
    </div>)}
    {selected?.snapshot && <section aria-label="Review the exact schedule snapshot" style={{ padding: 16 }}>
      <h4>{dateLabel(selected.date)}</h4>
      <p>{selected.snapshot.isRestDay ? "Recorded rest day" : "Scheduled work"} · {selected.snapshot.source === "override" ? "Approved schedule change" : "Assigned pattern"}</p>
      <p>Worksite: {selected.snapshot.worksite?.name ?? "Not recorded in the schedule"}</p>
      {selected.snapshot.segments.map(segment => <p key={segment.segmentOrder}>
        <strong>{segment.shiftCode} · {segment.shiftName}</strong><br/>
        {segment.startTime}–{segment.endTime}{segment.spansMidnight ? " (ends next day)" : ""} · {segment.breakMinutes} scheduled break minutes
      </p>)}
      <p>{view?.boundary}</p>
      <label style={{ display: "flex", gap: 10, alignItems: "start", marginBottom: 16 }}>
        <input type="checkbox" checked={confirmed} disabled={saving} onChange={event => setConfirmed(event.target.checked)}/>
        <span>I have seen the schedule snapshot displayed above.</span>
      </label>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="primary-button brand" disabled={!confirmed || saving || loading} onClick={() => void acknowledge()}>
          {saving ? "Recording receipt..." : "Acknowledge this snapshot"}
        </button>
        <button type="button" className="secondary-button" disabled={saving} onClick={() => { setSelected(null); setConfirmed(false); }}>Cancel</button>
      </div>
    </section>}
  </article>;
}
