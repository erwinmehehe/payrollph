"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Clock, Laptop, LogIn, LogOut, MapPin, ShieldCheck, X } from "lucide-react";

export function WebBundyModal({
  organizationId,
  employeeId,
  employeeName,
  onClose,
  onPunchSuccess,
  offlineSelfService = false,
}: {
  organizationId: number;
  employeeId?: number;
  employeeName?: string;
  onClose: () => void;
  onPunchSuccess: () => void;
  offlineSelfService?: boolean;
}) {
  const [time, setTime] = useState("");
  const [date, setDate] = useState("");
  const [punches, setPunches] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [capturePolicy, setCapturePolicy] = useState<{ mobileClockEnabled: boolean; offlineSyncEnabled: boolean; requireLocation: boolean } | null>(null);
  const [queuedCount, setQueuedCount] = useState(0);

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
  const queueKey = `linaw-offline-attendance:${organizationId}`;

  const refreshQueueCount = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      const value = JSON.parse(window.localStorage.getItem(queueKey) ?? "[]");
      setQueuedCount(Array.isArray(value) ? value.length : 0);
    } catch {
      setQueuedCount(0);
    }
  }, [queueKey]);

  const flushOfflineQueue = useCallback(async () => {
    if (!offlineSelfService || typeof window === "undefined") return true;
    let events: unknown[] = [];
    try {
      const value = JSON.parse(window.localStorage.getItem(queueKey) ?? "[]");
      events = Array.isArray(value) ? value : [];
    } catch {
      events = [];
    }
    if (!events.length) {
      setQueuedCount(0);
      return true;
    }
    try {
      const response = await fetch("/api/workforce/attendance-sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, events }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return false;
      window.localStorage.removeItem(queueKey);
      setQueuedCount(0);
      setMessage(`Offline attendance synchronized: ${body.applied ?? 0} applied, ${body.duplicate ?? 0} duplicate, ${body.rejected ?? 0} rejected.`);
      reloadPunches();
      onPunchSuccess();
      return true;
    } catch {
      return false;
    }
  }, [offlineSelfService, onPunchSuccess, organizationId, queueKey, reloadPunches]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch(`/api/workforce/attendance-capture?organizationId=${organizationId}`, { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (alive && response.ok) setCapturePolicy(body.policy ?? null);
      } catch {
        // Online capture still works when policy discovery is temporarily unavailable.
      }
      if (alive) refreshQueueCount();
    })();
    const sync = () => { void flushOfflineQueue(); };
    window.addEventListener("online", sync);
    return () => {
      alive = false;
      window.removeEventListener("online", sync);
    };
  }, [flushOfflineQueue, organizationId, refreshQueueCount]);

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

  async function locationEvidence() {
    if (!capturePolicy?.requireLocation) return "Web Bundy (Browser)";
    if (!navigator.geolocation) throw new Error("Location access is required for attendance capture.");
    return new Promise<string>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => resolve(`GPS ${position.coords.latitude.toFixed(6)},${position.coords.longitude.toFixed(6)} ±${Math.round(position.coords.accuracy)}m`),
        () => reject(new Error("Location access is required by your organization's attendance policy.")),
        { enableHighAccuracy: true, maximumAge: 60_000, timeout: 10_000 },
      );
    });
  }

  async function handlePunch(actionType: "clock_in" | "clock_out") {
    setBusy(true);
    setMessage("");
    setError("");
    let location = "Web Bundy (Browser)";
    try {
      location = await locationEvidence();
    } catch (locationError) {
      setError(locationError instanceof Error ? locationError.message : "Location evidence is required.");
      setBusy(false);
      return;
    }

    if (queuedCount > 0 && navigator.onLine) {
      const flushed = await flushOfflineQueue();
      if (!flushed) {
        setError("Queued offline punches could not be synchronized. New punches are paused to preserve event order.");
        setBusy(false);
        return;
      }
    }

    try {
      const res = await fetch("/api/web-bundy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          employeeId,
          actionType,
          location,
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
      if (offlineSelfService && capturePolicy?.mobileClockEnabled && capturePolicy.offlineSyncEnabled) {
        const current = (() => {
          try {
            const value = JSON.parse(window.localStorage.getItem(queueKey) ?? "[]");
            return Array.isArray(value) ? value : [];
          } catch {
            return [];
          }
        })();
        current.push({
          clientEventId: crypto.randomUUID(),
          actionType,
          occurredAt: new Date().toISOString(),
          location,
        });
        window.localStorage.setItem(queueKey, JSON.stringify(current));
        setQueuedCount(current.length);
        setMessage("Network unavailable. Punch saved on this device and queued for secure synchronization.");
      } else {
        setError("Network error recording punch. Offline synchronization is not enabled for this account.");
      }
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

        {queuedCount > 0 && <div className="notice notice-amber" style={{ margin: "10px 0" }}><ShieldCheck size={16} /><span>{queuedCount} offline punch event(s) are waiting to synchronize.</span></div>}
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
