"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";

export function VerifySignupForm({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/signup/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setError(data.error || "The link could not be verified.");
      window.location.assign(data.redirectTo || "/billing/setup");
    } catch {
      setError("Verification service is unavailable. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="mx-auto max-w-lg rounded-3xl border border-[#E2E4F0] bg-white p-7 shadow-sm">
      <CheckCircle2 size={32} className="text-[#0877ff]" />
      <h1 className="font-display mt-5 text-[32px] font-semibold">Verify your email</h1>
      <p className="mt-3 text-sm leading-relaxed text-[#5B6080]">
        Complete the email verification to enable your owner login. You'll review and authorize your subscription after you sign in; this step does not charge your payment method.
      </p>
      {error && <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error}</p>}
      <button type="button" disabled={!token || busy} onClick={() => void confirm()} className="mt-6 flex min-h-[50px] w-full items-center justify-center gap-2 rounded-full bg-[#0877ff] px-5 font-semibold text-white disabled:opacity-50">
        {busy ? "Verifying…" : "Verify and continue"} <ArrowRight size={17} />
      </button>
      <p className="mt-4 flex gap-2 text-xs text-[#6B718C]"><ShieldCheck size={16} /> Single-use verification link. Expires after one hour.</p>
      <Link className="mt-4 inline-block text-sm font-semibold text-[#0868dc]" href="/login">Back to sign in</Link>
    </article>
  );
}
