"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, History, RefreshCw, Save, Settings2, ShieldCheck } from "lucide-react";

type Policy = {
  id: number | null;
  version: number;
  persisted: boolean;
  actionWindowDays: number;
  reminderDays: number[];
  overdueEscalationDays: [number, number];
  requireManagerReviewForProbation: boolean;
  requireDecisionRationaleNote: boolean;
  requireNonRenewalAttachment: boolean;
  updatedByName: string | null;
  updatedAt: string | null;
};

type PolicyEvent = {
  id: number;
  eventType: string;
  actorName: string;
  fromVersion: number | null;
  toVersion: number;
  createdAt: string;
};

type PolicyPayload = {
  policy: Policy;
  history: PolicyEvent[];
  canManage: boolean;
};

function csvNumbers(value: string) {
  return value.split(",").map((part) => Number(part.trim())).filter((value) => Number.isFinite(value));
}

export function HcmLifecyclePolicyPanel({ organizationId }: { organizationId: number }) {
  const [payload, setPayload] = useState<PolicyPayload | null>(null);
  const [form, setForm] = useState({
    actionWindowDays: "30",
    reminderDays: "30, 14, 7, 1, 0",
    overdueEscalationDays: "1, 5",
    requireManagerReviewForProbation: false,
    requireDecisionRationaleNote: false,
    requireNonRenewalAttachment: false,
  });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(
        `/api/hcm/lifecycle-policy?organizationId=${organizationId}`,
        { cache: "no-store" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not load lifecycle policy.");
      const next = body as PolicyPayload;
      setPayload(next);
      setForm({
        actionWindowDays: String(next.policy.actionWindowDays),
        reminderDays: next.policy.reminderDays.join(", "),
        overdueEscalationDays: next.policy.overdueEscalationDays.join(", "),
        requireManagerReviewForProbation: next.policy.requireManagerReviewForProbation,
        requireDecisionRationaleNote: next.policy.requireDecisionRationaleNote,
        requireNonRenewalAttachment: next.policy.requireNonRenewalAttachment,
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load lifecycle policy.");
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!payload) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/hcm/lifecycle-policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          expectedVersion: payload.policy.version,
          actionWindowDays: Number(form.actionWindowDays),
          reminderDays: csvNumbers(form.reminderDays),
          overdueEscalationDays: csvNumbers(form.overdueEscalationDays),
          requireManagerReviewForProbation: form.requireManagerReviewForProbation,
          requireDecisionRationaleNote: form.requireDecisionRationaleNote,
          requireNonRenewalAttachment: form.requireNonRenewalAttachment,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Lifecycle policy could not be saved.");
      setNotice("Lifecycle policy saved. Readiness, reminders, and future approvals now use this version.");
      setEditing(false);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Lifecycle policy could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const policy = payload?.policy;

  return (
    <section className="card" style={{ marginBottom: 18 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">HCM CORE 3.7 · LIFECYCLE POLICY</div>
          <h2>Employment lifecycle governance policy</h2>
          <p>
            Configure when lifecycle work becomes actionable, when reminders escalate, and which internal evidence controls
            must be satisfied before approval. These settings do not change employment status automatically.
          </p>
        </div>
        <div className="run-actions">
          <button className="secondary-button" type="button" onClick={() => void load()} disabled={busy}>
            <RefreshCw size={14} /> Refresh
          </button>
          {payload?.canManage && !editing && (
            <button className="primary-button" type="button" onClick={() => setEditing(true)}>
              <Settings2 size={14} /> Configure
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="notice notice-amber" style={{ marginBottom: 12 }}>
          <AlertTriangle size={15} /><span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="notice notice-green" style={{ marginBottom: 12 }}>
          <ShieldCheck size={15} /><span>{notice}</span>
        </div>
      )}

      {policy && !editing && (
        <>
          <div className="stats-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", marginBottom: 14 }}>
            <article className="stat-card">
              <p>ACTION WINDOW</p>
              <h3>{policy.actionWindowDays} days</h3>
              <span>Before review / term end</span>
            </article>
            <article className="stat-card">
              <p>REMINDERS</p>
              <h3>{policy.reminderDays.join(" / ")}</h3>
              <span>Days before due date</span>
            </article>
            <article className="stat-card">
              <p>OVERDUE ESCALATION</p>
              <h3>{policy.overdueEscalationDays.join(" / ")}</h3>
              <span>Days overdue</span>
            </article>
            <article className="stat-card">
              <p>POLICY VERSION</p>
              <h3>v{policy.version}</h3>
              <span>{policy.persisted ? "Organization policy" : "System defaults"}</span>
            </article>
          </div>

          <div className="data-table-wrap" style={{ marginBottom: 12 }}>
            <table className="data-table">
              <thead><tr><th>APPROVAL EVIDENCE CONTROL</th><th>SETTING</th></tr></thead>
              <tbody>
                <tr>
                  <td>Probation decisions require manager-review note</td>
                  <td>{policy.requireManagerReviewForProbation ? "Required" : "Optional"}</td>
                </tr>
                <tr>
                  <td>All employment decisions require rationale note</td>
                  <td>{policy.requireDecisionRationaleNote ? "Required" : "Optional"}</td>
                </tr>
                <tr>
                  <td>Non-renewal requires at least one evidence attachment</td>
                  <td>{policy.requireNonRenewalAttachment ? "Required" : "Optional"}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="notice notice-blue" style={{ marginBottom: 12 }}>
            <ShieldCheck size={15} />
            <span>
              These are organization-defined workflow controls, not a legal sufficiency test. PayrollPH still requires an
              explicit governed decision and never auto-regularizes, auto-renews, or auto-separates a worker from a date.
            </span>
          </div>

          {payload.history.length > 0 && (
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>
                <History size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
                Policy change history
              </summary>
              <div className="data-table-wrap" style={{ marginTop: 10 }}>
                <table className="data-table">
                  <thead><tr><th>VERSION</th><th>CHANGE</th><th>ACTOR</th><th>WHEN</th></tr></thead>
                  <tbody>
                    {payload.history.slice(0, 10).map((event) => (
                      <tr key={event.id}>
                        <td>v{event.toVersion}</td>
                        <td>{event.eventType === "created" ? "Policy created" : `Updated from v${event.fromVersion}`}</td>
                        <td>{event.actorName}</td>
                        <td>{new Date(event.createdAt).toLocaleString("en-PH")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}

      {policy && editing && (
        <form onSubmit={save}>
          <div className="setting-form">
            <label>
              Action window (days)
              <input
                required
                type="number"
                min={7}
                max={90}
                value={form.actionWindowDays}
                onChange={(event) => setForm({ ...form, actionWindowDays: event.target.value })}
              />
              <small>Lifecycle dates enter the action center this many days before they are due.</small>
            </label>
            <label>
              Reminder milestones
              <input
                required
                value={form.reminderDays}
                onChange={(event) => setForm({ ...form, reminderDays: event.target.value })}
              />
              <small>Comma-separated days before due date; include 0. Example: 30, 14, 7, 1, 0.</small>
            </label>
            <label>
              Overdue escalation thresholds
              <input
                required
                value={form.overdueEscalationDays}
                onChange={(event) => setForm({ ...form, overdueEscalationDays: event.target.value })}
              />
              <small>Exactly two increasing overdue-day thresholds. Example: 1, 5.</small>
            </label>
          </div>

          <div style={{ display: "grid", gap: 10, margin: "14px 0" }}>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.requireManagerReviewForProbation}
                onChange={(event) => setForm({ ...form, requireManagerReviewForProbation: event.target.checked })}
              />
              Require a manager-review note before a probation decision can be approved.
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.requireDecisionRationaleNote}
                onChange={(event) => setForm({ ...form, requireDecisionRationaleNote: event.target.checked })}
              />
              Require a decision-rationale note before any employment decision can be approved.
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.requireNonRenewalAttachment}
                onChange={(event) => setForm({ ...form, requireNonRenewalAttachment: event.target.checked })}
              />
              Require at least one evidence attachment before a non-renewal can be approved.
            </label>
          </div>

          <div className="notice notice-amber" style={{ marginBottom: 12 }}>
            <AlertTriangle size={15} />
            <span>
              Tightening an evidence requirement affects future approval attempts immediately. Existing approved decisions
              remain sealed under the policy evidence captured when they were approved.
            </span>
          </div>

          <div className="run-actions">
            <button type="button" className="secondary-button" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
            <button className="primary-button" disabled={busy}>
              <Save size={14} /> {busy ? "Saving…" : "Save policy"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
