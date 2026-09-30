"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Check, KeyRound } from "lucide-react";
import Link from "next/link";

export function ResetPasswordForm() {
  const params = useSearchParams();
  const [token, setToken] = useState(params.get("token") ?? "");
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
    const response = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const payload = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(payload.error ?? "Reset failed.");
      return;
    }
    setDone(true);
  }

  return (
    <section className="auth-card">
      <div className="card-kicker">RESET PASSWORD</div>
      <h2>{done ? "Password updated" : "Choose a new password"}</h2>

      {done ? (
        <>
          <p className="auth-copy">Your password has been changed and every active session was signed out.</p>
          <Link className="primary-button full" href="/login" style={{ justifyContent: "center", display: "inline-flex" }}>
            Continue to sign in <ArrowRight size={16} />
          </Link>
        </>
      ) : (
        <form onSubmit={submit} className="auth-form">
          <p className="auth-copy">Paste the token from your reset email. It expires 30 minutes after the request and works once.</p>
          <label>Reset token<input value={token} onChange={(event) => setToken(event.target.value)} placeholder="Paste from email" autoComplete="off" /></label>
          <label>New password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></label>
          <label>Confirm new password<input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" /></label>

          <div className="pw-rules">
            {rules.map((rule) => (
              <span key={rule.label} style={{ color: rule.ok ? "#23735d" : "#8a948f" }}>
                <Check size={12} className="i-green" /> {rule.label}
              </span>
            ))}
          </div>

          {error && <div className="notice notice-amber"><KeyRound size={15} className="i-amber" /><span><strong>{error}</strong>{problems.length > 0 && <><br />{problems.join(" ")}</>}</span></div>}
          <button className="primary-button full" disabled={busy || !token}>Update password</button>
          <Link className="link-button" href="/login">Back to sign in</Link>
        </form>
      )}
    </section>
  );
}
