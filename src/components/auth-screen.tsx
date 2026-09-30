"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, KeyRound, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";

type Mode = "login" | "forgot";

const inputClass =
  "mt-2 w-full rounded-xl border border-[#D9DCEC] bg-white px-3.5 py-3 text-[14px] text-[#11141F] outline-none transition focus:border-[#6161FF] focus:ring-4 focus:ring-[#6161FF]/10";

export function AuthScreen({ demoMode = false, setupAvailable = false }: { demoMode?: boolean; setupAvailable?: boolean }) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [requiresTotp, setRequiresTotp] = useState(false);
  const [message, setMessage] = useState("Use the account created for your workspace or the invitation you accepted.");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, totpCode: totpCode || undefined }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "Sign-in failed");
        if (payload.requiresTotp) setRequiresTotp(true);
        return;
      }
      if (payload.requiresTotp) {
        setRequiresTotp(true);
        setMessage(payload.message);
        if (payload.demoTotpCode) setTotpCode(payload.demoTotpCode);
        return;
      }
      window.location.href = "/app";
    } catch {
      setError("Could not reach the auth service.");
    } finally {
      setBusy(false);
    }
  }

  async function forgot(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "Could not start reset");
        return;
      }
      const delivery = payload.delivery;
      setMessage(
        delivery?.configured
          ? "Check your email for a reset link. The link expires in 30 minutes."
          : `Reset link queued in the database outbox (${delivery?.reason ?? "no email provider"}). An administrator can retrieve it from the outbox.`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative overflow-hidden bg-white py-14 sm:py-18">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-48 h-[620px] w-[680px] rounded-full bg-gradient-to-br from-[#ECECFF] via-[#EAF4FF] to-[#E3FAF0] opacity-75 blur-3xl" />
      </div>

      <div className="relative mx-auto grid max-w-[1080px] gap-8 px-5 sm:px-8 lg:grid-cols-[.92fr_1.08fr] lg:items-center">
        <section>
          <span className="inline-flex items-center gap-2 rounded-full border border-[#DDE0EF] bg-white px-3.5 py-2 text-[12px] font-bold text-[#4A4AE0] shadow-sm">
            <ShieldCheck size={14} />
            Secure workspace access
          </span>
          <h1 className="font-display mt-6 max-w-[620px] text-balance text-[42px] font-semibold leading-[1.02] tracking-[-0.045em] sm:text-[56px]">
            Sign in to the payroll workspace.
          </h1>
          <p className="mt-5 max-w-[610px] text-[15px] leading-relaxed text-[#5B6080]">
            Linaw keeps payroll actions behind server-side sessions, permission checks and optional TOTP. Demo access is separate from real sign-in.
          </p>

          <div className="mt-7 grid gap-3">
            {[
              [ShieldCheck, "Role-based access", "Owner, HR, Payroll, Checker and Employee permissions remain separate."],
              [LockKeyhole, "Revocable sessions", "Sessions are created server-side and can be invalidated from the workspace."],
              [KeyRound, "TOTP when enabled", "Accounts with TOTP enabled complete the second factor before a session is created."],
            ].map(([Icon, title, copy]) => {
              const I = Icon as typeof ShieldCheck;
              return (
                <div key={String(title)} className="flex gap-3.5 rounded-2xl border border-[#E5E7F0] bg-white/85 p-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F1F2F8] text-[#4A4AE0]">
                    <I size={17} />
                  </span>
                  <div>
                    <strong className="text-[13.5px] font-semibold">{String(title)}</strong>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-[#6B718C]">{String(copy)}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 rounded-[22px] bg-[#11141F] p-5 text-white">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
              <Sparkles size={13} /> Role-based sandbox
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-white/65">
              Want to explore before signing in? Open a sample Owner, HR, Payroll, Checker or Employee workspace without using a real account.
            </p>
            <Link href="/demo" className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-[13px] font-semibold text-[#11141F]">
              Explore role demo <ArrowRight size={14} />
            </Link>
          </div>
        </section>

        <section className="rounded-[28px] border border-[#E2E4F0] bg-white p-6 shadow-[0_26px_70px_-38px_rgba(30,34,70,.4)] sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">
                {mode === "login" ? "Sign in" : "Forgot password"}
              </p>
              <h2 className="font-display mt-2 text-[29px] font-semibold tracking-[-0.035em]">
                {mode === "login" ? "Welcome back." : "Request a reset link."}
              </h2>
            </div>
            <Link href="/" className="text-[12px] font-semibold text-[#6161FF]">Back home</Link>
          </div>

          <p className="mt-3 text-[13.5px] leading-relaxed text-[#6B718C]">{message}</p>

          {error && (
            <div className="mt-5 rounded-2xl border border-[#FFD5DC] bg-[#FFF6F7] p-4 text-[13px] text-[#9E2239]">
              {error}
            </div>
          )}

          {setupAvailable && (
            <div className="mt-5 rounded-2xl border border-[#C8DBF8] bg-[#F3F7FF] p-4 text-[13px] leading-relaxed text-[#315781]">
              This workspace has no accounts yet. <Link href="/setup" className="font-semibold underline underline-offset-2">Create the owner account</Link> to begin.
            </div>
          )}

          {mode === "login" ? (
            <form onSubmit={login} className="mt-6 grid gap-4">
              <label className="text-[12.5px] font-semibold text-[#2B2F45]">
                Work email
                <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.ph" autoComplete="username" required />
              </label>
              <label className="text-[12.5px] font-semibold text-[#2B2F45]">
                Password
                <input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••••" autoComplete="current-password" required />
              </label>

              {requiresTotp && (
                <label className="text-[12.5px] font-semibold text-[#2B2F45]">
                  Authenticator code
                  <input className={inputClass} value={totpCode} onChange={(e) => setTotpCode(e.target.value)} placeholder="6-digit TOTP" inputMode="numeric" />
                  <small className="mt-2 block text-[11px] font-normal text-[#8B90AA]">Password succeeded. The session is created only after TOTP verification.</small>
                </label>
              )}

              <button
                className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#11141F] px-5 py-3.5 text-[14px] font-semibold text-white disabled:opacity-60"
                disabled={busy}
              >
                {requiresTotp ? "Verify & sign in" : "Sign in"} <ArrowRight size={15} />
              </button>
              <button type="button" onClick={() => setMode("forgot")} className="text-center text-[12.5px] font-semibold text-[#6161FF]">
                Forgot password?
              </button>
            </form>
          ) : (
            <form onSubmit={forgot} className="mt-6 grid gap-4">
              <label className="text-[12.5px] font-semibold text-[#2B2F45]">
                Work email
                <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.ph" required />
              </label>
              <button className="inline-flex w-full items-center justify-center rounded-full bg-[#11141F] px-5 py-3.5 text-[14px] font-semibold text-white disabled:opacity-60" disabled={busy}>
                Send reset link
              </button>
              <button type="button" onClick={() => setMode("login")} className="text-center text-[12.5px] font-semibold text-[#6161FF]">
                Back to sign in
              </button>
            </form>
          )}

          {demoMode && (
            <div className="mt-6 rounded-2xl bg-[#F7F8FC] p-4 text-[11.5px] leading-relaxed text-[#5B6080]">
              <strong className="block text-[#2B2F45]">Development test account</strong>
              <span className="mono mt-1 block">celine@linaw.ph / LinawDemo2026!</span>
              <span className="mt-1 block">Visible only when demo mode is enabled on the deployment.</span>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
