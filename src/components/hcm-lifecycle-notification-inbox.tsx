"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BellRing, CheckCircle2, Clock3, RefreshCw, UserRoundCog } from "lucide-react";
import { HcmEmploymentDecisionEvidence } from "@/components/hcm-employment-decision-evidence";

type LifecycleTask = {
  id: number;
  employeeId: number;
  sourceType: string;
  sourceId: number | null;
  employeeNo: string;
  employeeName: string;
  action: string;
  stage: string;
  escalationStage: number;
  severity: "info" | "warning" | "blocker";
  title: string;
  detail: string;
  dueDate: string | null;
  status: "open" | "acknowledged" | "snoozed" | "resolved";
  ownerUserId: number | null;
  ownerName: string | null;
  snoozeUntil: string | null;
  lastNotifiedAt: string | null;
};

type Owner = {
  userId: number;
  name: string;
  email: string;
  role: string;
};

type Payload = {
  tasks: LifecycleTask[];
  owners: Owner[];
  canAssign: boolean;
};

function readable(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function HcmLifecycleNotificationInbox({
  organizationId,
  onOpenEmployee,
  onOpenSeparation,
}: {
  organizationId: number;
  onOpenEmployee: (employeeId: number) => void;
  onOpenSeparation: () => void;
}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [evidenceDecisionId, setEvidenceDecisionId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(
        `/api/hcm/lifecycle-notifications?organizationId=${organizationId}`,
        { cache: "no-store" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not load lifecycle notifications.");
      setPayload(data as Payload);
    } catch (loadError) {
      setPayload(null);
      setError(loadError instanceof Error ? loadError.message : "Could not load lifecycle notifications.");
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(taskId: number, action: string, extra: Record<string, unknown> = {}) {
    setBusyId(taskId);
    setError("");
    try {
      const response = await fetch("/api/hcm/lifecycle-notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, taskId, action, ...extra }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not update lifecycle notification.");
      await load();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Could not update lifecycle notification.");
    } finally {
      setBusyId(null);
    }
  }

  const tasks = payload?.tasks ?? [];
  const urgent = tasks.filter((task) => task.status === "open" && task.severity === "blocker").length;
  const unassigned = tasks.filter((task) => !task.ownerUserId).length;
  const escalated = tasks.filter((task) => task.escalationStage >= 2 && task.status !== "resolved").length;
  const snoozed = tasks.filter((task) => task.status === "snoozed").length;

  return (
    <section className="card" style={{ marginBottom: 18 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">HCM CORE 3.4 · NOTIFICATIONS &amp; OWNERSHIP</div>
          <h2>Lifecycle notification inbox</h2>
          <p>
            Milestone reminders are deduplicated and auditable. Acknowledgement or snooze never changes employment terms,
            decisions, worker status, or Separation.
          </p>
        </div>
        <button className="secondary-button" onClick={() => void load()}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && <div className="notice notice-amber" style={{ marginBottom: 12 }}><AlertTriangle size={15} /><span>{error}</span></div>}

      <div className="stats-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", marginBottom: 14 }}>
        <article className="stat-card">
          <div className="stat-icon orange"><BellRing size={18} /></div>
          <p>URGENT OPEN</p>
          <h3>{urgent}</h3>
          <span>Due, overdue, or failed</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon purple"><UserRoundCog size={18} /></div>
          <p>UNASSIGNED</p>
          <h3>{unassigned}</h3>
          <span>Needs an accountable owner</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon orange"><AlertTriangle size={18} /></div>
          <p>ESCALATED</p>
          <h3>{escalated}</h3>
          <span>Overdue lifecycle actions</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon blue"><Clock3 size={18} /></div>
          <p>SNOOZED</p>
          <h3>{snoozed}</h3>
          <span>Reopens on expiry or stage change</span>
        </article>
      </div>

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>EMPLOYEE</th>
              <th>REMINDER</th>
              <th>OWNER</th>
              <th>STATUS</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 && (
              <tr><td colSpan={5}><div className="empty-state">No active lifecycle notification tasks.</div></td></tr>
            )}
            {tasks.map((task) => (
              <tr key={task.id}>
                <td>
                  <strong>{task.employeeName}</strong>
                  <small style={{ display: "block", color: "var(--muted)" }}>{task.employeeNo}</small>
                </td>
                <td>
                  <strong>{task.title}</strong>
                  <small style={{ display: "block", color: "var(--muted)", maxWidth: 430 }}>
                    {task.detail}
                  </small>
                  <small style={{ display: "block", color: "var(--muted)" }}>
                    {readable(task.stage)}
                    {task.dueDate ? ` · due ${task.dueDate}` : ""}
                    {task.escalationStage >= 2 ? ` · escalation ${task.escalationStage}` : ""}
                  </small>
                </td>
                <td>
                  {payload?.canAssign ? (
                    <select
                      value={task.ownerUserId ?? ""}
                      disabled={busyId === task.id}
                      onChange={(event) => {
                        const ownerUserId = Number(event.target.value);
                        if (Number.isInteger(ownerUserId) && ownerUserId > 0) {
                          void mutate(task.id, "assign", { ownerUserId });
                        }
                      }}
                    >
                      <option value="">Unassigned</option>
                      {payload.owners.map((owner) => (
                        <option key={owner.userId} value={owner.userId}>
                          {owner.name} · {readable(owner.role)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    task.ownerName ?? "Assigned to you"
                  )}
                </td>
                <td>
                  <span className={
                    task.status === "open" && task.severity === "blocker"
                      ? "status status-needs-review"
                      : task.status === "acknowledged"
                        ? "status status-approved"
                        : "status"
                  }>
                    {readable(task.status)}
                  </span>
                  {task.snoozeUntil && (
                    <small style={{ display: "block", color: "var(--muted)" }}>
                      until {new Date(task.snoozeUntil).toLocaleString()}
                    </small>
                  )}
                </td>
                <td>
                  <div className="run-actions">
                    <button
                      className="secondary-button"
                      disabled={busyId === task.id}
                      onClick={() => {
                        if (task.action === "start_separation" || task.action === "continue_separation") onOpenSeparation();
                        else onOpenEmployee(task.employeeId);
                      }}
                    >
                      Open
                    </button>
                    {task.sourceId && ["employment_decision", "separation_handoff"].includes(task.sourceType) && (
                      <button
                        className="secondary-button"
                        disabled={busyId === task.id}
                        onClick={() => setEvidenceDecisionId(task.sourceId)}
                      >
                        Evidence
                      </button>
                    )}
                    {task.status !== "acknowledged" && (
                      <button
                        className="secondary-button"
                        disabled={busyId === task.id}
                        onClick={() => void mutate(task.id, "acknowledge")}
                      >
                        <CheckCircle2 size={13} /> Acknowledge
                      </button>
                    )}
                    <select
                      value=""
                      disabled={busyId === task.id}
                      aria-label={`Snooze ${task.employeeName} lifecycle reminder`}
                      onChange={(event) => {
                        const days = Number(event.target.value);
                        if ([1, 3, 7].includes(days)) void mutate(task.id, "snooze", { days });
                      }}
                    >
                      <option value="">Snooze…</option>
                      <option value="1">1 day</option>
                      <option value="3">3 days</option>
                      <option value="7">7 days</option>
                    </select>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {evidenceDecisionId && (
        <div style={{ marginTop: 14 }}>
          <div className="run-actions" style={{ justifyContent: "flex-end" }}>
            <button className="secondary-button" onClick={() => setEvidenceDecisionId(null)}>Close evidence</button>
          </div>
          <HcmEmploymentDecisionEvidence
            organizationId={organizationId}
            decisionId={evidenceDecisionId}
            compact
            onChanged={load}
          />
        </div>
      )}

      <div className="modal-note" style={{ marginTop: 12 }}>
        Reminder milestones: T-30, T-14, T-7, T-1, due, overdue, and escalated overdue. A new stage reopens an acknowledged or snoozed task and creates a new dedupe episode.
      </div>
    </section>
  );
}
