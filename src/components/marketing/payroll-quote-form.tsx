"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Inbox, Send } from "lucide-react";
import { Spinner } from "@/components/workspace/ui";

type Result = { message: string; queued: boolean; delivered: boolean; provider: string };

export function PayrollQuoteForm() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    company: "",
    headcount: "",
    frequency: "",
    entities: "",
    notes: "",
  });
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const set =
    (key: keyof typeof form) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setProblems([]);
    setError("");

    try {
      const response = await fetch("/api/payroll-outsourcing/quote", {
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
      <div className="quote-card">
        <span className="modal-icon" aria-hidden>
          {result.delivered ? <Check size={18} className="i-green" /> : <Inbox size={18} className="i-amber" />}
        </span>
        <p className="eyebrow">Payroll outsourcing enquiry</p>
        <h2>{result.delivered ? "Your request was sent." : "Your request was recorded."}</h2>
        <p>{result.message}</p>

        {!result.delivered && (
          <div className="notice notice-amber">
            <AlertTriangle size={15} className="i-amber" />
            <span>
              This deployment does not currently have an email provider configured. Your enquiry is stored in the outbox,
              but it has not been emailed to an operator yet.
            </span>
          </div>
        )}

        <div className="quote-actions">
          <Link className="secondary-button" href="/payroll-outsourcing">Back to payroll outsourcing</Link>
          <Link className="primary-button" href="/">See payroll software</Link>
        </div>
      </div>
    );
  }

  return (
    <form className="quote-card" onSubmit={submit} noValidate>
      <p className="eyebrow">Get a payroll quote</p>
      <h2>Tell us what your payroll cycle looks like.</h2>
      <p>
        Give us the basics. The request records your company, headcount, payroll frequency and the work you want handled.
      </p>

      {problems.length > 0 && (
        <div className="notice notice-red" role="alert">
          <AlertTriangle size={15} className="i-red" />
          <div>
            <strong>Please fix the following:</strong>
            <ul>
              {problems.map((problem) => <li key={problem}>{problem}</li>)}
            </ul>
          </div>
        </div>
      )}

      {error && (
        <div className="notice notice-red" role="alert">
          <AlertTriangle size={15} className="i-red" />
          <span>{error}</span>
        </div>
      )}

      <div className="quote-fields">
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
            <span>Company</span>
            <input value={form.company} onChange={set("company")} autoComplete="organization" required />
          </label>
          <label className="field">
            <span>People on payroll</span>
            <select value={form.headcount} onChange={set("headcount")} required>
              <option value="">Select…</option>
              <option value="1-10">1 to 10</option>
              <option value="11-50">11 to 50</option>
              <option value="51-200">51 to 200</option>
              <option value="201-500">201 to 500</option>
              <option value="500+">More than 500</option>
            </select>
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span>Payroll frequency</span>
            <select value={form.frequency} onChange={set("frequency")}>
              <option value="">Select…</option>
              <option value="semi-monthly">Semi-monthly</option>
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="field">
            <span>Entities or companies</span>
            <select value={form.entities} onChange={set("entities")}>
              <option value="">Select…</option>
              <option value="1">1</option>
              <option value="2-5">2 to 5</option>
              <option value="6+">6 or more</option>
            </select>
          </label>
        </div>

        <label className="field">
          <span>What do you want the payroll team to handle?</span>
          <textarea
            value={form.notes}
            onChange={set("notes")}
            placeholder="Example: process semi-monthly payroll, validate attendance exceptions, prepare statutory figures and payroll reports, then send the run back to us for approval."
          />
          <small>Optional. Do not include passwords, bank credentials or employee personal data.</small>
        </label>
      </div>

      <button className="primary-button brand quote-submit" type="submit" disabled={saving}>
        {saving ? <Spinner label="Submitting" /> : <Send size={14} className="i-blue" />}
        {saving ? "Recording request…" : "Get a payroll quote"}
      </button>
    </form>
  );
}
