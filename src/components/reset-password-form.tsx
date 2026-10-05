"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Check, KeyRound, LoaderCircle } from "lucide-react";
import Link from "next/link";

const inputClass =
  "mt-2 h-12 w-full rounded-[12px] border border-[#DDE0EA] bg-white px-3.5 text-[14px] text-[#11141F] outline-none transition placeholder:text-[#A0A6B8] focus:border-[#8F8FFF] focus:ring-4 focus:ring-[#6161FF]/10";

export function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const rules = [
    { label: "12+ characters", ok: password.length >= 12 },
    { label: "Uppercase", ok: /[A-Z]/.test(password) },
    { label: "Lowercase", ok: /[a-z]/.test(password) },
    { label: "Number", ok: /[0-9]/.test(password) },
  ];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    setError("");
    setProblems([]);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? "We could not update your password.");
        setProblems(payload.problems ?? []);
        return;
      }
      setDone(true);
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
          <KeyRound size={19} />
        </span>
        <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">Reset link required</p>
        <h2 className="font-display mt-2 text-[28px] font-semibold tracking-[-0.035em]">This reset link is incomplete.</h2>
        <p className="mt-3 text-[14px] leading-relaxed text-[#5B6080]">
          Request a new password reset from the sign-in page and open the complete link from your email.
        </p>
        <Link href="/login" className="mt-6 inline-flex items-center gap-2 text-[13px] font-semibold text-[#4A4AE0]">
          Back to sign in <ArrowRight size={14} />
        </Link>
      </section>
    );
  }

  return (
    <section className="rounded-[28px] border border-[#E2E4F0] bg-white p-6 shadow-[0_26px_70px_-38px_rgba(30,34,70,.4)] sm:p-8">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">Reset password</p>
      <h2 className="font-display mt-2 text-[30px] font-semibold tracking-[-0.035em]">
        {done ? "Password updated." : "Choose a new password."}
      </h2>

      {done ? (
        <>
          <p className="mt-3 text-[14px] leading-relaxed text-[#5B6080]">
            Your password has changed and existing sessions have been signed out.
          </p>
          <Link href="/login" className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-[12px] bg-[#6161FF] px-5 text-[13.5px] font-semibold text-white">
            Continue to sign in <ArrowRight size={15} />
          </Link>
        </>
      ) : (
        <form onSubmit={submit} className="mt-6 grid gap-4">
          <p className="text-[13px] leading-relaxed text-[#6B718C]">
            This link works once and expires 30 minutes after the reset request.
          </p>

          <label className="text-[12px] font-semibold text-[#30354A]">
            New password
            <input className={inputClass} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required />
          </label>
          <label className="text-[12px] font-semibold text-[#30354A]">
            Confirm new password
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
              <strong>{error}</strong>
              {problems.length > 0 && <p className="mt-1">{problems.join(" ")}</p>}
            </div>
          )}

          <button
            className="mt-1 inline-flex h-12 w-full items-center justify-center gap-2 rounded-[12px] bg-[#6161FF] px-5 text-[13.5px] font-semibold text-white transition hover:brightness-95 disabled:cursor-wait disabled:opacity-60"
            disabled={busy}
          >
            {busy ? <LoaderCircle size={15} className="animate-spin" /> : null}
            {busy ? "Updating…" : "Update password"}
          </button>
        </form>
      )}
    </section>
  );
}
