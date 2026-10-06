"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, LoaderCircle, Send } from "lucide-react";

type Result = { leadId: number; recorded: boolean };

const inputClass =
  "mt-2 w-full rounded-xl border border-[#D9DCEC] bg-white px-3.5 py-3 text-[14px] text-[#11141F] outline-none transition focus:border-[#6161FF] focus:ring-4 focus:ring-[#6161FF]/10";

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
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event: FormEvent) {
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
      <div className="rounded-[26px] border border-[#E2E4F0] bg-white p-6 shadow-[0_22px_60px_-38px_rgba(30,34,70,.38)] sm:p-7">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#E3FAF0] text-[#0A8A53]">
          <Check size={19} />
        </span>
        <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">Payroll outsourcing enquiry</p>
        <h2 className="font-display mt-2 text-[28px] font-semibold tracking-[-0.035em] text-[#0B0D1A]">
          We recorded your payroll enquiry.
        </h2>
                <p className="mt-3 text-[14px] leading-relaxed text-[#5B6080]">Your operating details are saved so the payroll team can scope the cycle without asking for employee personal data or banking credentials.</p>

        <div className="mt-6 flex flex-wrap gap-2.5">
          <Link href="/payroll-outsourcing" className="rounded-full border border-[#D9DCEC] px-5 py-3 text-[13.5px] font-semibold text-[#2B2F45]">
            Back to outsourcing
          </Link>
          <Link href="/demo" className="inline-flex items-center gap-2 rounded-full bg-[#11141F] px-5 py-3 text-[13.5px] font-semibold text-white">
            Explore the role demo <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form className="rounded-[26px] border border-[#E2E4F0] bg-white p-6 shadow-[0_22px_60px_-38px_rgba(30,34,70,.38)] sm:p-7" onSubmit={submit} noValidate>
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">Get a payroll quote</p>
      <h2 className="font-display mt-2 text-[28px] font-semibold tracking-[-0.035em] text-[#0B0D1A]">Tell us what your payroll cycle looks like.</h2>
      <p className="mt-3 text-[14px] leading-relaxed text-[#5B6080]">
        We only need the operating shape: company, headcount, frequency, number of entities and the work you want taken off your plate.
      </p>

      {problems.length > 0 && (
        <div className="mt-5 rounded-2xl border border-[#FFD5DC] bg-[#FFF6F7] p-4 text-[13px] text-[#9E2239]" role="alert">
          <div className="flex gap-2.5">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <strong>Please fix the following:</strong>
              <ul className="mt-1 list-disc pl-4">
                {problems.map((problem) => <li key={problem}>{problem}</li>)}
              </ul>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-5 flex gap-2.5 rounded-2xl border border-[#FFD5DC] bg-[#FFF6F7] p-4 text-[13px] text-[#9E2239]" role="alert">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-6 grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-[12.5px] font-semibold text-[#2B2F45]">
            Your name
            <input className={inputClass} value={form.name} onChange={set("name")} autoComplete="name" required />
          </label>
          <label className="text-[12.5px] font-semibold text-[#2B2F45]">
            Work email
            <input className={inputClass} type="email" value={form.email} onChange={set("email")} autoComplete="email" required />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-[12.5px] font-semibold text-[#2B2F45]">
            Company
            <input className={inputClass} value={form.company} onChange={set("company")} autoComplete="organization" required />
          </label>
          <label className="text-[12.5px] font-semibold text-[#2B2F45]">
            People on payroll
            <select className={inputClass} value={form.headcount} onChange={set("headcount")} required>
              <option value="">Select…</option>
              <option value="1-10">1 to 10</option>
              <option value="11-50">11 to 50</option>
              <option value="51-200">51 to 200</option>
              <option value="201-500">201 to 500</option>
              <option value="500+">More than 500</option>
            </select>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-[12.5px] font-semibold text-[#2B2F45]">
            Payroll frequency
            <select className={inputClass} value={form.frequency} onChange={set("frequency")}>
              <option value="">Select…</option>
              <option value="semi-monthly">Semi-monthly</option>
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="text-[12.5px] font-semibold text-[#2B2F45]">
            Entities or companies
            <select className={inputClass} value={form.entities} onChange={set("entities")}>
              <option value="">Select…</option>
              <option value="1">1</option>
              <option value="2-5">2 to 5</option>
              <option value="6+">6 or more</option>
            </select>
          </label>
        </div>

        <label className="text-[12.5px] font-semibold text-[#2B2F45]">
          What do you want the payroll team to handle?
          <textarea
            className={`${inputClass} min-h-[120px] resize-y`}
            value={form.notes}
            onChange={set("notes")}
            placeholder="Example: process semi-monthly payroll, validate attendance exceptions, prepare statutory figures and payroll reports, then send the run back to us for approval."
          />
          <small className="mt-2 block text-[11px] font-normal leading-relaxed text-[#8B90AA]">
            Optional. Do not include passwords, bank credentials or employee personal data.
          </small>
        </label>
      </div>

      <button
        type="submit"
        disabled={saving}
        className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#6161FF] px-5 py-3.5 text-[14px] font-semibold text-white transition-transform hover:scale-[1.01] disabled:cursor-wait disabled:opacity-60"
      >
        {saving ? <LoaderCircle size={15} className="animate-spin" /> : <Send size={15} />}
        {saving ? "Submitting…" : "Request payroll quote"}
      </button>
      <p className="mt-3 text-center text-[11px] text-[#8B90AA]">No bank credentials or employee personal data required.</p>
    </form>
  );
}
