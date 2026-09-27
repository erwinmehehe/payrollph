"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Clock, Laptop, LogIn, LogOut, MapPin, ShieldCheck, X } from "lucide-react";

export function WebBundyModal({
  organizationId,
  employeeId,
  employeeName,
  onClose,
  onPunchSuccess,
}: {
  organizationId: number;
  employeeId?: number;
  employeeName?: string;
  onClose: () => void;
  onPunchSuccess: () => void;
}) {
  const [time, setTime] = useState("");
  const [date, setDate] = useState("");
  const [punches, setPunches] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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

  // The fetch lives in the effect so every state update happens after an await,
  // and `alive` stops a slow response overwriting a newer one.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/web-bundy?organizationId=${organizationId}${employeeId ? `&employeeId=${employeeId}` : ""}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!alive) return;
        setPunches(data.punches ?? []);
      } catch {
        // A failed refresh leaves the last known punches on screen.
      }
    })();
    return () => {
      alive = false;
    };
  }, [organizationId, employeeId, nonce]);

  async function handlePunch(actionType: "clock_in" | "clock_out") {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/web-bundy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          employeeId,
          actionType,
          location: "Web Bundy (Workstation Browser)",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Clock punch failed.");
        return;
      }
      setMessage(actionType === "clock_in" ? "Clock IN recorded successfully!" : "Clock OUT recorded successfully!");
      reloadPunches();
      onPunchSuccess();
    } catch {
      setError("Network error recording punch.");
    } finally {
      setBusy(false);
    }
  }

  const todayPunch = punches.find((p) => employeeId ? p.employeeId === employeeId : true);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal" role="dialog" aria-modal="true" aria-label="Web Bundy Time Clock">
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="modal-icon"><Clock size={22} className="i-cyan" /></div>
        <div className="card-kicker">BUILT-IN WEB BUNDY CLOCK</div>
        <h2>{employeeName ? `${employeeName}'s Time Clock` : "Workforce Web Bundy"}</h2>
        <p>Real-time attendance recording with automatic tardiness, undertime, and night differential classification.</p>

        <div style={{ textAlign: "center", padding: "20px 10px", background: "linear-gradient(135deg, #0e2e28 0%, #154c41 100%)", color: "white", borderRadius: 12, margin: "14px 0" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "#8ec4b2" }}>Philippine Standard Time (PST · UTC+8)</div>
          <div style={{ fontSize: 36, fontWeight: 900, letterSpacing: "-1px", margin: "6px 0", color: "#50d29d", fontVariantNumeric: "tabular-nums" }}>{time || "12:00:00 PM"}</div>
          <div style={{ fontSize: 12, color: "#d2ece2" }}>{date}</div>
        </div>

        {todayPunch && (
          <div style={{ background: "var(--canvas-subtle)", padding: 12, borderRadius: 10, marginBottom: 14, fontSize: 11.5 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span>Today&apos;s Clock IN:</span>
              <strong>{todayPunch.timeIn ? new Date(todayPunch.timeIn).toLocaleTimeString("en-PH") : "Not recorded"}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Today&apos;s Clock OUT:</span>
              <strong>{todayPunch.timeOut ? new Date(todayPunch.timeOut).toLocaleTimeString("en-PH") : "In progress"}</strong>
            </div>
          </div>
        )}

        {message && <div className="notice notice-green" style={{ margin: "10px 0" }}><Check size={16} className="i-green" /><span>{message}</span></div>}
        {error && <div className="notice notice-amber" style={{ margin: "10px 0" }}><span>{error}</span></div>}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
          <button
            className="primary-button"
            disabled={busy || Boolean(todayPunch?.timeIn && !todayPunch?.timeOut)}
            onClick={() => handlePunch("clock_in")}
            style={{ height: 42, background: "var(--green)", fontSize: 13 }}
          >
            <LogIn size={16} className="i-slate" /> Clock IN
          </button>
          <button
            className="secondary-button"
            disabled={busy || !todayPunch?.timeIn || Boolean(todayPunch?.timeOut)}
            onClick={() => handlePunch("clock_out")}
            style={{ height: 42, fontSize: 13 }}
          >
            <LogOut size={16} className="i-slate" /> Clock OUT
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, color: "var(--muted)", fontSize: 11 }}>
          <MapPin size={14} className="i-blue" />
          <span>Location stamped with client browser IP & workstation source.</span>
        </div>
      </section>
    </div>
  );
}
