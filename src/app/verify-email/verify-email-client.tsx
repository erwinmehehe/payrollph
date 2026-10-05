"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, LoaderCircle } from "lucide-react";

export default function VerifyEmailClient({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);

  async function verify() {
    if (!token || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/account/email/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(data.error ?? "This verification link could not be completed.");
        return;
      }
      setSuccess(true);
      setMessage(data.message ?? "Email verified. Sign in again with your new address.");
    } catch {
      setMessage("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="rounded-2xl border border-[#FFD5DC] bg-[#FFF6F7] p-4 text-[13.5px] leading-relaxed text-[#9E2239]">
        This verification link is incomplete. Open the complete link from the email change message.
      </div>
    );
  }

  return (
    <div>
      <p className="text-[14px] leading-relaxed text-[#5B6080]">
        Confirming this change updates your Linaw sign-in email and signs out existing sessions.
      </p>

      <button
        type="button"
        onClick={verify}
        disabled={busy || success}
        className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-[12px] bg-[#6161FF] px-5 text-[13.5px] font-semibold text-white transition hover:brightness-95 disabled:cursor-default disabled:opacity-65"
      >
        {busy ? <LoaderCircle size={15} className="animate-spin" /> : success ? <Check size={15} /> : null}
        {busy ? "Verifying…" : success ? "Email verified" : "Verify email"}
      </button>

      {message && (
        <div className={`mt-4 rounded-2xl border p-4 text-[13px] leading-relaxed ${success ? "border-[#BDE9D5] bg-[#F1FBF6] text-[#176A4E]" : "border-[#FFD5DC] bg-[#FFF6F7] text-[#9E2239]"}`}>
          {message}
        </div>
      )}

      {success && (
        <Link href="/login" className="mt-5 inline-flex items-center gap-2 text-[13px] font-semibold text-[#4A4AE0]">
          Sign in again <ArrowRight size={14} />
        </Link>
      )}
    </div>
  );
}
