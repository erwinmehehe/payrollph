"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { essText, type EssLanguage } from "@/lib/ess-language";
import { readEmployeeHrCases, type EmployeeHrCaseRow } from "@/lib/employee-hr-cases-read";

const TYPES = [
  ["coe", "Certificate of Employment"],
  ["payslip_correction", "Payslip correction"],
  ["bir_2316", "BIR Form 2316 copy"],
  ["dispute", "Dispute"],
  ["general", "General HR request"],
] as const;

export function EmployeeHrCasesPanel({ language, enabled = false }: { language: EssLanguage; enabled?: boolean }) {
  if (enabled !== true) return null;
  return <EnabledEmployeeHrCasesPanel language={language} />;
}

function EnabledEmployeeHrCasesPanel({ language }: { language: EssLanguage }) {
  const t = (text: string) => essText(language, text);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cases, setCases] = useState<EmployeeHrCaseRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [caseType, setCaseType] = useState<string>("coe");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [reply, setReply] = useState<Record<number, string>>({});
  const controllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async (): Promise<boolean> => {
    // Invalidate the old snapshot immediately, including pending replies.
    // An older response may not restore another account's HR case list.
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setCases(null);
    setError("");
    try {
      const result = await readEmployeeHrCases(fetch, controller.signal);
      if (controller.signal.aborted) return false;
      setAvailable(result.status === "ready");
      if (result.status !== "ready") return false; // Explicit default-OFF only.
      setCases(result.cases);
      return true;
    } catch (cause) {
      if (controller.signal.aborted) return false;
      setAvailable(true); // Auth/server/network errors must remain visible for retry.
      setError(cause instanceof Error ? cause.message : "Could not verify HR requests.");
      return false;
    } finally {
      if (controllerRef.current === controller && !controller.signal.aborted) {
        setLoading(false);
        controllerRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    // Defer the initial fetch until after the effect commits.
    const handle = window.setTimeout(() => { void refresh(); }, 0);
    return () => {
      window.clearTimeout(handle);
      controllerRef.current?.abort();
    };
  }, [refresh]);

  const canAct = cases !== null && !loading && !error && !busy;

  async function send(payload: Record<string, unknown>) {
    if (!canAct) return false;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/hr-cases", {
        method: payload.action ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        const reason = result && typeof result === "object" && "error" in result &&
          typeof result.error === "string" ? result.error : "Could not submit HR request.";
        throw new Error(reason);
      }
      const verified = await refresh();
      if (!verified) {
        // The write was acknowledged; do not encourage a duplicate submission.
        setError("Your request was accepted, but the updated list could not be verified. Retry the read; do not submit the request again.");
      }
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not submit HR request.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await send({ caseType, subject: subject.trim(), description: description.trim() })) {
      setSubject("");
      setDescription("");
    }
  }

  if (loading && !available) return <p role="status">{t("Loading HR requests…")}</p>;
  if (!available) return null;

  return (
    <section className="employee-section" aria-label={t("HR requests")} aria-busy={loading || busy} style={{ marginTop: 20 }}>
      <header className="employee-section-heading">
        <div><h2>{t("HR requests")}</h2><p>{t("Ask HR for a document or report a payroll issue.")}</p></div>
        {cases !== null && !loading && !error && (
          <button type="button" className="secondary-button" disabled={busy}
            onClick={() => { void refresh(); }}>{t("Refresh HR requests")}</button>
        )}
      </header>

      {loading && <p role="status" aria-live="polite">{t("Verifying your HR requests…")}</p>}
      {error && <div className="notice notice-amber" role="alert">
        <p>{t(error)} {t("Your HR requests and actions are unavailable until the source is verified.")}</p>
        <button type="button" className="secondary-button" disabled={loading || busy}
          onClick={() => { void refresh(); }}>{t("Retry HR requests")}</button>
      </div>}

      {cases !== null && !loading && !error && (
        <>
          <form onSubmit={event => void submit(event)} style={{ display: "grid", gap: 12 }}>
            <label>{t("Request type")}
              <select value={caseType} onChange={event => setCaseType(event.target.value)}>
                {TYPES.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
              </select>
            </label>
            <label>{t("Subject")}
              <input value={subject} onChange={event => setSubject(event.target.value)}
                maxLength={160} minLength={4} required />
            </label>
            <label>{t("Describe your request")}
              <textarea value={description} onChange={event => setDescription(event.target.value)}
                maxLength={3000} minLength={12} rows={3} required />
            </label>
            <button type="submit" className="primary-button brand"
              disabled={!canAct || subject.trim().length < 4 || description.trim().length < 12}>
              {busy ? t("Submitting…") : t("Submit HR request")}
            </button>
          </form>

          {cases.length === 0 && (
            <p className="employee-empty-row" role="status">
              {t("No HR requests are recorded in this verified view.")}
            </p>
          )}
          {cases.length > 0 && <div style={{ marginTop: 20, display: "grid", gap: 16 }}>
            <h3>{t("My requests")}</h3>
            {cases.map(item => (
              <article key={item.id} className="employee-link-card" style={{ display: "grid", gap: 8 }}>
                <strong>{item.subject}</strong>
                <span>{t("Status")}: {item.status} · {item.sla.overdue ? t("Overdue") : t("SLA hours remaining") + ": " + item.sla.hoursRemaining}</span>
                <p>{item.description}</p>
                {item.coeDocumentId != null && <a href={"/api/documents/" + item.coeDocumentId} target="_blank" rel="noopener noreferrer">
                  {t("Download approved COE")}
                </a>}
                {item.messages.slice(1).map(message => (
                  <p key={message.id}><small>{new Date(message.createdAt).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })}</small> — {message.body}</p>
                ))}
                {item.status !== "closed" && (
                  <form onSubmit={async event => {
                    event.preventDefault();
                    if (await send({ action: "reply", id: item.id, message: reply[item.id]?.trim() })) {
                      setReply(previous => ({ ...previous, [item.id]: "" }));
                    }
                  }} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <input aria-label={t("Reply to HR")} value={reply[item.id] ?? ""}
                      maxLength={3000} minLength={2} required
                      onChange={event => setReply(previous => ({ ...previous, [item.id]: event.target.value }))} />
                    <button type="submit" disabled={!canAct || (reply[item.id]?.trim().length ?? 0) < 2}>
                      {t("Reply")}
                    </button>
                  </form>
                )}
              </article>
            ))}
          </div>}
        </>
      )}
    </section>
  );
}
