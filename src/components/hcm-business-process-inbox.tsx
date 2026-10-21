"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, CheckCircle2, Clock3, Inbox, RefreshCw, ShieldCheck, X } from "lucide-react";
import { reviewDeclineError } from "@/lib/hcm-action-center";
import { readVerifiedHcmBusinessProcessInbox } from "@/lib/hcm-business-process-read";

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
  effectiveDate: string | null;
  initiatedByName: string;
  makerBlocked: boolean;
  employee: null | { id: number; employeeNo: string; name: string; title: string };
};

type ProcessRow = {
  id: number;
  processType: string;
  processName: string;
  status: string;
  effectiveDate: string | null;
  initiatedByName: string;
  initiatedAt: string | null;
  completedAt: string | null;
  employeeId: number | null;
};

type InboxPayload = {
  myWork: WorkItem[];
  submitted: ProcessRow[];
  recent: ProcessRow[];
  meta?: {
    myWorkPartial: boolean;
    submittedPartial: boolean;
    recentPartial: boolean;
    companyHistoryAvailable: boolean;
  };
};
type Tab = "work" | "submitted" | "recent";

const PH_DATE = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila", dateStyle: "medium",
});

function dueLabel(dueAt: string | null) {
  if (!dueAt) return "No recorded deadline";
  const instant = new Date(dueAt);
  return Number.isFinite(instant.getTime()) ? PH_DATE.format(instant) : "Deadline unverified";
}

function statusTone(status: string) {
  if (status === "applied" || status === "approved") return "status-complete";
  if (status === "declined" || status === "failed") return "status-declined";
  if (status === "cancelled") return "status-muted";
  return "status-pending";
}

export function HcmBusinessProcessInbox(props: {
  organizationId: number;
  onChanged?: () => Promise<unknown> | unknown;
}) {
  // The inbox contains tenant-private approval tasks and draft decisions.
  // Remount before the first frame of the next employer can reuse old state.
  return <HcmBusinessProcessInboxContent key={props.organizationId} {...props} />;
}

function HcmBusinessProcessInboxContent({
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
  const [declineStepId, setDeclineStepId] = useState<number | null>(null);
  const [declineNote, setDeclineNote] = useState("");
  const [error, setError] = useState("");
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setPayload(null);
    setDeclineStepId(null);
    setDeclineNote("");
    setError("");
    try {
      const verified = await readVerifiedHcmBusinessProcessInbox(organizationId, fetch);
      if (requestId !== requestSequence.current) return;
      setPayload(verified);
    } catch (caught) {
      if (requestId !== requestSequence.current) return;
      setPayload(null);
      setError(caught instanceof Error ? caught.message : "Could not load the HCM Inbox.");
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    // React effect setup itself does not synchronously start state updates.
    // Request generations also invalidate late responses after teardown.
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
      requestSequence.current += 1;
    };
  }, [load]);

  const counts = {
    work: payload ? payload.myWork.length : "—",
    submitted: payload ? payload.submitted.filter(row => row.status === "in_progress").length : "—",
    recent: payload ? payload.recent.length : "—",
  };

  async function decide(item: WorkItem, decision: "Approved" | "Declined") {
    if (loading || !payload?.myWork.some((row) => row.id === item.id) || !item.approvalTaskId || item.makerBlocked) return;
    setBusyId(item.id);
    setError("");
    try {
      const response = await fetch("/api/approvals/" + item.approvalTaskId, {
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
    if (loading || !payload?.myWork.some((row) => row.id === item.id) || item.makerBlocked) return;
    const reasonError = reviewDeclineError(
      action, item.stepType, declineStepId === item.id ? declineNote : null,
    );
    if (reasonError) {
      setError(reasonError);
      return;
    }
    setBusyId(item.id);
    setError("");
    try {
      const response = await fetch("/api/hcm/business-processes/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId, stepId: item.id, action,
          ...(action === "decline" ? { note: declineNote.trim() } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "The HCM work item could not be saved.");
      setDeclineStepId(null);
      setDeclineNote("");
      await load();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The HCM work item could not be saved.");
    } finally {
      setBusyId(null);
    }
  }

  const processRows = tab === "submitted" ? payload?.submitted ?? [] : payload?.recent ?? [];
  const partial = Boolean(payload?.meta && (
    tab === "work" ? payload.meta.myWorkPartial :
    tab === "submitted" ? payload.meta.submittedPartial : payload.meta.recentPartial
  ));
  const monitorVisible =
    process.env.NEXT_PUBLIC_HCM_PROCESS_MONITOR_ENABLED === "true" &&
    (process.env.NEXT_PUBLIC_HCM_PROCESS_MONITOR_ORG_IDS ?? "")
      .split(",").some(value => value.trim() === String(organizationId));

  return (
    <section className="card" aria-label="HCM Inbox" style={{ marginBottom: 18 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">ENTERPRISE HCM · ASSIGNED WORK</div>
          <h2>HCM Inbox</h2>
          <p>
            One source-linked queue for Hire, Job Change, Transfer, Promotion and Separation.
            Each item retains its frozen process version, effective date and recorded decision history.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {monitorVisible && (
            <Link className="secondary-button" href={"/hcm/process-monitor?organizationId=" + organizationId}>
              Monitor workflows
            </Link>
          )}
          <button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {error && <div role="alert" className="notice notice-amber" style={{ margin: "0 16px 12px" }}>{error}</div>}

      <div className="tabs" role="group" aria-label="HCM Inbox views" style={{ marginInline: 16 }}>
        <button type="button" aria-pressed={tab === "work"} className={"tab " + (tab === "work" ? "active" : "")}
          onClick={() => setTab("work")}>My work <b>{counts.work}{payload?.meta?.myWorkPartial ? "+" : ""}</b></button>
        <button type="button" aria-pressed={tab === "submitted"} className={"tab " + (tab === "submitted" ? "active" : "")}
          onClick={() => setTab("submitted")}>My requests <b>{counts.submitted}{payload?.meta?.submittedPartial ? "+" : ""}</b></button>
        <button type="button" aria-pressed={tab === "recent"} className={"tab " + (tab === "recent" ? "active" : "")}
          onClick={() => setTab("recent")}>Process history <b>{counts.recent}{payload?.meta?.recentPartial ? "+" : ""}</b></button>
      </div>

      <div className="card-body" aria-live="polite">
        {loading && <p role="status" className="text-sm text-slate-500">Checking source assignments…</p>}
        {partial && <p role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Bounded preview only. More tasks or history may exist; this is not a complete outstanding-task count.
        </p>}
        {tab === "work" ? (
          <>
            {!loading && payload !== null && counts.work === 0 && !partial && (
              <div className="empty-state small">
                <CheckCircle2 size={18} className="i-green" />
                <strong>No matching assigned work in this preview.</strong>
                <p>Other authoritative HCM workflows or unscanned assignments may still need attention.</p>
              </div>
            )}
            <div className="approval-list">
              {(payload?.myWork ?? []).map(item => (
                <div className="approval-content" key={item.id}>
                  <span className="approval-symbol" aria-hidden="true"><Inbox size={17} className="i-purple" /></span>
                  <div>
                    <div className="card-kicker">
                      {item.stepType === "to_do" ? "To do" : item.stepType === "review" ? "Review" : "Approval"} · step {item.stepIndex + 1}
                    </div>
                    <strong>{item.label}</strong>
                    <p>
                      {item.processName}
                      {item.employee ? " · " + item.employee.name + " (" + item.employee.employeeNo + ")" : ""}
                      {item.effectiveDate ? " · effective " + item.effectiveDate : ""}
                    </p>
                    <div className="approval-meta">
                      <span><ShieldCheck size={12} className="i-green" /> {item.assignee}</span>
                      <span><Clock3 size={12} className="i-cyan" /> {dueLabel(item.dueAt)}</span>
                      <span>Requested by <strong>{item.initiatedByName}</strong></span>
                    </div>
                    {item.makerBlocked && <div className="modal-note" style={{ marginTop: 8 }}>
                      Maker-checker: the initiator cannot decide this approval or review.
                    </div>}
                  </div>
                  <div className="approval-actions">
                    {item.stepType === "approval" ? (
                      <>
                        <button type="button" className="decline-button" disabled={busyId === item.id || item.makerBlocked}
                          onClick={() => void decide(item, "Declined")}><X size={13} /> Decline</button>
                        <button type="button" className="primary-button brand" disabled={busyId === item.id || item.makerBlocked}
                          onClick={() => void decide(item, "Approved")}><Check size={14} /> Approve</button>
                      </>
                    ) : (
                      <>
                        {item.stepType === "review" && (
                          <button type="button" className="decline-button" disabled={busyId === item.id || item.makerBlocked}
                            onClick={() => { setDeclineStepId(item.id); setDeclineNote(""); }}>
                            <X size={13} /> Decline review
                          </button>
                        )}
                        <button type="button" className="primary-button brand" disabled={busyId === item.id || item.makerBlocked}
                          onClick={() => void complete(item, "complete")}>
                          <Check size={14} /> {item.stepType === "to_do" ? "Complete" : "Complete review"}
                        </button>
                      </>
                    )}
                    {item.stepType === "review" && declineStepId === item.id && (
                      <div className="mt-3 w-full rounded-xl border border-amber-200 bg-amber-50 p-3">
                        <label htmlFor={"hcm-review-decline-" + item.id} className="block text-sm font-semibold text-amber-950">
                          Reason for declining this review
                        </label>
                        <textarea
                          id={"hcm-review-decline-" + item.id}
                          value={declineNote}
                          onChange={event => setDeclineNote(event.target.value)}
                          maxLength={500}
                          rows={3}
                          className="mt-2 w-full rounded-lg border border-amber-300 bg-white p-2 text-sm text-slate-900"
                          placeholder="Explain which source evidence needs correction (10–500 characters)"
                        />
                        <p className="mt-1 text-xs text-amber-950">
                          Declining closes this review. A corrected request requires a new governed source submission;
                          the old request is not automatically sent back.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" className="decline-button"
                            disabled={busyId === item.id || declineNote.trim().length < 10}
                            onClick={() => void complete(item, "decline")}>Confirm decline</button>
                          <button type="button" className="secondary-button" disabled={busyId === item.id}
                            onClick={() => { setDeclineStepId(null); setDeclineNote(""); }}>Keep review pending</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="data-table-wrap slim-scroll">
            <table className="data-table">
              <thead><tr><th>Process</th><th>Effective</th><th>Initiated by</th><th>Status</th></tr></thead>
              <tbody>
                {processRows.map(row => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.processName}</strong>
                      <small style={{ display: "block", color: "var(--muted)" }}>#{row.id} · {row.processType}</small>
                    </td>
                    <td className="mono">{row.effectiveDate ?? "—"}</td>
                    <td>{row.initiatedByName}</td>
                    <td><span className={"status " + statusTone(row.status)}>{row.status.replaceAll("_", " ")}</span></td>
                  </tr>
                ))}
                {!loading && payload !== null && processRows.length === 0 && !partial && (
                  <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--muted)" }}>
                    No HCM business-process history in this bounded view.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
