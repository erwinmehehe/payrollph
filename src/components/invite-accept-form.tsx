"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Check, LoaderCircle, Mail, ShieldCheck } from "lucide-react";
import Link from "next/link";

const inputClass =
  "mt-2 h-12 w-full rounded-[12px] border border-[#DDE0EA] bg-white px-3.5 text-[14px] text-[#11141F] outline-none transition placeholder:text-[#A0A6B8] focus:border-[#8F8FFF] focus:ring-4 focus:ring-[#6161FF]/10";

export function InviteAcceptForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(Boolean(token));
  const [checked, setChecked] = useState<{ email: string; role: string } | null>(null);

  const rules = [
    { label: "12+ characters", ok: password.length >= 12 },
    { label: "Uppercase", ok: /[A-Z]/.test(password) },
    { label: "Lowercase", ok: /[a-z]/.test(password) },
    { label: "Number", ok: /[0-9]/.test(password) },
  ];

  useEffect(() => {
    if (!token) return;
    let active = true;

    async function verify() {
      setChecking(true);
      setError("");
      try {
        const response = await fetch(`/api/invitations/accept?token=${encodeURIComponent(token)}`);
        const payload = await response.json().catch(() => ({}));
        if (!active) return;
        if (!response.ok) {
          setChecked(null);
          setError("This invitation is invalid, already used, or expired.");
          return;
        }
        setChecked({ email: payload.email, role: payload.role });
      } catch {
        if (active) setError("We could not verify this invitation right now.");
      } finally {
        if (active) setChecking(false);
      }
    }

    void verify();
    return () => {
      active = false;
    };
  }, [token]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? "Could not accept this invitation.");
        return;
      }
      setDone(true);
      setTimeout(() => {
        window.location.href = "/app";
      }, 900);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <section className="rounded-[28px] border border-[#E2E4F0] bg-white p-6 shadow-[0_26px_70px_-38px_rgba(30,34,70,.4)] sm:p-8">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#FFF4D6] text-[#9A6B00]">
          <ShieldCheck size={19} />
        </span>
        <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">Invitation required</p>
        <h2 className="font-display mt-2 text-[28px] font-semibold tracking-[-0.035em]">This invitation link is incomplete.</h2>
        <p className="mt-3 text-[14px] leading-relaxed text-[#5B6080]">
          Open the full invitation link you received, or ask your workspace administrator to send a new invitation.
        </p>
        <Link href="/login" className="mt-6 inline-flex items-center gap-2 text-[13px] font-semibold text-[#4A4AE0]">
          Back to sign in <ArrowRight size={14} />
        </Link>
      </section>
    );
  }

  return (
    <section className="rounded-[28px] border border-[#E2E4F0] bg-white p-6 shadow-[0_26px_70px_-38px_rgba(30,34,70,.4)] sm:p-8">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">Accept invitation</p>
      <h2 className="font-display mt-2 text-[30px] font-semibold tracking-[-0.035em]">
        {done ? "Account ready." : checking ? "Checking your invitation…" : "Create your Linaw account."}
      </h2>

      {done ? (
        <div className="mt-5 rounded-2xl border border-[#BDE9D5] bg-[#F1FBF6] p-4 text-[13.5px] leading-relaxed text-[#176A4E]">
          <div className="flex gap-2.5">
            <Check size={16} className="mt-0.5 shrink-0" />
            <span>Your account is ready. Opening your role-specific workspace…</span>
          </div>
        </div>
      ) : checking ? (
        <div className="mt-6 flex items-center gap-3 rounded-2xl bg-[#F7F8FC] p-4 text-[13px] text-[#5B6080]">
          <LoaderCircle size={16} className="animate-spin text-[#6161FF]" />
          Verifying the invitation…
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 grid gap-4">
          {checked && (
            <div className="rounded-2xl border border-[#BDE9D5] bg-[#F1FBF6] p-4 text-[13px] text-[#176A4E]">
              <div className="flex gap-2.5">
                <Mail size={16} className="mt-0.5 shrink-0" />
                <span><strong>{checked.email}</strong><br />Invited as {checked.role}</span>
              </div>
            </div>
          )}

          <label className="text-[12px] font-semibold text-[#30354A]">
            Your name
            <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
          </label>
          <label className="text-[12px] font-semibold text-[#30354A]">
            Create a password
            <input className={inputClass} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required />
          </label>
          <label className="text-[12px] font-semibold text-[#30354A]">
            Confirm password
            <input className={inputClass} type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" required />
          </label>

          <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
            {rules.map((rule) => (
              <span key={rule.label} className={`inline-flex items-center gap-1.5 rounded-xl px-2.5 py-2 font-semibold ${rule.ok ? "bg-[#E3FAF0] text-[#0A8A53]" : "bg-[#F4F5FA] text-[#8B90AA]"}`}>
                <Check size={12} /> {rule.label}
              </span>
            ))}
          </div>

          {error && (
            <div className="rounded-2xl border border-[#FFD5DC] bg-[#FFF6F7] p-4 text-[13px] text-[#9E2239]" role="alert">
              {error}
            </div>
          )}

          <button
            className="mt-1 inline-flex h-12 w-full items-center justify-center gap-2 rounded-[12px] bg-[#6161FF] px-5 text-[13.5px] font-semibold text-white shadow-[0_12px_28px_-16px_rgba(97,97,255,.8)] transition hover:brightness-95 disabled:cursor-wait disabled:opacity-60"
            disabled={busy || !checked}
          >
            {busy ? <LoaderCircle size={15} className="animate-spin" /> : null}
            {busy ? "Creating account…" : "Create account"} <ArrowRight size={15} />
          </button>
        </form>
      )}
    </section>
  );
}
