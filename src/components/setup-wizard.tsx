"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";

export function SetupWizard({ needsSetup }: { needsSetup: boolean }) {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    setProblems([]);
    const response = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyName, name, email, password }),
    });
    const payload = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(payload.error ?? "Setup failed.");
      setProblems(payload.problems ?? []);
      return;
    }
    router.push("/");
    router.refresh();
  }

  const rules = [
    { label: "12+ characters", ok: password.length >= 12 },
    { label: "Uppercase", ok: /[A-Z]/.test(password) },
    { label: "Lowercase", ok: /[a-z]/.test(password) },
    { label: "Number", ok: /[0-9]/.test(password) },
  ];

  return (
    <main className="content-area" style={{ maxWidth: 560, paddingTop: 60 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
        <div className="brand-mark" style={{ background: "#123c35", color: "#cbe7dc" }}><span>sa</span></div>
        <strong style={{ fontSize: 19, letterSpacing: "-.03em" }}>linaw</strong>
      </div>

      {!needsSetup ? (
        <article className="card" style={{ padding: 22 }}>
          <div className="card-kicker">ALREADY SET UP</div>
          <h1 style={{ fontSize: 21, letterSpacing: "-.03em", marginTop: 6 }}>This workspace already has an owner.</h1>
          <p className="heading-copy">For security, the setup wizard only runs on an empty instance. Sign in instead, or ask an existing admin to send an invitation.</p>
          <Link className="primary-button" href="/" style={{ marginTop: 16, display: "inline-flex" }}>Go to sign in</Link>
        </article>
      ) : (
        <>
          <p className="eyebrow">FIRST-RUN SETUP</p>
          <h1 style={{ fontSize: 27, letterSpacing: "-.045em", margin: "4px 0 8px" }}>Create your workspace owner</h1>
          <p className="heading-copy">No accounts are pre-seeded. The first person to set up this instance becomes its owner.</p>

          <article className="card" style={{ marginTop: 20 }}>
            <div className="setting-form" style={{ gridTemplateColumns: "1fr", display: "grid" }}>
              <label>Company name<input value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Loom & Local" /></label>
              <label>Your name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Celine Yao" /></label>
              <label>Work email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.ph" /></label>
              <label>Master password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            </div>
            <div style={{ padding: "0 17px 12px", display: "flex", gap: 12, flexWrap: "wrap" }}>
              {rules.map((rule) => (
                <span key={rule.label} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: rule.ok ? "#23735d" : "#8a948f", fontWeight: 700 }}>
                  <Check size={12} /> {rule.label}
                </span>
              ))}
            </div>
            {error && <div className="notice notice-amber" style={{ margin: "0 16px 12px" }}><ShieldCheck size={16} /><span><strong>{error}</strong>{problems.length > 0 && <><br />{problems.join(" ")}</>}</span></div>}
            <button className="card-action" onClick={submit} disabled={busy}>
              <span>{busy ? "Creating workspace…" : "Create workspace"}</span>
              <Sparkles size={16} />
            </button>
          </article>

          <div className="notice notice-blue" style={{ margin: "16px 0 0" }}>
            <ShieldCheck size={17} />
            <span><strong>After setup:</strong> enable TOTP in Settings → Security, then invite your team. Password resets need an email provider (RESEND_API_KEY or POSTMARK_SERVER_TOKEN) to send mail.</span>
          </div>
        </>
      )}
    </main>
  );
}
