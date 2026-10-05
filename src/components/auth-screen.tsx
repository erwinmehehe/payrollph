"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";

type Mode = "login" | "forgot";

const inputClass =
  "h-12 w-full rounded-[12px] border border-[#DDE0EA] bg-white pl-11 pr-3.5 text-[14px] text-[#11141F] outline-none transition placeholder:text-[#A0A6B8] focus:border-[#8F8FFF] focus:ring-4 focus:ring-[#6161FF]/10";

export function AuthScreen({
  demoMode = false,
  setupAvailable = false,
  initialError = "",
}: {
  demoMode?: boolean;
  setupAvailable?: boolean;
  initialError?: string;
}) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [requiresTotp, setRequiresTotp] = useState(false);
  const [message, setMessage] = useState("Use the account created for your workspace or the invitation you accepted.");
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const [ssoBusy, setSsoBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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

  async function sso() {
    setError("");
    if (!email.trim()) {
      setError("Enter your work email first so Linaw can find your company's SSO provider.");
      return;
    }
    setSsoBusy(true);
    try {
      const response = await fetch("/api/auth/sso/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.available || !payload.startUrl) {
        setError(payload.error ?? "No verified single sign-on provider is configured for this email domain.");
        return;
      }
      window.location.href = payload.startUrl;
    } catch {
      setError("Could not reach the single sign-on service.");
    } finally {
      setSsoBusy(false);
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
      setMessage(
        "If this email belongs to a Linaw account, the reset request has been recorded. Check your inbox for a link; if nothing arrives, contact your workspace administrator.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative overflow-hidden bg-[#F8F9FC] py-10 sm:py-14">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute left-[8%] top-0 h-[420px] w-[520px] rounded-full bg-[#ECECFF] opacity-55 blur-3xl" />
        <div className="absolute right-[6%] top-24 h-[360px] w-[420px] rounded-full bg-[#EAF7F3] opacity-45 blur-3xl" />
      </div>

      <div className="relative mx-auto grid min-h-[650px] max-w-[1160px] gap-6 px-5 sm:px-8 lg:grid-cols-[1fr_470px] lg:items-stretch">
        <section className="hidden min-h-[520px] flex-col justify-between rounded-[28px] border border-[#E4E6F0] bg-white/70 p-10 shadow-[0_24px_70px_-52px_rgba(30,34,70,.35)] backdrop-blur-sm lg:flex">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#DDDFFF] bg-[#F7F7FF] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#5555D8]">
              <ShieldCheck size={13} aria-hidden />
              Secure workspace access
            </span>

            <h2 className="font-display mt-7 max-w-[620px] text-balance text-[56px] font-semibold leading-[1.02] tracking-[-0.045em] text-[#11141F]">
              Sign in to Linaw.
            </h2>
            <p className="mt-5 max-w-[590px] text-[15px] leading-[1.75] text-[#606780]">
              One workspace for payroll, people and approvals. Your role decides what you can see and what you can do after sign-in.
            </p>

            <div className="mt-8 overflow-hidden rounded-[22px] border border-[#E5E7F0] bg-white">
              <div className="flex items-center justify-between border-b border-[#ECEEF4] px-4 py-3.5">
                <div>
                  <span className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-[#969CB0]">After sign-in</span>
                  <strong className="mt-0.5 block text-[13px] font-semibold text-[#202330]">Your role-scoped workspace opens immediately</strong>
                </div>
                <span className="rounded-full bg-[#ECF8F2] px-2.5 py-1 text-[10px] font-bold text-[#0A8A53]">Protected</span>
              </div>

              <div className="grid gap-0 sm:grid-cols-3">
                {[
                  ["01", "Work in context", "Payroll, people and approvals stay connected."],
                  ["02", "Keep duties separate", "Maker, checker and owner actions stay distinct."],
                  ["03", "Trace every decision", "Important payroll actions remain auditable."],
                ].map(([step, title, copy], index) => (
                  <div key={step} className={`p-4 sm:p-5 ${index < 2 ? "border-b border-[#ECEEF4] sm:border-b-0 sm:border-r" : ""}`}>
                    <span className="text-[10px] font-bold text-[#7777E8]">{step}</span>
                    <strong className="mt-2 block text-[12.5px] font-semibold text-[#202330]">{title}</strong>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-[#7B8198]">{copy}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-[#ECEEF4] pt-5 text-[12px] font-medium text-[#6C7288]">
            <span className="inline-flex items-center gap-2"><Check size={13} className="text-[#0A8A53]" /> Rate-limited sign in</span>
            <span className="inline-flex items-center gap-2"><Check size={13} className="text-[#0A8A53]" /> Role permissions</span>
            <span className="inline-flex items-center gap-2"><Check size={13} className="text-[#0A8A53]" /> TOTP when enabled</span>
          </div>
        </section>

        <section className="flex items-center">
          <div className="w-full rounded-[28px] border border-[#E0E3ED] bg-white p-6 shadow-[0_30px_80px_-42px_rgba(35,38,80,.38)] sm:p-8">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#8D93A8]">
                {mode === "login" ? "Workspace sign in" : "Password recovery"}
              </p>
              <h1 className="font-display mt-2 text-[30px] font-semibold tracking-[-0.035em] text-[#11141F]">
                {mode === "login" ? "Welcome back." : "Reset your password."}
              </h1>
              <p className="mt-2.5 text-[13px] leading-relaxed text-[#72788F]">{message}</p>
            </div>

            {error && (
              <div className="mt-5 rounded-xl border border-[#FFD5DC] bg-[#FFF6F7] px-3.5 py-3 text-[12.5px] font-medium text-[#9E2239]">
                {error}
              </div>
            )}

            {setupAvailable && (
              <div className="mt-5 rounded-xl border border-[#C8DBF8] bg-[#F3F7FF] px-3.5 py-3 text-[12.5px] leading-relaxed text-[#315781]">
                This workspace has no accounts yet. <Link href="/setup" className="font-semibold underline underline-offset-2">Create the owner account</Link> to begin.
              </div>
            )}

            {mode === "login" ? (
              <form onSubmit={login} className="mt-6 grid gap-4.5">
                <label className="text-[12px] font-semibold text-[#30354A]">
                  Work email
                  <span className="relative mt-2 block">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9AA0B2]" aria-hidden />
                    <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.ph" autoComplete="username" required />
                  </span>
                </label>

                <label className="text-[12px] font-semibold text-[#30354A]">
                  <span className="flex items-center justify-between gap-4">
                    Password
                    <button type="button" onClick={() => setMode("forgot")} className="text-[11.5px] font-semibold text-[#5A5AE0] hover:text-[#4444C8]">
                      Forgot password?
                    </button>
                  </span>
                  <span className="relative mt-2 block">
                    <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9AA0B2]" aria-hidden />
                    <input
                      className={`${inputClass} pr-11`}
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      data-testid="password-visibility"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[#858BA0] hover:bg-[#F3F4F8] hover:text-[#4E5368]"
                    >
                      {showPassword ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
                    </button>
                  </span>
                </label>

                {requiresTotp && (
                  <label className="text-[12px] font-semibold text-[#30354A]">
                    Authenticator code
                    <span className="relative mt-2 block">
                      <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9AA0B2]" aria-hidden />
                      <input className={inputClass} value={totpCode} onChange={(e) => setTotpCode(e.target.value)} placeholder="6-digit code" inputMode="numeric" />
                    </span>
                    <small className="mt-2 block text-[10.5px] font-normal leading-relaxed text-[#8B90AA]">Your password was accepted. The session is created only after TOTP verification.</small>
                  </label>
                )}

                <button
                  className="mt-1 inline-flex h-12 w-full items-center justify-center gap-2 rounded-[12px] px-5 text-[13.5px] font-semibold shadow-[0_12px_28px_-16px_rgba(97,97,255,.8)] transition hover:brightness-95 disabled:cursor-wait disabled:opacity-60"
                  style={{ backgroundColor: "#6161FF", color: "#FFFFFF" }}
                  disabled={busy}
                >
                  {requiresTotp ? "Verify & sign in" : "Sign in"} <ArrowRight size={15} aria-hidden />
                </button>
                {!requiresTotp && (
                  <>
                    <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#A0A6B8]">
                      <span className="h-px flex-1 bg-[#ECEEF4]" /> or <span className="h-px flex-1 bg-[#ECEEF4]" />
                    </div>
                    <button
                      type="button"
                      className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[12px] border border-[#DDE0EA] bg-white px-5 text-[13px] font-semibold text-[#34394E] transition hover:bg-[#F7F8FC] disabled:cursor-wait disabled:opacity-60"
                      disabled={ssoBusy}
                      onClick={sso}
                    >
                      <ShieldCheck size={15} aria-hidden /> {ssoBusy ? "Finding SSO…" : "Continue with company SSO"}
                    </button>
                  </>
                )}
              </form>
            ) : (
              <form onSubmit={forgot} className="mt-6 grid gap-4">
                <label className="text-[12px] font-semibold text-[#30354A]">
                  Work email
                  <span className="relative mt-2 block">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9AA0B2]" aria-hidden />
                    <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.ph" required />
                  </span>
                </label>
                <button
                  className="inline-flex h-12 w-full items-center justify-center rounded-[12px] px-5 text-[13.5px] font-semibold transition hover:brightness-95 disabled:opacity-60"
                  style={{ backgroundColor: "#6161FF", color: "#FFFFFF" }}
                  disabled={busy}
                >
                  Send reset link
                </button>
                <button type="button" onClick={() => setMode("login")} className="text-center text-[12px] font-semibold text-[#5A5AE0]">
                  Back to sign in
                </button>
              </form>
            )}

            <div className="mt-6 grid gap-3 border-t border-[#ECEEF4] pt-5">
              <p className="text-center text-[12px] text-[#777D93]">
                New to Linaw? <Link href="/signup" className="font-semibold text-[#4A4AE0]">Request trial access</Link>
              </p>
              <Link href="/demo" className="inline-flex h-10 items-center justify-center gap-2 rounded-[10px] border border-[#E1E3EC] bg-[#FAFBFD] px-4 text-[12px] font-semibold text-[#4E546A] transition hover:border-[#D3D6E2] hover:bg-[#F4F5F9]">
                Explore the role-based demo <ArrowRight size={13} aria-hidden />
              </Link>
            </div>

            {demoMode && (
              <div className="mt-5 rounded-xl bg-[#F7F8FC] p-3.5 text-[10.5px] leading-relaxed text-[#686E84]">
                <strong className="block text-[#2B2F45]">Development test account</strong>
                <span className="mono mt-1 block">celine@linaw.ph / LinawDemo2026!</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
