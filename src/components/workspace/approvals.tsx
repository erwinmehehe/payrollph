"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, ClipboardCheck, Clock3, Settings2, ShieldCheck, UserCheck, X } from "lucide-react";
import { PayrollHandoff } from "@/components/payroll-handoff";
import { CheckerVarianceCenter } from "./checker-variance";
import { buildPayrollHandoff, handoffViewerRole } from "@/lib/payroll-handoff";
import { manilaCalendarDate } from "@/lib/payroll-period-ui";
import { decisionVisibleToViewer, viewerApprovalCounts } from "@/lib/workspace-approval-eligibility";
import type { DashboardData, Notify, Task } from "./types";
import { EmptyState, Metric, PageHeading, Segmented, Spinner, Status } from "./ui";

function approverLabel(value: string) {
  if (value === "role:hr") return "HR role";
  if (value === "role:finance") return "Finance role";
  if (value === "role:manager") return "Manager role";
  if (value === "role:owner") return "Owner role";
  return value;
}

export function ApprovalsView({
  data,
  busy,
  canDecide,
  canManageDelegations,
  onDecide,
  onRefresh,
  notify,
}: {
  data: DashboardData;
  busy: boolean;
  canDecide: boolean;
  canManageDelegations: boolean;
  onDecide: (id: number, status: "Approved" | "Declined") => Promise<void>;
  onRefresh: () => Promise<void>;
  notify: Notify;
}) {
  const [filter, setFilter] = useState<"mine" | "pending" | "all">(canDecide ? "mine" : "pending");
  const [formOpen, setFormOpen] = useState(false);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [decisionDraft, setDecisionDraft] = useState<{ id: number; status: "Approved" | "Declined" } | null>(null);
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const today = manilaCalendarDate();
  const role = data.access?.role ?? data.user?.role;
  const actorName = data.user?.name;
  const delegations = data.delegations ?? [];
  const activeDelegations = delegations.filter((row) => row.active && row.startsOn <= today && row.endsOn >= today);
  const assignment = { actorName, role, delegations, canDecide, today };
  const counts = viewerApprovalCounts({ ...assignment, tasks: data.tasks });
  const canDecideTask = (task: Task) => decisionVisibleToViewer({ ...assignment, task });

  // This small, derived queue does not need manual memoization; keeping the
  // filter direct avoids unstable empty delegation arrays as hook dependencies.
  const tasks = filter === "all" ? data.tasks
    : filter === "pending" ? data.tasks.filter((task) => task.status === "Pending")
    : data.tasks.filter((task) => decisionVisibleToViewer({
        task, actorName, role, delegations, canDecide, today,
      }));
  const pendingCount = counts.pending;
  const highCount = counts.high;
  const currentRun = data.payrollRuns.find((run) => run.status === "Pending approval") ?? data.payrollRuns.find((run) => run.status !== "Released") ?? data.payrollRuns[0];
  const payrollTask = currentRun
    ? data.tasks.filter((task) => task.payrollRunId === currentRun.id ||
        (task.payrollRunId == null &&
          new RegExp("Payroll run #" + currentRun.id + "(?![0-9])").test(task.detail)))
      .sort((a, b) => b.id - a.id)[0] ?? null
    : null;
  const handoffStages = currentRun
    ? buildPayrollHandoff(currentRun, { payrollExceptions: currentRun.exceptions, approvalTask: payrollTask })
    : [];
  const handoffRole = handoffViewerRole(role);
  const checkerMode = role === "checker";
  // Discovery only; the server separately checks the exact employer allowlist,
  // active membership, workforce.manage deny overlay, scope and session.
  const decisionPreviewVisible =
    process.env.NEXT_PUBLIC_HCM_MANAGER_DECISION_INBOX_ENABLED === "true" &&
    (process.env.NEXT_PUBLIC_HCM_MANAGER_DECISION_INBOX_ORG_IDS ?? "").split(",")
      .some((id) => id.trim() === String(data.selectedOrganization.id)) &&
    !!data.access && (
      ["owner", "admin", "hr"].includes(data.access.role) ||
      (data.access.role === "manager" && !data.access.companyWide)
    );


  const draftTask = decisionDraft ? data.tasks.find((task) => task.id === decisionDraft.id) : null;
  const draftPermitted = Boolean(draftTask && canDecideTask(draftTask));
  useEffect(() => {
    const dialog = confirmDialog.current;
    if (!dialog) return;
    if (decisionDraft && !dialog.open) dialog.showModal();
    else if (!decisionDraft && dialog.open) dialog.close();
  }, [decisionDraft]);

  function requestDecision(id: number, status: "Approved" | "Declined") {
    const task = data.tasks.find((item) => item.id === id);
    if (!task || !canDecideTask(task)) return;
    setDecisionDraft({ id, status });
  }

  async function confirmDecision() {
    if (!decisionDraft || !draftTask || !draftPermitted) {
      setDecisionDraft(null);
      return;
    }
    setPendingId(draftTask.id);
    try {
      await onDecide(draftTask.id, decisionDraft.status);
    } finally {
      setPendingId(null);
      setDecisionDraft(null);
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="Approvals"
        title="Approvals, without the guesswork."
        copy={
          canDecide
            ? "See requests assigned to you, review their details, and confirm each decision. The server checks your authorization."
            : "Browse approval status and history. Only the assigned approver or a permitted delegate can make decisions."
        }
        actions={
          canManageDelegations ? (
            <button className="secondary-button" onClick={() => setFormOpen((current) => !current)} aria-expanded={formOpen}>
              <Settings2 size={15} className="i-slate" /> Delegation settings
            </button>
          ) : undefined
        }
      />

      {decisionPreviewVisible && (
        <section className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">Manager Decision Inbox</p>
            <p className="mt-1 text-xs text-slate-600">
              Source-linked pending HCM, leave and overtime decisions. Review and authorization remain in their existing workflows.
            </p>
          </div>
          <Link
            href={"/hcm/manager-decision-inbox?organizationId=" + data.selectedOrganization.id}
            className="inline-flex min-h-10 items-center rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900"
          >
            Open decision preview
          </Link>
        </section>
      )}

      {currentRun && (
        <PayrollHandoff
          stages={handoffStages}
          period={currentRun.periodLabel}
          status={currentRun.status}
          payDate={currentRun.payDate}
          viewerRole={handoffRole}
          compact
        />
      )}

      <section className="stats-grid">
        <Metric label="Assigned to me" value={String(counts.mine)} hint="awaiting your review" icon={<ClipboardCheck size={16} className="i-amber" />} tone={pendingCount ? "amber" : "mint"} />
        <Metric label="High priority" value={String(highCount)} hint="flagged for today" icon={<Clock3 size={16} className="i-cyan" />} tone={highCount ? "red" : "slate"} />
        <Metric label="Decided" value={String(counts.decided)} hint="recorded in the audit trail" icon={<Check size={16} className="i-green" />} tone="mint" />
        <Metric
          label="Active delegations"
          value={String(activeDelegations.length)}
          hint={activeDelegations.length ? "proxy approvals permitted" : "assigned approver only"}
          icon={<UserCheck size={16} className="i-purple" />}
          tone={activeDelegations.length ? "purple" : "slate"}
        />
      </section>

      {activeDelegations.length > 0 ? (
        <div className="notice notice-purple">
          <ShieldCheck size={15} className="i-green" />
          <span>
            <strong>Delegation enforced.</strong>{" "}
            {activeDelegations.map((row) => `${row.fromApprover} → ${row.toApprover}`).join(", ")}. A delegate&apos;s decision
            records both who decided and who they decided on behalf of, plus the full chain.
          </span>
        </div>
      ) : (
        <div className="notice notice-slate">
          <ShieldCheck size={15} className="i-green" />
          <span>
            <strong>No active delegation.</strong> Only the assigned approver can decide; anyone else receives a 403 from the
            API.
          </span>
        </div>
      )}

      {formOpen && canManageDelegations && (
        <DelegationForm
          data={data}
          onClose={() => setFormOpen(false)}
          onCreated={async (message) => {
            setFormOpen(false);
            await onRefresh();
            notify(message);
          }}
          onError={(message) => notify(message, "err")}
        />
      )}

      <div className="p2-approval-toolbar">
        <div className="p2-approval-toolbar-copy">
          <span className="p2-overline">DECISION CENTER</span>
          <h2>Requests and decisions</h2>
          <p>Only tasks assigned to your identity or role show decision actions.</p>
        </div>
        <Segmented
          label="Approval filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "mine", label: "Assigned to me (" + counts.mine + ")" },
            { value: "pending", label: "All pending (" + pendingCount + ")" },
            { value: "all", label: "History (" + data.tasks.length + ")" },
          ]}
        />
      </div>
      <article className="card p2-approval-queue">
        <div className="approval-list">
          {tasks.length === 0 && (
            <EmptyState icon={<Check size={20} className="i-green" />} title={filter === "mine" ? "No decisions assigned to you" : filter === "pending" ? "No pending approvals" : "No approval tasks"}>
              {filter === "mine"
                ? "No pending task matches your name or role. Switch to All pending to track other requests."
                : filter === "pending"
                  ? "Every approval in this workspace has a recorded decision."
                  : "Approval tasks are created by payroll runs, leave requests and lifecycle checklists."}
            </EmptyState>
          )}

          {tasks.map((task) => (
            <div className="approval-content p2-approval-row" key={task.id}>
              <span className={`approval-symbol ${task.priority === "High" ? "" : ""}`} aria-hidden>
                <ClipboardCheck size={17} className="i-amber" />
              </span>
              <div>
                <div className="card-kicker">{task.status !== "Pending" ? "Decision recorded" : task.priority === "High" ? "Priority review" : "Awaiting decision"}</div>
                <strong>{task.title}</strong>
                <p>{task.detail}</p>
                <div className="approval-meta">
                  <span>
                    <UserCheck size={12} className="i-purple" /> Approver <strong style={{ fontSize: 12 }}>{approverLabel(task.approver)}</strong>
                  </span>
                  <span>
                    <Clock3 size={12} className="i-cyan" /> {task.dueLabel}
                  </span>
                  {activeDelegations.some((row) => row.fromApprover.trim().toLowerCase() === task.approver.trim().toLowerCase()) && (
                    <span className="status status-delegated">Delegated</span>
                  )}
                </div>
              </div>
              {checkerMode && payrollTask?.id === task.id && canDecideTask(task) ? (
                <div className="approval-actions p2-approval-actions">
                  <button
                    type="button"
                    className="primary-button brand"
                    onClick={() => document.getElementById("p2-checker-evidence")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  >
                    <ArrowRight size={15} /> Review payroll evidence
                  </button>
                </div>
              ) : canDecideTask(task) ? (
                <div className="approval-actions p2-approval-actions">
                  <button type="button" className="decline-button" disabled={busy || pendingId != null} onClick={() => requestDecision(task.id, "Declined")}>
                    Decline
                  </button>
                  <button type="button" className="primary-button brand" disabled={busy || pendingId != null} onClick={() => requestDecision(task.id, "Approved")}>
                    {busy && pendingId === task.id ? <Spinner label="Saving" /> : <Check size={14} />} Review & approve
                  </button>
                </div>
              ) : (
                <div className="p2-approval-readonly">
                  <Status value={task.status} />
                  {task.status === "Pending" && <span>Awaiting assigned approver</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      </article>

      {checkerMode && currentRun && (
        <section className="p2-checker-evidence" id="p2-checker-evidence" aria-label="Payroll approval evidence">
          <CheckerVarianceCenter
            organizationId={data.selectedOrganization.id}
            run={currentRun}
            payrollTask={payrollTask}
            busy={busy}
            canDecide={Boolean(payrollTask && canDecideTask(payrollTask))}
            onDecide={async (id, status) => requestDecision(id, status)}
          />
        </section>
      )}

      <dialog
        ref={confirmDialog}
        className="p2-approval-confirm"
        aria-labelledby="p2-decision-title"
        aria-describedby="p2-decision-description"
        onCancel={() => setDecisionDraft(null)}
      >
        {decisionDraft && draftTask && (
          <div className="p2-confirm-body">
            <span className="p2-confirm-icon" aria-hidden><ShieldCheck size={22} /></span>
            <h2 id="p2-decision-title">{decisionDraft.status === "Approved" ? "Confirm approval" : "Confirm decline"}</h2>
            <p id="p2-decision-description">
              Review the assigned request before you record this decision. All permissions, source integrity, payroll assurance, and maker-checker rules are enforced by the server.
            </p>
            <dl>
              <div><dt>Request</dt><dd>{draftTask.title}</dd></div>
              <div><dt>Assigned to</dt><dd>{approverLabel(draftTask.approver)}</dd></div>
              <div><dt>Decision</dt><dd>{decisionDraft.status}</dd></div>
            </dl>
            {!draftPermitted && (
              <p className="p2-confirm-warning"><AlertTriangle size={16} /> This task is no longer eligible for your decision.</p>
            )}
            <div className="p2-confirm-actions">
              <button type="button" className="secondary-button" disabled={pendingId != null} onClick={() => setDecisionDraft(null)}>Cancel</button>
              <button
                type="button"
                className={decisionDraft.status === "Approved" ? "primary-button brand" : "decline-button"}
                disabled={busy || pendingId != null || !draftPermitted}
                onClick={() => void confirmDecision()}
              >
                {pendingId != null ? <Spinner label="Saving" /> : <ShieldCheck size={15} />}
                {decisionDraft.status === "Approved" ? "Confirm approval" : "Confirm decline"}
              </button>
            </div>
          </div>
        )}
      </dialog>

      {canManageDelegations && delegations.length > 0 && (
        <article className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <div>
              <div className="card-kicker">Delegation register</div>
              <h2>Date-bounded, revocable proxies</h2>
              <p>Resolution is cycle-safe to a maximum depth of three.</p>
            </div>
          </div>
          <div className="data-table-wrap slim-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th>Reason</th>
                  <th>Window</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {delegations.map((row) => (
                  <tr key={row.id}>
                    <td>{row.fromApprover}</td>
                    <td>{row.toApprover}</td>
                    <td style={{ color: "var(--muted)" }}>{row.reason}</td>
                    <td className="num">
                      {row.startsOn} → {row.endsOn}
                    </td>
                    <td>
                      <Status value={row.active ? "Active" : "Planned"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      )}
    </>
  );
}

function DelegationForm({
  data,
  onClose,
  onCreated,
  onError,
}: {
  data: DashboardData;
  onClose: () => void;
  onCreated: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const approvers = useMemo(() => [...new Set(data.tasks.map((task) => task.approver))].filter(Boolean), [data.tasks]);
  const [from, setFrom] = useState(approvers[0] ?? "");
  const [to, setTo] = useState(data.user?.name ?? "");
  const [reason, setReason] = useState("Out of office");
  // Deliberately empty: a delegation window is a decision, so the operator
  // picks both dates. The API rejects the request without them.
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!from.trim() || !to.trim()) {
      onError("Both approvers are required.");
      return;
    }
    if (!startsOn || !endsOn) {
      onError("A delegation needs an explicit start and end date.");
      return;
    }
    if (endsOn < startsOn) {
      onError("The delegation cannot end before it starts.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/delegations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: data.selectedOrganization.id,
          fromApprover: from,
          toApprover: to,
          reason,
          startsOn,
          endsOn,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        onError(payload.error ?? "Could not create the delegation.");
        return;
      }
      await onCreated(`Delegation active: ${from} → ${to}. Proxy decisions are now permitted and audited.`);
    } catch {
      onError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">New delegation</div>
          <h2>Assign a proxy approver</h2>
          <p>Stops an approval chain becoming a single point of failure while someone is out of office.</p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close delegation form">
          <X size={16} />
        </button>
      </div>
      <div className="setting-form">
        <label>
          Delegate from
          <input value={from} onChange={(event) => setFrom(event.target.value)} list="approver-options" />
          <datalist id="approver-options">
            {approvers.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
        <label>
          Delegate to
          <input value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <label>
          Reason
          <input value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <label>
          Starts on
          <input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} required />
        </label>
        <label>
          Ends on
          <input type="date" value={endsOn} min={startsOn || undefined} onChange={(event) => setEndsOn(event.target.value)} required />
        </label>
      </div>
      <div className="run-actions">
        <button className="secondary-button" onClick={onClose}>
          Cancel
        </button>
        <button className="primary-button brand" onClick={submit} disabled={saving || !startsOn || !endsOn}>
          {saving ? <Spinner label="Saving" /> : <ShieldCheck size={14} className="i-green" />} Activate delegation
        </button>
      </div>
    </article>
  );
}
