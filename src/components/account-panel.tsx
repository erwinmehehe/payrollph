"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  KeyRound,
  Laptop,
  LogOut,
  Monitor,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { passwordIssues } from "@/lib/validation";

type SessionRow = {
  id: number;
  label: string;
  current: boolean;
  active: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  ip: string | null;
  expiresAt: string;
  revokedAt: string | null;
};

type Account = {
  profile: { id: number; name: string; email: string; role: string; createdAt: string };
  security: { totpEnabled: boolean; backupCodes: number; sessionDays: number; accountLockedUntil: string | null };
  sessions: SessionRow[];
  summary: { total: number; active: number; otherActive: number; expired: number; revoked: number };
};

const fmt = (value: string | null) =>
  value ? new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "-";

async function json(res: Response) {
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

export function AccountPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);

  // Fetch lives inside the effect (not in a callback the effect calls) so React
  // never sets state synchronously during the effect body, and the `alive` flag
  // drops responses that arrive after unmount or a newer request.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/account", { cache: "no-store" });
        const { ok, data } = await json(res);
        if (!alive) return;
        if (!ok) {
          setError(data.error ?? "Could not load your account.");
          return;
        }
        setAccount(data);
        setError("");
      } catch {
        if (alive) setError("Could not reach the server.");
      }
    })();
    return () => { alive = false; };
  }, [nonce]);

  const load = useCallback(() => setNonce((n) => n + 1), []);

  if (error && !account) {
    return <div className="card" style={{ padding: 24 }}><span className="status status-failed">{error}</span></div>;
  }
  if (!account) {
    return <div className="card" style={{ padding: 24 }}><span className="heading-copy">Loading account…</span></div>;
  }

  return (
    <>
      <div className="setting-form" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
        <ReadOnly label="Signed in as" value={account.profile.email} />
        <ReadOnly label="Role" value={account.profile.role} />
        <ReadOnly label="Member since" value={fmt(account.profile.createdAt)} />
        <ReadOnly label="Session length" value={`${account.security.sessionDays} days`} />
      </div>

      <div style={{ display: "grid", gap: 14, padding: "6px 18px 18px" }}>
        <DisplayName current={account.profile.name} onDone={async () => { await load(); onNotice("Display name updated."); }} />
        <ChangeEmail current={account.profile.email} onDone={async () => { await load(); onNotice("Sign-in email updated. Other devices were signed out."); }} />
        <ChangePassword onDone={async () => { await load(); onNotice("Password updated. Other devices were signed out."); }} />
        <TwoFactor enabled={account.security.totpEnabled} backupCodes={account.security.backupCodes} onDone={async () => { await load(); onNotice("Two-factor authentication enabled."); }} />
        <SessionsPanel sessions={account.sessions} summary={account.summary} onChanged={load} onNotice={onNotice} />
      </div>
    </>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <label>
      {label}
      <input value={value} readOnly />
    </label>
  );
}

function Section({ title, copy, children }: { title: string; copy: string; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 14 }}>
      <div style={{ marginBottom: 10 }}>
        <strong style={{ fontSize: 12.5 }}>{title}</strong>
        <p style={{ margin: "2px 0 0", color: "var(--muted)", fontSize: 11 }}>{copy}</p>
      </div>
      {children}
    </div>
  );
}

function DisplayName({ current, onDone }: { current: string; onDone: () => void }) {
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    setBusy(true);
    setMsg("");
    const { ok, data } = await json(await fetch("/api/account/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }));
    setBusy(false);
    if (!ok) return setMsg(data.error ?? "Could not save.");
    onDone();
  }

  return (
    <Section title="Display name" copy="Shown on approvals and the audit trail.">
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label className="input-label" style={{ margin: 0, flex: 1, minWidth: 200 }}>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="secondary-button" disabled={busy || name.trim().length < 2} onClick={save}>
          {busy ? "Saving…" : "Save name"}
        </button>
      </div>
      {msg && <p style={{ color: "var(--danger)", fontSize: 11, margin: "8px 0 0" }}>{msg}</p>}
    </Section>
  );
}

function ChangeEmail({ current, onDone }: { current: string; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  async function save() {
    setBusy(true);
    setProblems([]);
    const { ok, data } = await json(await fetch("/api/account/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }));
    setBusy(false);
    if (!ok) return setProblems(data.problems ?? [data.error ?? "Could not change email."]);
    setPassword("");
    setEmail("");
    onDone();
  }

  return (
    <Section title="Sign-in email" copy="Changing this changes how you log in and where payslips are sent.">
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label className="input-label" style={{ margin: 0, flex: 1, minWidth: 180 }}>
          New email (now {current})
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@newdomain.com" />
        </label>
        <label className="input-label" style={{ margin: 0, width: 180 }}>
          Confirm password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        <button className="secondary-button" disabled={busy || !email || !password} onClick={save}>
          {busy ? "Updating…" : "Change email"}
        </button>
      </div>
      {problems.map((p) => <p key={p} style={{ color: "var(--danger)", fontSize: 11, margin: "6px 0 0" }}>{p}</p>)}
    </Section>
  );
}

function ChangePassword({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  // Must mirror src/lib/validation.ts so the UI never claims a password is
  // acceptable when the server will reject it.
  const checks = [
    { label: "At least 12 characters", ok: next.length >= 12 },
    { label: "Uppercase letter", ok: /[A-Z]/.test(next) },
    { label: "Lowercase letter", ok: /[a-z]/.test(next) },
    { label: "Number", ok: /[0-9]/.test(next) },
  ];

  async function save() {
    setBusy(true);
    setProblems([]);
    const { ok, data } = await json(await fetch("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: next, confirmPassword: confirm }),
    }));
    setBusy(false);
    if (!ok) return setProblems(data.problems ?? [data.error ?? "Could not change password."]);
    setCurrent(""); setNext(""); setConfirm("");
    onDone();
  }

  return (
    <Section title="Password" copy="You stay signed in here; every other device is signed out.">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8, alignItems: "flex-end" }}>
        <label className="input-label" style={{ margin: 0 }}>
          Current password
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </label>
        <label className="input-label" style={{ margin: 0 }}>
          New password
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </label>
        <label className="input-label" style={{ margin: 0 }}>
          Confirm new password
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </label>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "10px 0", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {checks.map((c) => (
            <span key={c.label} style={{ fontSize: 10.5, color: next && !c.ok ? "var(--danger)" : "var(--muted)", display: "inline-flex", gap: 4, alignItems: "center" }}>
              {c.ok ? <Check size={12} style={{ color: "var(--green)" }} /> : <span style={{ width: 12, height: 12, borderRadius: 99, border: "1px solid currentColor", display: "inline-block" }} />}
              {c.label}
            </span>
          ))}
        </div>
        <button className="primary-button" disabled={busy || !current || passwordIssues(next).length > 0 || next !== confirm} onClick={save}>
          <KeyRound size={14} className="i-amber" /> {busy ? "Updating…" : "Update password"}
        </button>
      </div>
      {problems.map((p) => <p key={p} style={{ color: "var(--danger)", fontSize: 11, margin: "4px 0 0" }}>{p}</p>)}
    </Section>
  );
}

function TwoFactor({ enabled, backupCodes, onDone }: { enabled: boolean; backupCodes: number; onDone: () => void }) {
  const [setup, setSetup] = useState<{ otpauthUri: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [codes, setCodes] = useState<string[]>([]);

  async function begin() {
    setBusy(true);
    const { ok, data } = await json(await fetch("/api/auth/totp/setup"));
    setBusy(false);
    if (!ok) return setMsg(data.error ?? "Could not start setup.");
    setSetup({ otpauthUri: data.otpauthUri, secret: data.secret });
  }

  async function verify() {
    setBusy(true);
    const { ok, data } = await json(await fetch("/api/auth/totp/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    }));
    setBusy(false);
    if (!ok) return setMsg(data.error ?? "Invalid code.");
    setCodes(data.backupCodes ?? []);
    setSetup(null);
    onDone();
  }

  return (
    <Section title="Two-factor authentication" copy="Time-based one-time codes. Optional today, not enforced for every role.">
      {enabled ? (
        <div className="notice notice-green" style={{ margin: 0 }}>
          <ShieldCheck size={16} className="i-green" />
          <span>
            <strong>Enabled.</strong> {backupCodes} single-use backup codes issued.
          </span>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {!setup ? (
              <button className="secondary-button" onClick={begin} disabled={busy}>
                <ShieldCheck size={14} className="i-green" /> {busy ? "Preparing…" : "Enable two-factor"}
              </button>
            ) : (
              <>
                <label className="input-label" style={{ margin: 0, width: 150 }}>
                  Authenticator code
                  <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="123456" />
                </label>
                <button className="primary-button" onClick={verify} disabled={busy || code.length < 6}>Verify &amp; enable</button>
                <button className="secondary-button" onClick={() => setSetup(null)}>Cancel</button>
              </>
            )}
          </div>
          {setup && (
            <div style={{ marginTop: 10 }}>
              <p style={{ fontSize: 11, color: "var(--muted)", margin: "0 0 4px" }}>Add this key to your authenticator app:</p>
              <code style={{ display: "block", padding: "8px 10px", background: "var(--canvas-subtle)", borderRadius: 6, fontSize: 10.5, wordBreak: "break-all" }}>{setup.otpauthUri}</code>
              <p style={{ fontSize: 11, color: "var(--muted)", margin: "6px 0 0" }}>Manual key: <code>{setup.secret}</code> (QR rendering is not built; the URI above works with any TOTP app.)</p>
            </div>
          )}
          {codes.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <p style={{ fontSize: 11, margin: "0 0 4px" }}><strong>Save these backup codes, shown once:</strong></p>
              <code style={{ display: "block", padding: 10, background: "var(--canvas-subtle)", borderRadius: 6, fontSize: 10.5 }}>{codes.join("  ")}</code>
            </div>
          )}
          {msg && <p style={{ color: "var(--danger)", fontSize: 11, margin: "8px 0 0" }}>{msg}</p>}
        </>
      )}
    </Section>
  );
}

function SessionsPanel({ sessions, summary, onChanged, onNotice }: {
  sessions: SessionRow[];
  summary: Account["summary"];
  onChanged: () => void;
  onNotice: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function revoke(id?: number) {
    setBusy(true);
    const { ok, data } = await json(await fetch("/api/account/sessions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(id ? { id } : { all: true }),
    }));
    setBusy(false);
    if (!ok) return onNotice(data.error ?? "Could not revoke.");
    onNotice(id ? "Session revoked, that device is signed out." : `${data.revoked} other session(s) revoked.`);
    onChanged();
  }

  const Icon = ({ label }: { label: string }) =>
    /iOS|Android/i.test(label) ? <Laptop size={14} className="i-blue" /> : <Monitor size={14} className="i-blue" />;

  return (
    <Section title="Active sessions" copy="Devices signed in to this account. Revoking signs that device out immediately.">
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 10.5, color: "var(--muted)", marginBottom: 10 }}>
        <span><strong style={{ color: "var(--ink)" }}>{summary.active}</strong> active</span>
        <span><strong style={{ color: "var(--ink)" }}>{summary.otherActive}</strong> on other devices</span>
        <span><strong style={{ color: "var(--ink)" }}>{summary.revoked}</strong> revoked</span>
        {summary.expired > 0 && <span><strong style={{ color: "var(--ink)" }}>{summary.expired}</strong> expired</span>}
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        {sessions.filter((s) => s.active || s.current).map((s) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, background: s.current ? "var(--green-light)" : "white" }}>
            <span style={{ color: s.current ? "var(--green)" : "var(--muted)" }}><Icon label={s.label} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ fontSize: 11.5 }}>{s.label}{s.current && " · this device"}</strong>
              <p style={{ margin: 0, fontSize: 10.5, color: "var(--muted)" }}>
                {s.ip ? `${s.ip} · ` : ""}last seen {fmt(s.lastSeenAt)} · expires {fmt(s.expiresAt)}
              </p>
            </div>
            {!s.current && (
              <button className="icon-button" title="Revoke this session" disabled={busy} onClick={() => revoke(s.id)}>
                <LogOut size={15} className="i-slate" />
              </button>
            )}
          </div>
        ))}
      </div>

      {summary.otherActive > 0 && (
        <button className="secondary-button" style={{ marginTop: 10 }} disabled={busy} onClick={() => revoke()}>
          <Trash2 size={14} className="i-red" /> Sign out {summary.otherActive} other device{summary.otherActive > 1 ? "s" : ""}
        </button>
      )}
    </Section>
  );
}
