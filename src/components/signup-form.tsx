"use client";

import { useState } from "react";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";

export function SignupForm() {
  const [companyName, setCompanyName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<string[]>([]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setProblems([]);
    try {
      const response = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, name, email, password, website }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? "Could not create your workspace.");
        setProblems(payload.problems ?? []);
        return;
      }
      window.location.href = payload.redirectTo ?? "/";
    } finally {
      setBusy(false);
    }
  }

  const rules = [
    { label: "12+ characters", ok: password.length >= 12 },
    { label: "Uppercase", ok: /[A-Z]/.test(password) },
    { label: "Lowercase", ok: /[a-z]/.test(password) },
    { label: "Number", ok: /[0-9]/.test(password) },
  ];

  return (
    <form onSubmit={submit} className="card" style={{ padding: 22, display: "grid", gap: 14 }}>
      <div>
        <div className="card-kicker">CREATE YOUR WORKSPACE</div>
        <h2 style={{ margin: "6px 0 4px", fontSize: 22 }}>Start with your own company data</h2>
        <p className="heading-copy">14-day Core trial. No payment details required to create the workspace.</p>
      </div>
      <div className="setting-form" style={{ gridTemplateColumns: "1fr", display: "grid", gap: 12 }}>
        <label>Company name<input value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Acme Philippines" required /></label>
        <label>Your name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Juan Dela Cruz" required /></label>
        <label>Work email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.ph" autoComplete="email" required /></label>
        <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required /></label>
        <label style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }} aria-hidden="true">
          Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
        </label>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {rules.map((rule) => (
          <span key={rule.label} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: rule.ok ? "#23735d" : "#8a948f", fontWeight: 700 }}>
            <Check size={12} /> {rule.label}
          </span>
        ))}
      </div>
      {error && (
        <div className="notice notice-amber">
          <ShieldCheck size={16} />
          <span><strong>{error}</strong>{problems.length > 0 && <><br />{problems.join(" ")}</>}</span>
        </div>
      )}
      <button className="primary-button" style={{ minHeight: 42, justifyContent: "center" }} disabled={busy}>
        {busy ? "Creating workspace…" : "Create account"} <ArrowRight size={16} />
      </button>
      <p style={{ fontSize: 11, color: "var(--muted)", margin: 0, textAlign: "center" }}>
        Already have an account? <a href="/login" className="link-button">Sign in</a>
      </p>
    </form>
  );
}
