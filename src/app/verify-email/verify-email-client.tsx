"use client";

import { useState } from "react";

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
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return <p style={{ margin: 0, color: "#9b2c2c" }}>This verification link is incomplete.</p>;
  }

  return (
    <div>
      <p style={{ margin: "0 0 18px", color: "#52605c", lineHeight: 1.6 }}>
        Confirming this link changes your Linaw sign-in email and signs out all existing sessions.
      </p>
      <button
        type="button"
        onClick={verify}
        disabled={busy || success}
        style={{
          border: 0,
          borderRadius: 12,
          padding: "11px 18px",
          background: "#176B5D",
          color: "white",
          fontWeight: 700,
          cursor: busy || success ? "default" : "pointer",
          opacity: busy || success ? 0.7 : 1,
        }}
      >
        {busy ? "Verifying…" : success ? "Email verified" : "Verify email"}
      </button>
      {message && (
        <p style={{ margin: "16px 0 0", color: success ? "#176B5D" : "#9b2c2c", lineHeight: 1.55 }}>
          {message}
        </p>
      )}
      {success && (
        <p style={{ margin: "12px 0 0" }}>
          <a href="/login" style={{ color: "#176B5D", fontWeight: 700 }}>Sign in again</a>
        </p>
      )}
    </div>
  );
}
