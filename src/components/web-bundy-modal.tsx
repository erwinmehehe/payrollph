"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EnhancedPunchControls } from "@/components/enhanced-punch-controls";
import { isWebBundyPunchList, mayClockInWebBundy, visibleWebBundyState, webBundyReadKey, type WebBundyReadState } from "@/lib/web-bundy-display-scope";
import { Check, Clock, Coffee, LogIn, LogOut, MapPin, PlayCircle, X } from "lucide-react";
import { essText, type EssLanguage } from "@/lib/ess-language";
import { philippineClockDate, philippineClockTime } from "@/lib/philippine-clock-display";
import { useWorkflowUi } from "@/components/workspace/workflow-ui-context";
import { FaceOfflinePunchPanel } from "@/components/workspace/face-offline-punch";

type ClockPolicy = { key: string; required: boolean; canClockWithLocation: boolean; error?: string };
type OneTimePosition = { latitude: number; longitude: number; accuracyMeters: number; capturedAt: string };
/** A single, deliberate clock action gets a fresh GPS fix; no background polling. */
function requestOneTimePosition(): Promise<OneTimePosition> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.reject(new Error("This device cannot provide GPS location. Ask HR for a reviewed attendance exception."));
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
        capturedAt: new Date(position.timestamp).toISOString(),
      }),
      () => reject(new Error("Location permission failed or timed out. Enable GPS on HTTPS, or ask HR for a manual attendance review.")),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  });
}

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
  const faceOfflineEnabled = useWorkflowUi().faceOfflinePunch;
  const t = (text: string) => essText(language, text);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(employeeId ?? null);
  const [now, setNow] = useState(() => new Date());
  const time = philippineClockTime(now);
  const date = philippineClockDate(now);
  const [readState, setReadState] = useState<WebBundyReadState | null>(null);
  const [clockPolicy, setClockPolicy] = useState<ClockPolicy | null>(null);
  const mounted = useRef(false);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [enhancedRead, setEnhancedRead] = useState<{ key: string; enabled: boolean; employeeCanSubmit: boolean } | null>(null);

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
  const validEmployer = Number.isSafeInteger(organizationId) && organizationId > 0;
  const readKey = validEmployer
    ? webBundyReadKey(organizationId, selectedEmployeeId, nonce)
    : "employer-not-linked";
  const enhancedEnabled = enhancedRead?.key === readKey && enhancedRead.enabled === true;
  const enhancedEmployeeCanSubmit = enhancedEnabled && enhancedRead?.employeeCanSubmit === true;
  const visible = validEmployer
    ? visibleWebBundyState(readKey, readState)
    : { status: "unavailable" as const, punches: [] };
  const previousNeedsReview = readState?.key === readKey && readState.previousShiftNeedsReview === true;
  const historyReady = validEmployer && selectedEmployeeId !== null
    && visible.status === "ready" && !previousNeedsReview;
  // Never reuse location policy for another employer, worker, or refresh generation.
  const policy = clockPolicy?.key === readKey ? clockPolicy : null;
  const policyReady = Boolean(policy && !policy.error && (!policy.required || policy.canClockWithLocation));

  useEffect(() => {
    if (!selectedEmployeeId || !validEmployer) return;
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
        const response = data && typeof data === "object"
          ? data as { punches?: unknown; geofence?: unknown; previousShiftNeedsReview?: unknown; enhancedPunch?: { enabled?: unknown; employeeCanSubmit?: unknown } } : {};
        if (!isWebBundyPunchList(response.punches)) throw Error("Invalid attendance state.");
        const geo = response.geofence;
        if (!geo || typeof geo !== "object"
          || typeof (geo as { required?: unknown }).required !== "boolean"
          || typeof (geo as { canClockWithLocation?: unknown }).canClockWithLocation !== "boolean") {
          throw Error("Time-clock location policy could not be verified.");
        }
        const verified = geo as { required: boolean; canClockWithLocation: boolean };
        setEnhancedRead({ key: readKey, enabled: response.enhancedPunch?.enabled === true, employeeCanSubmit: response.enhancedPunch?.employeeCanSubmit === true });
        setClockPolicy({ key: readKey, required: verified.required, canClockWithLocation: verified.canClockWithLocation });
        setReadState({
          key: readKey, status: "ready", punches: response.punches,
          previousShiftNeedsReview: response.previousShiftNeedsReview === true,
        });
      } catch {
        if (alive && !controller.signal.aborted) {
          setClockPolicy({ key: readKey, required: false, canClockWithLocation: false, error: "Time-clock policy unavailable. Retry attendance check." });
          setReadState({ key: readKey, status: "unavailable", punches: [] });
        }
      }
    })();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [organizationId, selectedEmployeeId, readKey, validEmployer]);

  async function handlePunch(actionType: "clock_in" | "break_start" | "break_end" | "clock_out") {
    if (!selectedEmployeeId || !historyReady || !policyReady || !policy) {
      setError(t("Verify this employee's current attendance and time-clock policy before recording a punch."));
      return;
    }
    if (enhancedEnabled) {
      setError("Use the review-first punch controls below. Legacy direct punches are disabled.");
      return;
    }
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      let geolocation: OneTimePosition | undefined;
      if (policy.required && (actionType === "clock_in" || actionType === "clock_out")) {
        try {
          geolocation = await requestOneTimePosition();
        } catch (cause) {
          if (mounted.current) setError(cause instanceof Error ? cause.message : "GPS location unavailable. Ask HR for a reviewed attendance exception.");
          return;
        }
      }
      // The worker may close the modal while the browser is waiting for a
      // foreground GPS permission decision. Never clock after unmount.
      if (!mounted.current) return;
      const res = await fetch("/api/web-bundy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          employeeId: selectedEmployeeId,
          actionType,
          location: "Web Bundy (Workstation / Mobile Browser)",
          ...(geolocation ? { geolocation } : {}),
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
  const todayWorkDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const fromPreviousWorkDate = Boolean(todayPunch?.workDate && todayPunch.workDate !== todayWorkDate);
  const breakActive = Boolean(todayPunch?.breakStart && !todayPunch?.breakEnd);
  const canClockIn = mayClockInWebBundy(historyReady, todayPunch);
  const canStartBreak = Boolean(historyReady && todayPunch?.timeIn && !todayPunch?.breakStart && !todayPunch?.timeOut);
  const canEndBreak = Boolean(historyReady && breakActive && !todayPunch?.timeOut);
  const canClockOut = Boolean(historyReady && todayPunch?.timeIn && !todayPunch?.timeOut && !breakActive);

  return (
    <div className="modal-backdrop linaw-dialog" role="presentation"
      style={faceOfflineEnabled ? { padding: 12 } : undefined}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="Web Bundy Time Clock"
        style={faceOfflineEnabled ? {
          width:"min(560px, calc(100vw - 24px))", maxWidth:"100%", minWidth:0,
          boxSizing:"border-box", maxHeight:"90vh", overflowY:"auto",
        } : undefined}>
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

        {selectedEmployeeId && fromPreviousWorkDate && (
          <p role="status" className="auth-copy">
            Continuing a shift started on {todayPunch?.workDate} (Asia/Manila). Clock-out stays on that original work date.
          </p>
        )}
        {selectedEmployeeId && previousNeedsReview && (
          <div className="notice notice-amber" role="status">
            A previous shift needs an HR attendance correction. It has not been automatically closed or counted as absence.
          </div>
        )}
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
            <span>{validEmployer
              ? t("Attendance history could not be confirmed. Do not retry a punch until its status is known.")
              : t("Employer identity is not linked. Attendance cannot be recorded.")}</span>
            {validEmployer && <button type="button" className="secondary-button" onClick={reloadPunches}>{t("Retry attendance check")}</button>}
          </div>
        )}
        {message && <div className="notice notice-green" style={{ margin: "10px 0" }}><Check size={16} className="i-green" /><span>{message}</span></div>}
        {error && <div className="notice notice-amber" style={{ margin: "10px 0" }}><span>{error}</span></div>}
        {policy?.error && <div className="notice notice-amber" role="alert">{policy.error}</div>}
        {policy?.required && (
          <div className="notice notice-blue" style={{ margin: "12px 0" }}>
            <MapPin size={15} />
            <span>
              One-time GPS verification is required for clock IN and OUT at an approved worksite.
              GPS is requested only after you press a clock button. Exact employee coordinates are not saved.
              {!policy.canClockWithLocation && " Team administrators cannot clock for someone else in this pilot; employees must use their own account."}
            </span>
          </div>
        )}

        {enhancedEnabled && !enhancedEmployeeCanSubmit &&
          <p role="status" style={{ marginTop: 16, color: "var(--muted)" }}>
            Direct attendance punches are disabled for this pilot employer. People administrators must use the authorized HR correction workflow; employee punches require an independent reviewer.
          </p>}
        {enhancedEmployeeCanSubmit && selectedEmployeeId !== null &&
          <EnhancedPunchControls key={`${organizationId}:${selectedEmployeeId}`} organizationId={organizationId} employeeId={selectedEmployeeId} />}
        {!enhancedEnabled && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
          <button className="primary-button" disabled={busy || !policyReady || !canClockIn} onClick={() => handlePunch("clock_in")} style={{ height: 42, background: "var(--green)", fontSize: 13 }}>
            <LogIn size={16} /> {t("Clock IN")}
          </button>
          <button className="secondary-button" disabled={busy || !policyReady || !canStartBreak} onClick={() => handlePunch("break_start")} style={{ height: 42, fontSize: 13 }}>
            <Coffee size={16} /> {t("Start break")}
          </button>
          <button className="secondary-button" disabled={busy || !policyReady || !canEndBreak} onClick={() => handlePunch("break_end")} style={{ height: 42, fontSize: 13 }}>
            <PlayCircle size={16} /> {t("End break")}
          </button>
          <button className="secondary-button" disabled={busy || !policyReady || !canClockOut} onClick={() => handlePunch("clock_out")} style={{ height: 42, fontSize: 13 }}>
            <LogOut size={16} /> {t("Clock OUT")}
          </button>
        </div>}

        {faceOfflineEnabled && !!employeeId && <FaceOfflinePunchPanel
          organizationId={organizationId} employeeId={employeeId} />}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, color: "var(--muted)", fontSize: 11 }}> 
          <MapPin size={14} className="i-blue" />
          <span>{t("Browser IP and attendance source are audit-stamped. Geofenced self-clock stores only coarse verification evidence, not raw employee GPS coordinates.")}</span>
        </div>
      </section>
    </div>
  );
}
