"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clock, Coffee, LogIn, LogOut, MapPin, PlayCircle, X } from "lucide-react";

type BundyEmployee = {
  id: number;
  employeeNo: string;
  firstName: string;
  lastName: string;
};

export function WebBundyModal({
  organizationId,
  employeeId,
  employeeName,
  employees = [],
  onClose,
  onPunchSuccess,
}: {
  organizationId: number;
  employeeId?: number;
  employeeName?: string;
  employees?: BundyEmployee[];
  onClose: () => void;
  onPunchSuccess: () => void;
}) {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(employeeId ?? null);
  const [time, setTime] = useState("");
  const [date, setDate] = useState("");
  const [punches, setPunches] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.id === selectedEmployeeId) ?? null,
    [employees, selectedEmployeeId],
  );
  const displayName = selectedEmployee
    ? `${selectedEmployee.firstName} ${selectedEmployee.lastName}`
    : employeeName ?? "Select an employee";

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString("en-PH", { hour12: true, hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      setDate(now.toLocaleDateString("en-PH", { weekday: "long", year: "numeric", month: "long", day: "numeric" }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const [nonce, setNonce] = useState(0);
  const reloadPunches = useCallback(() => setNonce((current) => current + 1), []);

  useEffect(() => {
    let alive = true;
    setPunches([]);
    if (!selectedEmployeeId) return () => { alive = false; };

    (async () => {
      try {
        const res = await fetch(`/api/web-bundy?organizationId=${organizationId}&employeeId=${selectedEmployeeId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!alive) return;
        setPunches(data.punches ?? []);
      } catch {
        // A failed refresh leaves the clock usable; the mutation endpoint remains authoritative.
      }
    })();

    return () => {
      alive = false;
    };
  }, [organizationId, selectedEmployeeId, nonce]);

  async function handlePunch(actionType: "clock_in" | "break_start" | "break_end" | "clock_out") {
    if (!selectedEmployeeId) {
      setError("Select an employee before recording attendance.");
      return;
    }

    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/web-bundy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          employeeId: selectedEmployeeId,
          actionType,
          location: "Web Bundy (Workstation / Mobile Browser)",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Clock punch failed.");
        return;
      }
      const labels = {
        clock_in: "Clock IN recorded.",
        break_start: "Break started.",
        break_end: "Break ended.",
        clock_out: "Clock OUT recorded.",
      } as const;
      setMessage(labels[actionType]);
      reloadPunches();
      onPunchSuccess();
    } catch {
      setError("Network error recording punch.");
    } finally {
      setBusy(false);
    }
  }

  const todayPunch = punches[0];
  const breakActive = Boolean(todayPunch?.breakStart && !todayPunch?.breakEnd);
  const canClockIn = Boolean(selectedEmployeeId) && !todayPunch?.timeIn;
  const canStartBreak = Boolean(selectedEmployeeId && todayPunch?.timeIn && !todayPunch?.breakStart && !todayPunch?.timeOut);
  const canEndBreak = Boolean(selectedEmployeeId && breakActive && !todayPunch?.timeOut);
  const canClockOut = Boolean(selectedEmployeeId && todayPunch?.timeIn && !todayPunch?.timeOut && !breakActive);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal" role="dialog" aria-modal="true" aria-label="Web Bundy Time Clock">
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="modal-icon"><Clock size={22} className="i-cyan" /></div>
        <div className="card-kicker">WEB &amp; TEAM TIME CLOCK</div>
        <h2>{displayName}&apos;s attendance</h2>
        <p>Role-controlled browser clocking for workstation, tablet or mobile use. Payroll still derives payable time from the stored punch evidence.</p>

        {!employeeId && employees.length > 0 && (
          <label style={{ display: "grid", gap: 6, margin: "14px 0" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>Employee</span>
            <select
              value={selectedEmployeeId ?? ""}
              onChange={(event) => {
                const next = Number(event.target.value);
                setSelectedEmployeeId(Number.isInteger(next) && next > 0 ? next : null);
                setMessage("");
                setError("");
              }}
              aria-label="Select employee for team time clock"
            >
              <option value="">Select employee…</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.employeeNo} · {employee.firstName} {employee.lastName}
                </option>
              ))}
            </select>
          </label>
        )}

        <div style={{ textAlign: "center", padding: "20px 10px", background: "linear-gradient(135deg, #0e2e28 0%, #154c41 100%)", color: "white", borderRadius: 12, margin: "14px 0" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "#8ec4b2" }}>Philippine Standard Time (PST · UTC+8)</div>
          <div style={{ fontSize: 36, fontWeight: 900, letterSpacing: "-1px", margin: "6px 0", color: "#50d29d", fontVariantNumeric: "tabular-nums" }}>{time || "12:00:00 PM"}</div>
          <div style={{ fontSize: 12, color: "#d2ece2" }}>{date}</div>
        </div>

        {selectedEmployeeId && todayPunch && (
          <div style={{ background: "var(--canvas-subtle)", padding: 12, borderRadius: 10, marginBottom: 14, fontSize: 11.5 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span>Clock IN:</span>
              <strong>{todayPunch.timeIn ? new Date(todayPunch.timeIn).toLocaleTimeString("en-PH") : "Not recorded"}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span>Break:</span>
              <strong>
                {breakActive
                  ? "In progress"
                  : todayPunch.breakStart && todayPunch.breakEnd
                    ? `${new Date(todayPunch.breakStart).toLocaleTimeString("en-PH")}–${new Date(todayPunch.breakEnd).toLocaleTimeString("en-PH")}`
                    : "Not recorded"}
              </strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Clock OUT:</span>
              <strong>{todayPunch.timeOut ? new Date(todayPunch.timeOut).toLocaleTimeString("en-PH") : "In progress"}</strong>
            </div>
          </div>
        )}

        {message && <div className="notice notice-green" style={{ margin: "10px 0" }}><Check size={16} className="i-green" /><span>{message}</span></div>}
        {error && <div className="notice notice-amber" style={{ margin: "10px 0" }}><span>{error}</span></div>}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
          <button className="primary-button" disabled={busy || !canClockIn} onClick={() => handlePunch("clock_in")} style={{ height: 42, background: "var(--green)", fontSize: 13 }}>
            <LogIn size={16} /> Clock IN
          </button>
          <button className="secondary-button" disabled={busy || !canStartBreak} onClick={() => handlePunch("break_start")} style={{ height: 42, fontSize: 13 }}>
            <Coffee size={16} /> Start break
          </button>
          <button className="secondary-button" disabled={busy || !canEndBreak} onClick={() => handlePunch("break_end")} style={{ height: 42, fontSize: 13 }}>
            <PlayCircle size={16} /> End break
          </button>
          <button className="secondary-button" disabled={busy || !canClockOut} onClick={() => handlePunch("clock_out")} style={{ height: 42, fontSize: 13 }}>
            <LogOut size={16} /> Clock OUT
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, color: "var(--muted)", fontSize: 11 }}>
          <MapPin size={14} className="i-blue" />
          <span>Browser IP and attendance source are audit-stamped. Shared team clocking remains role-controlled.</span>
        </div>
      </section>
    </div>
  );
}
