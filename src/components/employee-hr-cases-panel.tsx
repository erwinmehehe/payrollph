"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { essText, type EssLanguage } from "@/lib/ess-language";

type HrCaseMessage = { id: number; visibility: "employee"; body: string; createdAt: string };
type HrCaseRow = {
  id: number;
  caseType: string;
  subject: string;
  description: string;
  status: string;
  sla: { hoursRemaining: number; overdue: boolean };
  coeDocumentId: number | null;
  messages: HrCaseMessage[];
};
type HrCasesResponse = { cases?: HrCaseRow[]; error?: string };
const TYPES = [
  ["coe", "Certificate of Employment"],
  ["payslip_correction", "Payslip correction"],
  ["bir_2316", "BIR Form 2316 copy"],
  ["dispute", "Dispute"],
  ["general", "General HR request"],
] as const;

export function EmployeeHrCasesPanel({ language }: { language: EssLanguage }) {
  const t = (text: string) => essText(language, text);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cases, setCases] = useState<HrCaseRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [caseType, setCaseType] = useState<string>("coe");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [reply, setReply] = useState<Record<number, string>>({});

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/hr-cases", { cache: "no-store" });
      if (response.status === 404) { setAvailable(false); setError(""); return; }
      setAvailable(true);
      if (!response.ok) throw new Error("Could not load HR requests.");
      const data = (await response.json()) as HrCasesResponse;
      setCases(Array.isArray(data.cases) ? data.cases : []);
      setError("");
    } catch {
      setError("Could not load HR requests.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function send(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/hr-cases", {
        method: payload.action ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not submit HR request.");
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit HR request.");
      return false;
    } finally { setBusy(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await send({ caseType, subject: subject.trim(), description: description.trim() })) {
      setSubject(""); setDescription("");
    }
  }

  if (loading || !available) return null;

  return (
    <section className="employee-section" aria-label={t("HR requests")} style={{ marginTop: 20 }}>
      <header className="employee-section-heading">
        <div><h2>{t("HR requests")}</h2><p>{t("Ask HR for a document or report a payroll issue.")}</p></div>
      </header>
      {error && <p className="notice notice-amber" role="alert">{t(error)}</p>}
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
        <button type="submit" className="primary-button brand" disabled={busy || subject.trim().length < 4 || description.trim().length < 12}>
          {busy ? t("Submitting…") : t("Submit HR request")}
        </button>
      </form>
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
                <button type="submit" disabled={busy || (reply[item.id]?.trim().length ?? 0) < 2}>{t("Reply")}</button>
              </form>
            )}
          </article>
        ))}
      </div>}
    </section>
  );
}
