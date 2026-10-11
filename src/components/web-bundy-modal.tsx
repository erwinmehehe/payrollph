"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isWebBundyPunchList, mayClockInWebBundy, visibleWebBundyState, webBundyReadKey, type WebBundyReadState } from "@/lib/web-bundy-display-scope";
import { Check, Clock, Coffee, LogIn, LogOut, MapPin, PlayCircle, X } from "lucide-react";
import { essText, type EssLanguage } from "@/lib/ess-language";
import { philippineClockDate, philippineClockTime } from "@/lib/philippine-clock-display";

type BundyEmployee = {
  id: number;
  employeeNo: string;
  firstName: string;
  lastName: string;
};

type WebBundyProps = {
  organizationId: number;
  employeeId?: number;
  employeeName?: string;
  language?: EssLanguage;
  employees?: BundyEmployee[];
  onClose: () => void;
  onPunchSuccess: () => void;
};

export function WebBundyModal(props: WebBundyProps) {
  // A changed employer or preselected worker gets a fresh modal instance.
  // Old punch state, messages and pending mutation results cannot be reused.
  return <WebBundyView key={`${props.organizationId}:${props.employeeId ?? "team"}`} {...props} />;
}

function WebBundyView({
  organizationId,
  employeeId,
  employeeName,
  language = "en",
  employees = [],
  onClose,
  onPunchSuccess,
}: WebBundyProps) {
  const t = (text: string) => essText(language, text);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(employeeId ?? null);
  const [now, setNow] = useState(() => new Date());
  const time = philippineClockTime(now);
  const date = philippineClockDate(now);
  const [readState, setReadState] = useState<WebBundyReadState | null>(null);
  const mounted = useRef(false);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.id === selectedEmployeeId) ?? null,
    [employees, selectedEmployeeId],
  );
  const displayName = selectedEmployee
    ? `${selectedEmployee.firstName} ${selectedEmployee.lastName}`
    : employeeName ?? t("Select an employee");

  useEffect(() => {
    mounted.current = true;
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => {
      mounted.current = false;
      clearInterval(interval);
    };
  }, []);

  const [nonce, setNonce] = useState(0);
  const reloadPunches = useCallback(() => setNonce((current) => current + 1), []);
  const readKey = webBundyReadKey(organizationId, selectedEmployeeId, nonce);
  const visible = visibleWebBundyState(readKey, readState);
  const historyReady = selectedEmployeeId !== null && visible.status === "ready";

  useEffect(() => {
    if (!selectedEmployeeId) return;
    const controller = new AbortController();
    let alive = true;

    (async () => {
      try {
        const res = await fetch(
          `/api/web-bundy?organizationId=${organizationId}&employeeId=${selectedEmployeeId}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!res.ok) throw Error("Attendance state unavailable.");
        const data: unknown = await res.json();
        if (!alive || controller.signal.aborted) return;
        const list = data && typeof data === "object"
          ? (data as { punches?: unknown }).punches : undefined;
        if (!isWebBundyPunchList(list)) throw Error("Invalid attendance state.");
        setReadState({ key: readKey, status: "ready", punches: list });
      } catch {
        if (alive && !controller.signal.aborted) {
          setReadState({ key: readKey, status: "unavailable", punches: [] });
        }
      }
    })();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [organizationId, selectedEmployeeId, readKey]);

  async function handlePunch(actionType: "clock_in" | "break_start" | "break_end" | "clock_out") {
    if (!selectedEmployeeId || !historyReady) {
      setError(t("Verify this employee's current attendance before recording a punch."));
      return;
    }
    if (submitting.current) return;
    submitting.current = true;
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
      const data = await res.json().catch(() => ({}));
      if (!mounted.current) return;
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : t("Clock punch failed."));
        return;
      }
      const labels = {
        clock_in: "Clock IN recorded.",
        break_start: "Break started.",
        break_end: "Break ended.",
        clock_out: "Clock OUT recorded.",
      } as const;
      setMessage(t(labels[actionType]));
      reloadPunches();
      try {
        onPunchSuccess();
      } catch {
        // The punch was accepted; an optional parent refresh cannot undo it.
      }
    } catch {
      if (mounted.current) setError(t("Unable to confirm punch. Check attendance history before retrying."));
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const todayPunch = visible.punches[0];
  const breakActive = Boolean(todayPunch?.breakStart && !todayPunch?.breakEnd);
  const canClockIn = mayClockInWebBundy(historyReady, todayPunch);
  const canStartBreak = Boolean(historyReady && todayPunch?.timeIn && !todayPunch?.breakStart && !todayPunch?.timeOut);
  const canEndBreak = Boolean(historyReady && breakActive && !todayPunch?.timeOut);
  const canClockOut = Boolean(historyReady && todayPunch?.timeIn && !todayPunch?.timeOut && !breakActive);

  return (
    <div className="modal-backdrop linaw-dialog" role="presentation">
      <section className="modal" role="dialog" aria-modal="true" aria-label="Web Bundy Time Clock">
        <button className="modal-close" type="button" aria-label={t("Close time clock")} onClick={onClose}><X size={18} /></button>
        <div className="modal-icon"><Clock size={22} className="i-cyan" /></div>
        <div className="card-kicker">{t("WEB & TEAM TIME CLOCK")}</div>
        <h2>{language === "fil" ? `${displayName} · ${t("attendance")}` : <>{displayName}&apos;s attendance</>}</h2>
        <p>{t("Role-controlled browser clocking for workstation, tablet or mobile use. Payroll still derives payable time from the stored punch evidence.")}</p>

        {!employeeId && employees.length > 0 && (
          <label style={{ display: "grid", gap: 6, margin: "14px 0" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>{t("Employee")}</span>
            <select
              value={selectedEmployeeId ?? ""}
              disabled={busy}
              onChange={(event) => {
                const next = Number(event.target.value);
                setSelectedEmployeeId(Number.isInteger(next) && next > 0 ? next : null);
                // Re-selecting a worker must not reuse a formerly ready read.
                reloadPunches();
                setMessage("");
                setError("");
              }}
              aria-label={t("Select employee for team time clock")}
            >
              <option value="">{t("Select employee…")}</option>
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
              <span>{t("Clock IN:")}</span>
              <strong>{todayPunch.timeIn ? philippineClockTime(new Date(todayPunch.timeIn)) : t("Not recorded")}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span>{t("Break:")}</span>
              <strong>
                {breakActive
                  ? t("In progress")
                  : todayPunch.breakStart && todayPunch.breakEnd
                    ? `${philippineClockTime(new Date(todayPunch.breakStart))}–${philippineClockTime(new Date(todayPunch.breakEnd))}`
                    : t("Not recorded")}
              </strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{t("Clock OUT:")}</span>
              <strong>{todayPunch.timeOut ? philippineClockTime(new Date(todayPunch.timeOut)) : t("In progress")}</strong>
            </div>
          </div>
        )}

        {selectedEmployeeId && visible.status === "loading" && (
          <p className="auth-copy" role="status">{t("Checking this employee's attendance before enabling time-clock actions…")}</p>
        )}
        {selectedEmployeeId && visible.status === "unavailable" && (
          <div className="notice notice-amber" role="alert">
            <span>{t("Attendance history could not be confirmed. Do not retry a punch until its status is known.")}</span>
            <button type="button" className="secondary-button" onClick={reloadPunches}>{t("Retry attendance check")}</button>
          </div>
        )}
        {message && <div className="notice notice-green" style={{ margin: "10px 0" }}><Check size={16} className="i-green" /><span>{message}</span></div>}
        {error && <div className="notice notice-amber" style={{ margin: "10px 0" }}><span>{error}</span></div>}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
          <button className="primary-button" disabled={busy || !canClockIn} onClick={() => handlePunch("clock_in")} style={{ height: 42, background: "var(--green)", fontSize: 13 }}>
            <LogIn size={16} /> {t("Clock IN")}
          </button>
          <button className="secondary-button" disabled={busy || !canStartBreak} onClick={() => handlePunch("break_start")} style={{ height: 42, fontSize: 13 }}>
            <Coffee size={16} /> {t("Start break")}
          </button>
          <button className="secondary-button" disabled={busy || !canEndBreak} onClick={() => handlePunch("break_end")} style={{ height: 42, fontSize: 13 }}>
            <PlayCircle size={16} /> {t("End break")}
          </button>
          <button className="secondary-button" disabled={busy || !canClockOut} onClick={() => handlePunch("clock_out")} style={{ height: 42, fontSize: 13 }}>
            <LogOut size={16} /> {t("Clock OUT")}
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, color: "var(--muted)", fontSize: 11 }}>
          <MapPin size={14} className="i-blue" />
          <span>{t("Browser IP and attendance source are audit-stamped. Shared team clocking remains role-controlled.")}</span>
        </div>
      </section>
    </div>
  );
}
