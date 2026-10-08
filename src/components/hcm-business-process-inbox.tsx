"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  CheckCircle2,
  Clock3,
  Inbox,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";

type WorkItem = {
  id: number;
  stepIndex: number;
  stepType: "approval" | "review" | "to_do";
  label: string;
  assignee: string;
  dueAt: string | null;
  approvalTaskId: number | null;
  instanceId: number;
  processType: string;
  processName: string;
  sourceType: string;
  sourceKey: string;
  effectiveDate: string | null;
  initiatedByName: string;
  makerBlocked: boolean;
  employee: null | {
    id: number;
    employeeNo: string;
    name: string;
    title: string;
  };
};

type ProcessRow = {
  id: number;
  processType: string;
  processName: string;
  status: string;
  effectiveDate: string | null;
  initiatedByName: string;
  initiatedAt: string;
  completedAt: string | null;
  employeeId: number | null;
};

type InboxPayload = {
  myWork: WorkItem[];
  submitted: ProcessRow[];
  recent: ProcessRow[];
};

type Tab = "work" | "submitted" | "recent";

function typeLabel(value: WorkItem["stepType"]) {
  if (value === "to_do") return "To do";
  if (value === "review") return "Review";
  return "Approval";
}

function statusTone(status: string) {
  if (status === "applied" || status === "approved") return "status-complete";
  if (status === "declined" || status === "failed") return "status-declined";
  if (status === "cancelled") return "status-muted";
  return "status-pending";
}

export function HcmBusinessProcessInbox({
  organizationId,
  onChanged,
}: {
  organizationId: number;
  onChanged?: () => Promise<unknown> | unknown;
}) {
  const [payload, setPayload] = useState<InboxPayload | null>(null);
  const [tab, setTab] = useState<Tab>("work");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/hcm/business-processes/inbox?organizationId=${organizationId}`,
        { cache: "no-store" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not load the HCM Inbox.");
      setPayload(data as InboxPayload);
    } catch (caught) {
      setPayload(null);
      setError(caught instanceof Error ? caught.message : "Could not load the HCM Inbox.");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => ({
    work: payload?.myWork.length ?? 0,
    submitted: payload?.submitted.filter((row) => row.status === "in_progress").length ?? 0,
    recent: payload?.recent.length ?? 0,
  }), [payload]);

  async function decide(item: WorkItem, decision: "Approved" | "Declined") {
    if (!item.approvalTaskId) return;
    setBusyId(item.id);
    setError("");
    try {
      const response = await fetch(`/api/approvals/${item.approvalTaskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: decision }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "The HCM approval could not be saved.");
      await load();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The HCM approval could not be saved.");
    } finally {
      setBusyId(null);
    }
  }

  async function complete(item: WorkItem, action: "complete" | "decline") {
    setBusyId(item.id);
    setError("");
    try {
      const response = await fetch("/api/hcm/business-processes/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          stepId: item.id,
          action,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "The HCM work item could not be saved.");
      await load();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The HCM work item could not be saved.");
    } finally {
      setBusyId(null);
    }
  }

  const processRows = tab === "submitted" ? payload?.submitted ?? [] : payload?.recent ?? [];

  return (
    <section className="card" style={{ marginBottom: 18 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">ENTERPRISE HCM · MY TASKS</div>
          <h2>HCM Inbox</h2>
          <p>
            One queue for governed job changes, transfers and promotions. Each request keeps its effective date,
            process version, assignment and decision history.
          </p>
        </div>
        <button className="secondary-button" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && (
        <div className="notice notice-amber" style={{ margin: "0 16px 12px" }}>
          <span>{error}</span>
        </div>
      )}

      <div className="tabs" role="tablist" aria-label="HCM Inbox" style={{ marginInline: 16 }}>
        <button className={`tab ${tab === "work" ? "active" : ""}`} onClick={() => setTab("work")}>
          My work <b>{counts.work}</b>
        </button>
        <button className={`tab ${tab === "submitted" ? "active" : ""}`} onClick={() => setTab("submitted")}>
          My requests <b>{counts.submitted}</b>
        </button>
        <button className={`tab ${tab === "recent" ? "active" : ""}`} onClick={() => setTab("recent")}>
          Process history <b>{counts.recent}</b>
        </button>
      </div>

      <div className="card-body">
        {tab === "work" ? (
          <>
            {!loading && (payload?.myWork.length ?? 0) === 0 && (
              <div className="empty-state small">
                <CheckCircle2 size={18} className="i-green" />
                <strong>Nothing is waiting on you.</strong>
                <p>New governed HCM transactions appear here when your person, role, or delegation is assigned.</p>
              </div>
            )}

            <div className="approval-list">
              {(payload?.myWork ?? []).map((item) => (
                <div className="approval-content" key={item.id}>
                  <span className="approval-symbol" aria-hidden>
                    <Inbox size={17} className="i-purple" />
                  </span>
                  <div>
                    <div className="card-kicker">{typeLabel(item.stepType)} · step {item.stepIndex + 1}</div>
                    <strong>{item.label}</strong>
                    <p>
                      {item.processName}
                      {item.employee ? ` · ${item.employee.name} (${item.employee.employeeNo})` : ""}
                      {item.effectiveDate ? ` · effective ${item.effectiveDate}` : ""}
                    </p>
                    <div className="approval-meta">
                      <span><ShieldCheck size={12} className="i-green" /> {item.assignee}</span>
                      <span><Clock3 size={12} className="i-cyan" /> {item.dueAt ? new Date(item.dueAt).toLocaleDateString() : "No due date"}</span>
                      <span>Requested by <strong>{item.initiatedByName}</strong></span>
                    </div>
                    {item.makerBlocked && (
                      <div className="modal-note" style={{ marginTop: 8 }}>
                        Maker-checker: the initiator cannot decide this approval.
                      </div>
                    )}
                  </div>
                  <div className="approval-actions">
                    {item.stepType === "approval" ? (
                      <>
                        <button
                          className="decline-button"
                          disabled={busyId === item.id || item.makerBlocked}
                          onClick={() => void decide(item, "Declined")}
                        >
                          <X size={13} /> Decline
                        </button>
                        <button
                          className="primary-button brand"
                          disabled={busyId === item.id || item.makerBlocked}
                          onClick={() => void decide(item, "Approved")}
                        >
                          <Check size={14} /> Approve
                        </button>
                      </>
                    ) : (
                      <>
                        {item.stepType === "review" && (
                          <button
                            className="decline-button"
                            disabled={busyId === item.id}
                            onClick={() => void complete(item, "decline")}
                          >
                            <X size={13} /> Decline
                          </button>
                        )}
                        <button
                          className="primary-button brand"
                          disabled={busyId === item.id}
                          onClick={() => void complete(item, "complete")}
                        >
                          <Check size={14} /> {item.stepType === "to_do" ? "Complete" : "Complete review"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="data-table-wrap slim-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Process</th>
                  <th>Effective</th>
                  <th>Initiated by</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {processRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.processName}</strong>
                      <small style={{ display: "block", color: "var(--muted)" }}>#{row.id} · {row.processType}</small>
                    </td>
                    <td className="mono">{row.effectiveDate ?? "—"}</td>
                    <td>{row.initiatedByName}</td>
                    <td><span className={`status ${statusTone(row.status)}`}>{row.status.replaceAll("_", " ")}</span></td>
                  </tr>
                ))}
                {!loading && processRows.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: "center", color: "var(--muted)" }}>
                      No HCM business-process history yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
