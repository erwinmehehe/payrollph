"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Check, Mail } from "lucide-react";
import Link from "next/link";

export function InviteAcceptForm() {
  const params = useSearchParams();
  const [token, setToken] = useState(params.get("token") ?? "");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<{ email: string; role: string } | null>(null);

  const rules = [
    { label: "12+ characters", ok: password.length >= 12 },
    { label: "Uppercase", ok: /[A-Z]/.test(password) },
    { label: "Lowercase", ok: /[a-z]/.test(password) },
    { label: "Number", ok: /[0-9]/.test(password) },
  ];

  async function verify() {
    if (!token) return;
    const response = await fetch(`/api/invitations/accept?token=${encodeURIComponent(token)}`);
    if (!response.ok) {
      setError("This invitation is invalid, already used, or expired.");
      return;
    }
    const payload = await response.json();
    setChecked({ email: payload.email, role: payload.role });
  }

  if (!checked && token && !error) void verify();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    const response = await fetch("/api/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, name, password }),
    });
    const payload = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(payload.error ?? "Could not accept this invitation.");
      return;
    }
    setDone(true);
    setTimeout(() => { window.location.href = "/"; }, 900);
  }

  if (!token) {
    return (
      <section className="auth-card">
        <div className="card-kicker">INVITATION</div>
        <h2>No invitation token</h2>
        <p className="auth-copy">Open the link from your invitation email, or ask your administrator to resend it.</p>
        <Link className="link-button" href="/">Back to sign in</Link>
      </section>
    );
  }

  return (
    <section className="auth-card">
      <div className="card-kicker">ACCEPT INVITATION</div>
      <h2>{done ? "You're in" : checked ? "Join your team" : "Checking invitation…"}</h2>

      {done ? (
        <p className="auth-copy">Account ready. Taking you to your workspace…</p>
      ) : (
        <form onSubmit={submit} className="auth-form">
          {checked && (
            <div className="notice notice-green"><Mail size={15} /><span><strong>{checked.email}</strong> · invited as {checked.role}</span></div>
          )}
          <label>Your name<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>
          <label>Create a password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></label>
          <label>Confirm password<input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" /></label>

          <div className="pw-rules">
            {rules.map((rule) => (
              <span key={rule.label} style={{ color: rule.ok ? "#23735d" : "#8a948f" }}>
                <Check size={12} /> {rule.label}
              </span>
            ))}
          </div>

          {error && <div className="notice notice-amber"><span>{error}</span></div>}
          <button className="primary-button full" disabled={busy || !checked}>Create account <ArrowRight size={16} /></button>
        </form>
      )}
    </section>
  );
}
