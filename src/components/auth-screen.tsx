"use client";

import { useState } from "react";
import { ArrowRight, Calculator, CheckCircle2, KeyRound, LockKeyhole, ShieldCheck, Sparkles, UserCheck, Wallet } from "lucide-react";

type Mode = "login" | "forgot" | "reset";

export function AuthScreen({ demoMode = false, setupAvailable = false }: { demoMode?: boolean; setupAvailable?: boolean }) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [requiresTotp, setRequiresTotp] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const [message, setMessage] = useState("Enter your work email and password. TOTP is required after password success when enabled.");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [demoLaunching, setDemoLaunching] = useState<string | null>(null);

  async function login(event: React.FormEvent) {
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

  async function forgot(event: React.FormEvent) {
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
      setMessage(delivery?.configured
        ? "Check your email for a reset link. The link expires in 30 minutes."
        : `Reset link queued in database outbox (${delivery?.reason ?? "no email provider"}). An administrator can retrieve it from the outbox.`);
      setResetToken("");
    } finally {
      setBusy(false);
    }
  }

  async function quickDemo(role: "bookkeeper" | "employee" | "freelancer") {
    setDemoLaunching(role);
    try {
      const res = await fetch("/api/auth/demo-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (res.ok) {
        window.location.href = "/app";
      }
    } catch {
      setError("Could not switch role.");
    } finally {
      setDemoLaunching(null);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-hero">
        <div className="brand-mark large">sa</div>
        <p className="eyebrow" style={{ color: "#8eb7a8" }}>LINAW · PHILIPPINE HR & PAYROLL</p>
        <h1>People, paid right. Built for every tier.</h1>
        <p>Bookkeepers, solo freelancers, and multi-branch enterprises share one resilient platform, complexity stays opt-in.</p>
        
        <div className="auth-points">
          <div><ShieldCheck size={16} className="i-green" /><span>Real password hashing, lockout, and TOTP challenge</span></div>
          <div><LockKeyhole size={16} className="i-amber" /><span>Server-side revocable sessions</span></div>
          <div><KeyRound size={16} className="i-amber" /><span>Rate limiting is distributed across app instances</span></div>
          <div><ShieldCheck size={16} className="i-green" /><span>TOTP available per account, not mandatory for every role</span></div>
        </div>

        {/* 1-Click Interactive Launchers */}
        <div style={{ marginTop: 36, padding: "18px 20px", borderRadius: 12, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, color: "#50d29d", fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            <Sparkles size={14} className="i-blue" /> Instant 1-Click Sandbox Sign-In
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              type="button"
              className="primary-button"
              style={{ background: "#50d29d", color: "#0e2e28", borderColor: "#50d29d", justifyContent: "flex-start", height: 38 }}
              onClick={() => quickDemo("bookkeeper")}
              disabled={demoLaunching !== null}
            >
              <UserCheck size={16} className="i-purple" /> <strong>Principal Bookkeeper (Celine Yao)</strong>, 4 Clients
            </button>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button
                type="button"
                className="secondary-button"
                style={{ background: "rgba(255,255,255,0.1)", color: "white", borderColor: "rgba(255,255,255,0.2)", justifyContent: "center" }}
                onClick={() => quickDemo("employee")}
                disabled={demoLaunching !== null}
              >
                <Wallet size={14} className="i-green" /> Employee Portal
              </button>
              <button
                type="button"
                className="secondary-button"
                style={{ background: "rgba(255,255,255,0.1)", color: "white", borderColor: "rgba(255,255,255,0.2)", justifyContent: "center" }}
                onClick={() => quickDemo("freelancer")}
                disabled={demoLaunching !== null}
              >
                <Calculator size={14} className="i-green" /> Solo Freelancer
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="auth-card">
        <div className="card-kicker">{mode === "login" ? "SIGN IN" : mode === "forgot" ? "FORGOT PASSWORD" : "RESET PASSWORD"}</div>
        <a className="link-button" href="/welcome" style={{ display: "inline-block", marginBottom: 10 }}>← Back to product page</a>
        <h2>{mode === "login" ? "Welcome back" : mode === "forgot" ? "Reset link" : "Choose a new password"}</h2>
        <p className="auth-copy">{message}</p>
        
        {error && <div className="notice notice-amber" style={{ margin: "0 0 14px" }}><span>{error}</span></div>}

        {setupAvailable && (
          <div className="notice notice-blue" style={{ margin: "0 0 14px" }}>
            <ShieldCheck size={15} className="i-green" />
            <span>This workspace has no accounts yet. <a href="/setup" style={{ textDecoration: "underline", fontWeight: 700 }}>Create the owner account</a> to begin.</span>
          </div>
        )}

        {mode === "login" && (
          <form onSubmit={login} className="auth-form">
            <label>Work Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.ph" autoComplete="username" required /></label>
            <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••••" autoComplete="current-password" required /></label>
            {requiresTotp && (
              <label>
                Authenticator code
                <input value={totpCode} onChange={(e) => setTotpCode(e.target.value)} placeholder="6-digit TOTP" inputMode="numeric" />
                <small>Password succeeded. Session is created only after TOTP verification.</small>
              </label>
            )}
            <button className="primary-button full" disabled={busy} style={{ height: 40, marginTop: 4 }}>
              {requiresTotp ? "Verify & sign in" : "Sign in"} <ArrowRight size={16} />
            </button>
            <button type="button" className="link-button" onClick={() => setMode("forgot")} style={{ textAlign: "center", marginTop: 4 }}>Forgot password?</button>
          </form>
        )}

        {mode === "forgot" && (
          <form onSubmit={forgot} className="auth-form">
            <label>Work Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.ph" required /></label>
            <button className="primary-button full" disabled={busy} style={{ height: 40, marginTop: 4 }}>Send reset link</button>
            <button type="button" className="link-button" onClick={() => setMode("login")} style={{ textAlign: "center", marginTop: 4 }}>Back to sign in</button>
          </form>
        )}

        {demoMode && (
          <div className="auth-demo">
            <strong>Standard Test Account:</strong>
            <span><code>celine@linaw.ph</code> / <code>LinawDemo2026!</code></span>
            <span>Password only, TOTP is available per account, not forced on this one.</span>
          </div>
        )}
      </section>
    </main>
  );
}
