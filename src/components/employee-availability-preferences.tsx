"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, RefreshCcw } from "lucide-react";
import { manilaWorkDate } from "@/lib/workforce-employee-upcoming-week";
import { essText, type EssLanguage } from "@/lib/ess-language";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
type PreferenceRow = {
  id: number;
  weekday: number;
  startTime: string;
  endTime: string;
  availabilityType: "preferred" | "unavailable" | "unknown";
  effectiveFrom: string;
  effectiveUntil: string | null;
  notes: string | null;
};
type SourceView = {
  rules: PreferenceRow[];
  partial: boolean;
  source: string;
};

export function EmployeeAvailabilityPreferences({ language = "en" }: { language?: EssLanguage }) {
  const t = (word: string) => essText(language, word);
  const [source, setSource] = useState<SourceView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [weekday, setWeekday] = useState("1");
  const [availabilityType, setAvailabilityType] = useState<"preferred" | "unavailable">("preferred");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("17:00");
  const [effectiveFrom, setEffectiveFrom] = useState(() => manilaWorkDate());
  const [effectiveUntil, setEffectiveUntil] = useState("");
  const [notes, setNotes] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const response = await fetch("/api/self/availability", {
        cache: "no-store", signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = body && typeof body === "object" && "error" in body &&
          typeof body.error === "string" ? body.error : "Availability source unavailable.";
        throw new Error(detail);
      }
      if (!body || typeof body !== "object" || !("rules" in body) ||
          !Array.isArray(body.rules) || !("partial" in body) ||
          typeof body.partial !== "boolean" || !("source" in body) ||
          body.source !== "employee_availability_rules" || body.rules.length > 60 ||
          body.rules.some(item => !item || typeof item !== "object" ||
            !Number.isSafeInteger(item.id) || item.id <= 0)) {
        throw new Error("Availability source did not return a valid scoped view.");
      }
      if (controller.signal.aborted) return false;
      setSource(body as SourceView);
      setError("");
      return true;
    } catch (cause) {
      if (controller.signal.aborted) return false;
      // A failed or unauthorized read must not leave an old account's rules.
      setSource(null);
      setError(cause instanceof Error ? cause.message : "Availability source unavailable.");
      return false;
    } finally {
      if (controllerRef.current === controller && !controller.signal.aborted) {
        setLoading(false);
        controllerRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    // No synchronous state transitions from the mount effect.
    void load();
    return () => controllerRef.current?.abort();
  }, [load]);

  const refresh = () => {
    setLoading(true);
    setSource(null);
    setMessage("");
    void load();
  };

  async function sendAction(payload: Record<string, unknown>) {
    const response = await fetch("/api/self/availability", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = body && typeof body === "object" && "error" in body &&
        typeof body.error === "string" ? body.error : "The preference could not be updated.";
      throw new Error(error);
    }
    return body;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || removingId !== null) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await sendAction({
        action: "create",
        weekday: Number(weekday), startTime, endTime,
        availabilityType, effectiveFrom, effectiveUntil: effectiveUntil || null,
        notes: notes.trim() || null,
      });
      setNotes("");
      const verified = await load();
      setMessage(verified
        ? "Preference recorded. Your published shifts, approved leave and payroll have not changed."
        : "Preference submitted, but the saved source could not be refreshed. Refresh before submitting another.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the preference.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: PreferenceRow) {
    if (saving || removingId !== null) return;
    setRemovingId(row.id);
    setError("");
    setMessage("");
    try {
      await sendAction({ action: "remove", ruleId: row.id });
      const verified = await load();
      setMessage(verified
        ? "Preference withdrawn. Past history is preserved; existing published shifts remain unchanged."
        : "Withdrawal submitted, but the source could not be refreshed. Refresh before changing another preference.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not withdraw the preference.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <article className="employee-list-card" data-employee-availability-preferences aria-busy={loading}>
      <div className="employee-list-card-head">
        <div>
          <span className="card-kicker">{t("SHIFT PREFERENCES · PHILIPPINE TIME")}</span>
          <h3>{t("My availability and preferred shifts")}</h3>
        </div>
        <button type="button" className="secondary-button" disabled={loading || saving || removingId !== null}
          onClick={refresh}><RefreshCcw size={13} aria-hidden="true" /> {t("Refresh")}</button>
      </div>
      <div className="notice notice-slate" style={{ margin: "0 14px 14px" }}>
        {t("Tell your scheduling manager when you prefer to work or cannot take a shift. This is a recurring preference, not time off, an approved schedule, or a payroll change. Overnight windows should be entered as two separate days. Do not include medical or sensitive details.")}
      </div>
      {error && <p className="notice notice-amber" role="alert">{t(error)}</p>}
      {message && <p className="notice notice-slate" role="status">{t(message)}</p>}
      <form onSubmit={event => void submit(event)} style={{ padding: "0 14px 14px" }}>
        <div className="employee-form-two">
          <label>{t("Day of week")}
            <select value={weekday} onChange={event => setWeekday(event.target.value)}>
              {WEEKDAYS.map((day, index) => <option key={day} value={index}>{t(day)}</option>)}
            </select>
          </label>
          <label>{t("Preference")}
            <select value={availabilityType} onChange={event => setAvailabilityType(event.target.value === "unavailable" ? "unavailable" : "preferred")}>
              <option value="preferred">{t("Preferred shift")}</option>
              <option value="unavailable">{t("Unavailable")}</option>
            </select>
          </label>
          <label>{t("Start time")}
            <input type="time" value={startTime} required onChange={event => setStartTime(event.target.value)} />
          </label>
          <label>{t("End time")}
            <input type="time" value={endTime} required onChange={event => setEndTime(event.target.value)} />
          </label>
          <label>{t("Effective from")}
            <input type="date" value={effectiveFrom} min={manilaWorkDate()} required onChange={event => setEffectiveFrom(event.target.value)} />
          </label>
          <label>{t("Effective until (optional)")}
            <input type="date" value={effectiveUntil} min={effectiveFrom} onChange={event => setEffectiveUntil(event.target.value)} />
          </label>
        </div>
        <label>{t("Optional scheduling note (240 characters max)")}
          <textarea value={notes} maxLength={240} rows={2} onChange={event => setNotes(event.target.value)}
            placeholder={t("Shift preference context only; avoid personal or medical information.")} />
        </label>
        <div className="employee-modal-actions">
          <button className="primary-button brand" disabled={saving || removingId !== null || loading || !source}>
            <CalendarDays size={14} aria-hidden="true" /> {saving ? t("Saving…") : t("Save preference")}
          </button>
        </div>
      </form>
      <div className="employee-list-card-head">
        <div><span className="card-kicker">{t("SAVED PREFERENCES")}</span>
          <h3>{t("My recorded weekly rules")}</h3></div>
        <span className="employee-mini-meta">{source ? source.rules.length : "—"}</span>
      </div>
      {loading && <div role="status" className="employee-empty-row">{t("Loading your saved preferences…")}</div>}
      {!loading && !source && <div className="employee-empty-row">
        {t("Preferences could not be verified. Refresh your records before editing.")}
      </div>}
      {!loading && source && source.rules.length === 0 &&
        <div className="employee-empty-row">{t("No current or upcoming preferences recorded. This does not mean you are available every day.")}</div>}
      {!loading && source && source.partial &&
        <div className="notice notice-amber">{t("Only the first 60 recorded preferences are shown. Other source records exist; contact your scheduling manager before assuming this history is complete.")}</div>}
      {!loading && source && source.rules.map(row => (
        <div className="employee-attendance-row" key={row.id}>
          <div>
            <strong>{t(WEEKDAYS[row.weekday] ?? "Unknown day")} · {row.startTime}–{row.endTime}</strong>
            <span>{t(row.availabilityType === "preferred" ? "Preferred shift" :
              row.availabilityType === "unavailable" ? "Unavailable" : "Unknown historical rule")}</span>
            <small>{row.effectiveFrom} {row.effectiveUntil ? "– " + row.effectiveUntil : "onward"}</small>
            {row.notes && <small>{row.notes}</small>}
          </div>
          <button type="button" className="secondary-button"
            onClick={() => void remove(row)} disabled={saving || removingId !== null}
            aria-label={t("Withdraw availability rule") + " " + row.id}>
            {removingId === row.id ? t("Withdrawing…") : t("Withdraw")}
          </button>
        </div>
      ))}
    </article>
  );
}
