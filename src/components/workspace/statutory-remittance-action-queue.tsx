"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCcw, UserCheck } from "lucide-react";
import type { Notify } from "./types";
import { Spinner, Status } from "./ui";
import { isValidRemittanceQueuePayload } from "@/lib/statutory-remittance-queue-payload";

type ActionTask = {
  id: number;
  sourceKey: string;
  agency: string | null;
  applicableMonth: string | null;
  severity: "danger" | "warning" | "info";
  title: string;
  detail: string;
  dueDate: string | null;
  status: "open" | "in_progress" | "resolved";
  assignedToUserId: number | null;
  assignedToName: string | null;
  acknowledgedByName: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  ageHours: number;
  severityAgeHours: number;
  escalationStage: 0 | 1 | 2 | 3;
};

type Assignee = {
  userId: number;
  role: string;
  name: string;
};

type QueuePayload = {
  organizationId: number;
  currentUserId: number;
  tasks: ActionTask[];
  assignees: Assignee[];
};

function severityLabel(value: ActionTask["severity"]) {
  if (value === "danger") return "Critical";
  if (value === "warning") return "Due soon";
  return "Watch";
}

export function StatutoryRemittanceActionQueue(props: {
  organizationId: number;
  notify: Notify;
  readOnlyOnOpen?: boolean;
}) {
  // Employer scope is tenant-private. Remount on a new organizationId so no
  // task or assignee state from the previous employer can render.
  return <StatutoryRemittanceActionQueueContent key={props.organizationId} {...props} />;
}

function StatutoryRemittanceActionQueueContent({
  organizationId,
  notify,
  readOnlyOnOpen = false,
}: {
  organizationId: number;
  notify: Notify;
  readOnlyOnOpen?: boolean;
}) {
  const [payload, setPayload] = useState<QueuePayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [readError, setReadError] = useState("");
  const [reading, setReading] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setReading(true);
    try {
      const response = await fetch(
        `/api/compliance/remittance-actions?organizationId=${organizationId}`,
        { cache: "no-store", signal },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error ?? "Could not load compliance actions.");
      if (!isValidRemittanceQueuePayload(body, organizationId)) {
        throw new Error("The compliance queue response could not be verified.");
      }
      if (signal?.aborted) return;
      setPayload(body as QueuePayload);
      setReadError("");
    } catch (error) {
      if (!signal?.aborted) setReadError(error instanceof Error ? error.message : "Read failed.");
      throw error;
    } finally {
      if (!signal?.aborted) setReading(false);
    }
  }, [organizationId]);

  const sync = useCallback(async (quiet = false) => {
    setBusy("sync");
    try {
      const response = await fetch("/api/compliance/remittance-actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, action: "sync" }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error ?? "Could not synchronize compliance actions.");
      if (!isValidRemittanceQueuePayload(body, organizationId)) {
        throw new Error("The synchronized compliance queue could not be verified.");
      }
      setPayload(body as QueuePayload);
      setReadError("");
      if (!quiet && body.sync) {
        const changed = Number(body.sync.created ?? 0) + Number(body.sync.reopened ?? 0) + Number(body.sync.resolved ?? 0);
        notify(changed ? "Compliance action queue synchronized." : "Compliance action queue is already current.", "ok");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not synchronize compliance actions.";
      setReadError(message);
      notify(message, "err");
    } finally {
      setBusy(null);
    }
  }, [notify, organizationId]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const read = () => void load(controller.signal).catch(error => {
      if (active && !controller.signal.aborted) setReadError(error instanceof Error ? error.message : "Could not load compliance actions.");
    });
    // The initial sync runs after effect setup, never in its synchronous phase.
    // Strict Mode cleanup can cancel this scheduled sync before it starts.
    queueMicrotask(() => {
      if (active) {
        if (readOnlyOnOpen) read();
        else void sync(true);
      }
    });
    const onChanged = () => { if (readOnlyOnOpen) read(); else void sync(true); };
    window.addEventListener("statutory-remittance-changed", onChanged);
    return () => {
      active = false;
      controller.abort();
      window.removeEventListener("statutory-remittance-changed", onChanged);
    };
  }, [sync, load, readOnlyOnOpen]);

  async function mutate(
    action: "assign" | "acknowledge",
    taskId: number,
    extra: Record<string, unknown>,
    success: string,
  ) {
    setBusy(`${action}:${taskId}`);
    try {
      const response = await fetch("/api/compliance/remittance-actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, action, taskId, ...extra }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not update compliance action.");
      notify(success, "ok");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not update compliance action.", "err");
    } finally {
      setBusy(null);
    }
  }

  const active = useMemo(
    () => (payload?.tasks ?? []).filter((task) => task.status !== "resolved"),
    [payload],
  );
  const recentlyResolved = useMemo(
    () => (payload?.tasks ?? []).filter((task) => task.status === "resolved").slice(0, 5),
    [payload],
  );

  return (
    <article className="card" style={{ marginBottom: 16 }} data-remittance-action-queue>
      <div className="card-header">
        <div>
          <div className="card-kicker">COMPLIANCE ACTION QUEUE</div>
          <h2>Someone must own every unresolved remittance risk.</h2>
          <p>
            Actions are created from live statutory evidence and resolve automatically only when the underlying payment or posting issue clears.
          </p>
        </div>
        <button className="secondary-button" onClick={() => void sync(false)} disabled={busy !== null}>
          {busy === "sync" ? <Spinner label="Syncing" /> : <RefreshCcw size={14} />} Sync
        </button>
      </div>

      <div className="card-body" style={{ paddingTop: 0, display: "grid", gap: 14 }}>
        {(reading || payload === null || readError) ? (
          <div>
            {readError ? <>
              <p role="alert">Could not verify statutory compliance actions: {readError}</p>
              {readOnlyOnOpen ? (
                <button type="button" className="secondary-button"
                  onClick={() => { setReadError(""); void load().catch(() => {}); }}>
                  Retry reading actions
                </button>
              ) : (
                <button type="button" className="secondary-button" disabled={busy !== null}
                  onClick={() => { setReadError(""); void sync(false); }}>
                  Retry synchronizing actions
                </button>
              )}
            </> : <p role="status">Loading or verifying statutory compliance actions…</p>}
          </div>
        ) : active.length === 0 ? (
          <div className="notice notice-green" style={{ margin: 0 }}>
            <CheckCircle2 size={15} />
            <span><strong>No unresolved statutory remittance actions.</strong> The tracked queue is clear.</span>
          </div>
        ) : (
          <div className="data-table-wrap slim-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Risk</th>
                  <th>Agency / month</th>
                  <th>Due</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Escalation</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {active.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <strong>{task.title}</strong>
                      <small style={{ display: "block", color: "var(--muted)", maxWidth: 420 }}>{task.detail}</small>
                    </td>
                    <td>{task.agency ?? "Statutory"}{task.applicableMonth ? ` · ${task.applicableMonth}` : ""}</td>
                    <td>{task.dueDate ?? "Needs employer data"}</td>
                    <td>
                      <select
                        value={task.assignedToUserId ?? ""}
                        disabled={busy !== null}
                        onChange={(event) => {
                          const value = event.target.value ? Number(event.target.value) : null;
                          void mutate(
                            "assign",
                            task.id,
                            { assignedToUserId: value },
                            value ? "Compliance action assigned." : "Compliance action unassigned.",
                          );
                        }}
                      >
                        <option value="">Unassigned</option>
                        {(payload?.assignees ?? []).map((person) => (
                          <option key={person.userId} value={person.userId}>
                            {person.name} · {person.role}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <Status value={severityLabel(task.severity)} />
                      <small style={{ display: "block", color: "var(--muted)", marginTop: 4 }}>
                        {task.status === "in_progress" ? "In progress" : "Open"}
                      </small>
                    </td>
                    <td>
                      <strong>
                        {task.escalationStage >= 3
                          ? "Executive"
                          : task.escalationStage === 2
                            ? "24h follow-up"
                            : "Initial"}
                      </strong>
                      <small style={{ display: "block", color: "var(--muted)", marginTop: 4 }}>
                        Open {task.ageHours}h · current risk level {task.severityAgeHours}h
                        {task.escalationStage === 1
                          ? ` · next follow-up in ${Math.max(0, 24 - task.severityAgeHours)}h`
                          : task.escalationStage === 2
                            ? ` · executive escalation in ${Math.max(0, 72 - task.severityAgeHours)}h`
                            : " · highest escalation stage"}
                      </small>
                    </td>
                    <td>
                      {task.status === "open" ? (
                        task.assignedToUserId == null || task.assignedToUserId === payload?.currentUserId ? (
                          <button
                            className="secondary-button"
                            disabled={busy !== null}
                            onClick={() => void mutate(
                              "acknowledge",
                              task.id,
                              {},
                              "Compliance action acknowledged and marked in progress.",
                            )}
                          >
                            {busy === `acknowledge:${task.id}` ? <Spinner label="Saving" /> : <UserCheck size={14} />}
                            {task.assignedToUserId == null ? "Take ownership" : "Start work"}
                          </button>
                        ) : (
                          <span className="id">
                            Assigned to {task.assignedToName ?? "another payroll operator"}
                          </span>
                        )
                      ) : (
                        <span className="id">
                          {task.assignedToName ?? task.acknowledgedByName ?? "Payroll"} is working this
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {active.some((task) => task.severity === "danger") && (
          <div className="notice notice-red" style={{ margin: 0 }}>
            <AlertTriangle size={15} />
            <span>
              Critical remittance actions cannot be manually closed. Record the missing payment/posting evidence or fix the underlying control to clear them.
            </span>
          </div>
        )}

        {recentlyResolved.length > 0 && (
          <div>
            <div className="card-kicker" style={{ marginBottom: 8 }}>Recently cleared automatically</div>
            <div className="policy-lines">
              {recentlyResolved.map((task) => (
                <span key={task.id}>
                  <b>{task.title}</b>
                  <small style={{ display: "block", color: "var(--muted)" }}>
                    {task.agency ?? "Statutory"}{task.applicableMonth ? ` · ${task.applicableMonth}` : ""} · resolved from underlying evidence
                  </small>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
