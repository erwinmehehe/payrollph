"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, Check, CheckCircle2, ShieldCheck } from "lucide-react";
import { isSellablePlan, safeSeats, subscriptionQuote, type SellablePlan } from "@/lib/saas-pricing";

type PlanView = { name: string; monthlyBase: string; perEmployee: string; active: boolean };
const fieldClass = "mt-2 w-full min-h-[46px] rounded-xl border border-[#D9DCEC] bg-white px-3.5 py-3 text-base text-[#11141F] outline-none focus:border-[#0877ff] focus:ring-4 focus:ring-[#0877ff]/10";

export function SelfServeSignupForm({ plans, initialPlan }: { plans: PlanView[]; initialPlan?: string }) {
  const sellable = plans.filter((plan) => isSellablePlan(plan.name) && plan.active);
  const [plan, setPlan] = useState<SellablePlan>(
    isSellablePlan(initialPlan) && sellable.some((row) => row.name === initialPlan) ? initialPlan : "Core",
  );
  const [seats, setSeats] = useState("10");
  const [values, setValues] = useState({ name: "", email: "", company: "", password: "", confirm: "" });
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState("");
  const [issues, setIssues] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  const quote = useMemo(() => {
    const selected = sellable.find((row) => row.name === plan);
    const count = safeSeats(seats);
    if (!selected || !count) return null;
    try { return subscriptionQuote(selected, count); }
    catch { return null; }
  }, [plan, seats, sellable]);

  function set(name: keyof typeof values, next: string) {
    setValues((current) => ({ ...current, [name]: next }));
  }

  async function register(event: FormEvent) {
    event.preventDefault();
    setIssues([]);
    setError("");
    if (!quote) return setError("Choose a valid plan and seat count.");
    if (values.password !== values.confirm) return setError("Passwords do not match.");
    setBusy(true);
    try {
      const response = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          email: values.email,
          company: values.company,
          password: values.password,
          plan, seats: quote.seats, acceptTerms: agreed,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setIssues(body.problems || []);
        setError(body.error || "Registration could not be completed.");
        return;
      }
      setSubmitted(true);
      setValues({ name: "", email: "", company: "", password: "", confirm: "" });
    } catch {
      setError("The registration service is unavailable. Please try later.");
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-[24px] border border-[#d5e7db] bg-[#f2fff6] p-7" role="status">
        <CheckCircle2 size={32} className="text-[#13805c]" />
        <h2 className="mt-3 font-display text-[26px] font-semibold">Check your work email</h2>
        <p className="mt-3 text-[14px] leading-relaxed text-[#42546d]">
          If the account is eligible, you'll receive a one-time verification link. Confirm your email and sign in to authorize the monthly subscription. You have not been charged.
        </p>
        <Link href="/login" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[#0868dc]">Already verified? Sign in <ArrowRight size={16} /></Link>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void register(event)} className="rounded-[24px] border border-[#D9DCEC] bg-white p-5 shadow-[0_18px_55px_-38px_rgba(30,34,70,.38)] sm:p-7">
      <span className="text-[11px] font-bold uppercase tracking-[.14em] text-[#0877ff]">Create a company workspace</span>
      <h2 className="font-display mt-2 text-[27px] font-semibold text-[#11141F]">Choose your monthly plan</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-[#5B6080]">No sample employees. Your company starts with zero staff and no payroll history.</p>
      <fieldset className="mt-5 grid gap-2">
        <legend className="mb-2 text-[12px] font-semibold text-[#2B2F45]">Software plan</legend>
        {sellable.map((item) => (
          <label key={item.name} className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3.5 ${plan === item.name ? "border-[#0877ff] bg-[#edf5ff]" : "border-[#E2E4F0]"}`}>
            <span className="flex items-center gap-3"><input type="radio" name="plan" checked={plan === item.name} onChange={() => setPlan(item.name as SellablePlan)} />
              <strong className="text-[14px]">{item.name}</strong>
            </span>
            <span className="text-right text-[12px] text-[#5B6080]">₱{Number(item.monthlyBase).toLocaleString("en-PH")} + ₱{Number(item.perEmployee).toLocaleString("en-PH")}/seat</span>
          </label>
        ))}
      </fieldset>
      <label className="mt-4 block text-[13px] font-semibold">Employee seats included in your subscription
        <input className={fieldClass} type="number" min={1} max={2000} step={1} inputMode="numeric" value={seats} onChange={(event) => setSeats(event.target.value)} required />
      </label>
      <p className="mt-1 text-[12px] text-[#6B718C]">You can onboard up to this many employees. Seat changes need an updated billing authorization.</p>
      <div className="mt-5 rounded-2xl border border-[#BDD8FF] bg-[#EDF5FF] p-4" aria-live="polite">
        <span className="text-[11px] font-semibold uppercase tracking-[.1em] text-[#4E6E9D]">Monthly recurring subscription</span>
        <p className="mt-1 font-display text-[30px] font-semibold text-[#0B3E8C]">{quote ? "₱" + quote.amountPhp.toLocaleString("en-PH", { minimumFractionDigits: 2 }) : "—"} <span className="text-[13px] font-medium">/ month</span></p>
        <p className="mt-1 text-[12px] text-[#486489]">You will review and authorize the amount at hosted checkout. You will not be charged by submitting this form.</p>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-[12px] font-semibold">Your full name
          <input className={fieldClass} value={values.name} onChange={(e) => set("name", e.target.value)} autoComplete="name" minLength={2} maxLength={120} required />
        </label>
        <label className="text-[12px] font-semibold">Work email
          <input className={fieldClass} type="email" value={values.email} onChange={(e) => set("email", e.target.value)} autoComplete="email" required />
        </label>
      </div>
      <label className="mt-4 block text-[12px] font-semibold">Registered company name
        <input className={fieldClass} value={values.company} onChange={(e) => set("company", e.target.value)} autoComplete="organization" minLength={2} required />
      </label>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-[12px] font-semibold">Create password
          <input className={fieldClass} type="password" value={values.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" minLength={12} maxLength={256} required />
        </label>
        <label className="text-[12px] font-semibold">Confirm password
          <input className={fieldClass} type="password" value={values.confirm} onChange={(e) => set("confirm", e.target.value)} autoComplete="new-password" minLength={12} required />
        </label>
      </div>
      <p className="mt-2 text-[12px] text-[#6B718C]">Use at least 12 characters, with uppercase and lowercase letters and a number.</p>
      <label className="mt-5 flex items-start gap-3 text-[12px] leading-relaxed text-[#404965]">
        <input className="mt-1 h-4 w-4" type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} required />
        <span>I understand that, after I authorize hosted checkout, this is a recurring monthly subscription based on the shown seat count and price. Automatic payments continue until cancellation. Cancellation stops future billing and does not erase my payroll records.</span>
      </label>
      {error && <p className="mt-4 rounded-xl bg-[#FFF1F1] p-3 text-sm text-[#a51b34]" role="alert">{error}</p>}
      {issues.length > 0 && <ul className="mt-2 list-disc pl-5 text-[12px] text-[#a51b34]">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
      <button type="submit" disabled={busy || !quote || !agreed} className="mt-5 flex min-h-[50px] w-full items-center justify-center gap-2 rounded-full bg-[#0877ff] px-5 py-3 font-semibold text-white disabled:opacity-50">
        {busy ? "Creating account…" : "Create account & verify email"} <ArrowRight size={17} />
      </button>
      <div className="mt-4 flex items-center justify-center gap-2 text-xs text-[#6B718C]">
        <ShieldCheck size={16} /> Payments use hosted checkout, not stored card details in Linaw.
      </div>
      <p className="mt-3 text-center text-[12px] text-[#6B718C]">Already have an account? <Link href="/login" className="font-semibold text-[#0868dc]">Sign in</Link></p>
    </form>
  );
}
