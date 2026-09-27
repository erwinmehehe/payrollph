"use client";

import { useState } from "react";
import { AlertTriangle, CalendarDays, Check, Inbox } from "lucide-react";
import { Spinner } from "@/components/workspace/ui";

type Result = { message: string; queued: boolean; delivered: boolean; provider: string };

/**
 * Book-a-demo intake.
 *
 * The success state reports exactly what happened: with no mail provider
 * configured the request is *queued in the outbox*, and we say that rather than
 * claiming a message was sent.
 */
export function BookDemoForm() {
  const [form, setForm] = useState({ name: "", email: "", company: "", headcount: "", notes: "" });
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setProblems([]);
    setError("");
    try {
      const response = await fetch("/api/demo-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 422) {
        setProblems(payload.problems ?? ["Please check the form."]);
        return;
      }
      if (!response.ok) {
        setError(payload.error ?? `The request could not be recorded (${response.status}).`);
        return;
      }
      setResult(payload as Result);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (result) {
    return (
      <div className="card" style={{ padding: 28 }}>
        <span className="modal-icon" aria-hidden>
          {result.delivered ? <Check size={18} /> : <Inbox size={18} />}
        </span>
        <h2 style={{ margin: 0, fontSize: 21, fontWeight: 750, letterSpacing: "-0.03em" }}>
          {result.delivered ? "Request sent." : "Request recorded."}
        </h2>
        <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 13.5, lineHeight: 1.65 }}>{result.message}</p>

        {!result.delivered && (
          <div className="notice notice-amber">
            <AlertTriangle size={15} />
            <span>
              Being straight with you: this deployment has no email provider configured, so your request is sitting in the
              outbox rather than in anyone&apos;s inbox. If you need a reply today, try the live demo or sign in, both work
              right now.
            </span>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
          <a className="primary-button" href="/welcome#preview">
            Play with the workspace preview
          </a>
          <a className="secondary-button" href="/signup">
            Create an account
          </a>
        </div>
      </div>
    );
  }

  return (
    <form className="card" style={{ padding: 28 }} onSubmit={submit} noValidate>
      <span className="modal-icon" aria-hidden>
        <CalendarDays size={18} />
      </span>
      <h2 style={{ margin: 0, fontSize: 21, fontWeight: 750, letterSpacing: "-0.03em" }}>Tell us about your payroll</h2>
      <p style={{ margin: "8px 0 20px", color: "var(--muted)", fontSize: 13.5, lineHeight: 1.65 }}>
        A short form so the walkthrough is about your setup, how many people, how many entities, and what you are moving
        from.
      </p>

      {problems.length > 0 && (
        <div className="notice notice-red" role="alert">
          <AlertTriangle size={15} />
          <div>
            <strong>Please fix the following:</strong>
            <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {error && (
        <div className="notice notice-red" role="alert">
          <AlertTriangle size={15} />
          <span>{error}</span>
        </div>
      )}

      <div style={{ display: "grid", gap: 14 }}>
        <div className="field-row">
          <label className="field">
            <span>Your name</span>
            <input value={form.name} onChange={set("name")} autoComplete="name" required />
          </label>
          <label className="field">
            <span>Work email</span>
            <input type="email" value={form.email} onChange={set("email")} autoComplete="email" required />
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span>Company or practice</span>
            <input value={form.company} onChange={set("company")} autoComplete="organization" required />
          </label>
          <label className="field">
            <span>People on payroll</span>
            <select value={form.headcount} onChange={set("headcount")}>
              <option value="">Select…</option>
              <option value="1">Just me</option>
              <option value="2-10">2–10</option>
              <option value="11-50">11–50</option>
              <option value="51-200">51–200</option>
              <option value="200+">200+</option>
              <option value="multi-client">Multiple client companies</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span>What would you like to see?</span>
          <textarea
            value={form.notes}
            onChange={set("notes")}
            placeholder="e.g. semi-monthly runs across two branches, BIR worksheets, and how approvals work when our approver is on leave"
          />
          <small>Optional.</small>
        </label>
      </div>

      <div className="modal-actions">
        <a className="secondary-button" href="/welcome">
          Back to the site
        </a>
        <button className="primary-button brand" type="submit" disabled={saving}>
          {saving ? <Spinner label="Submitting" /> : <CalendarDays size={14} />} Request a demo
        </button>
      </div>
    </form>
  );
}
