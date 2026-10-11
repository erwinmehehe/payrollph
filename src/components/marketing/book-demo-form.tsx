"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { PrivacyConsentFields } from "@/components/marketing/privacy-consent-fields";
import { AlertTriangle, ArrowRight, CalendarDays, Check, LoaderCircle } from "lucide-react";
import { readMarketingAttribution } from "@/lib/marketing-attribution-client";

type Result = { leadId: number; recorded: boolean };

const inputClass =
  "mt-2 w-full rounded-xl border border-[#D9DCEC] bg-white px-3.5 py-3 text-[14px] text-[#11141F] outline-none transition focus:border-[#0877ff] focus:ring-4 focus:ring-[#0877ff]/10";

export function BookDemoForm({ variant = "demo" }: { variant?: "demo" | "contact" }) {
  const [form, setForm] = useState({ name: "", email: "", company: "", headcount: "", notes: "" });
  const [topic, setTopic] = useState("Product question");
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [website, setWebsite] = useState("");
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
      const response = await fetch("/api/demo-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, notes: variant === "contact" ? `[Contact: ${topic}] ${form.notes}` : form.notes, sourcePath: variant === "contact" ? "/contact" : "/book-demo", requestType: "demo", privacyConsent, website, attribution: readMarketingAttribution() }),
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
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e5f8f2] text-[#00886e]">
          <Check size={19} />
        </span>
        <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">{variant === "contact" ? "Contact inquiry" : "Demo request"}</p>
        <h2 className="font-display mt-2 text-[28px] font-semibold tracking-[-0.035em] text-[#0B0D1A]">
          Your request is in.
        </h2>
                <p className="mt-3 text-[14px] leading-relaxed text-[#5B6080]">{variant === "contact" ? "Your inquiry has been recorded. This confirmation does not book a demo or promise a response time." : "We recorded your payroll brief so the walkthrough can focus on your headcount, structure and cutoff questions."}</p>

        <div className="mt-6 flex flex-wrap gap-2.5">
          <Link href="/demo" className="inline-flex items-center gap-2 rounded-full bg-[#11141F] px-5 py-3 text-[13.5px] font-semibold text-white">
            Open role demo <ArrowRight size={14} />
          </Link>
          <Link href="/" className="rounded-full border border-[#D9DCEC] px-5 py-3 text-[13.5px] font-semibold text-[#2B2F45]">
            Back to product
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form className="linaw-inquiry-form rounded-[14px] border border-[#E2E4F0] bg-white p-6 shadow-[0_22px_60px_-38px_rgba(30,34,70,.38)] sm:p-7" onSubmit={submit} noValidate>
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e5f0ff] text-[#0868dc]">
        <CalendarDays size={19} />
      </span>
      <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">{variant === "contact" ? "Start a conversation" : "Book a walkthrough"}</p>
      <h2 className="font-display mt-2 text-[28px] font-semibold tracking-[-0.035em] text-[#0B0D1A]">{variant === "contact" ? "Tell us about your team." : "Tell us about your payroll."}</h2>
      <p className="mt-3 text-[14px] leading-relaxed text-[#5B6080]">
        Share your company, team size, and the workflow you want to improve.
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

      <div className="mt-6 grid gap-4">{variant === "contact" && <label className="text-[12.5px] font-semibold text-[#2B2F45]">Inquiry topic<select className={inputClass} value={topic} onChange={event => setTopic(event.target.value)}>{["Product question", "Payroll outsourcing", "Security and procurement", "Integration question", "Account support"].map(item => <option key={item}>{item}</option>)}</select></label>}
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
            Company or practice
            <input className={inputClass} value={form.company} onChange={set("company")} autoComplete="organization" required />
          </label>
          <label className="text-[12.5px] font-semibold text-[#2B2F45]">
            People on payroll
            <select className={inputClass} value={form.headcount} onChange={set("headcount")}>
              <option value="">Select…</option>
              <option value="1">Just me</option>
              <option value="2-10">2 to 10</option>
              <option value="11-50">11 to 50</option>
              <option value="51-200">51 to 200</option>
              <option value="200+">200+</option>
              <option value="multi-client">Multiple client companies</option>
            </select>
          </label>
        </div>

        <label className="text-[12.5px] font-semibold text-[#2B2F45]">
          {variant === "contact" ? "How can we help?" : "What would you like to see?"}
          <textarea
            className={`${inputClass} min-h-[120px] resize-y`}
            value={form.notes}
            onChange={set("notes")}
            placeholder="Example: semi-monthly payroll across two branches, BIR worksheets, and how approvals work when our approver is on leave."
          />
          <small className="mt-2 block text-[11px] font-normal text-[#8B90AA]">Optional. Use a company-level brief. Employee records, bank details, and payroll files belong in your signed-in workspace.</small>
        </label>
      </div>

      <PrivacyConsentFields accepted={privacyConsent} onAcceptedChange={setPrivacyConsent} website={website} onWebsiteChange={setWebsite} />
      <button
        type="submit"
        disabled={saving}
        className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#0877ff] px-5 py-3.5 text-[14px] font-semibold text-white transition-transform hover:scale-[1.01] disabled:cursor-wait disabled:opacity-60"
      >
        {saving ? <LoaderCircle size={15} className="animate-spin" /> : <CalendarDays size={15} />}
        {saving ? "Submitting…" : variant === "contact" ? "Send inquiry" : "Request a demo"}
      </button>
    </form>
  );
}
