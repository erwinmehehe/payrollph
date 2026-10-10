"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, ClipboardCheck, Clock3, Settings2, ShieldCheck, UserCheck, X } from "lucide-react";
import { PayrollHandoff } from "@/components/payroll-handoff";
import { CheckerVarianceCenter } from "./checker-variance";
import { buildPayrollHandoff, handoffViewerRole } from "@/lib/payroll-handoff";
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
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [formOpen, setFormOpen] = useState(false);
  const [pendingId, setPendingId] = useState<number | null>(null);

  const delegations = data.delegations ?? [];
  const activeDelegations = delegations.filter((row) => row.active);

  const tasks = useMemo(
    () => (filter === "pending" ? data.tasks.filter((task) => task.status === "Pending") : data.tasks),
    [data.tasks, filter],
  );

  const pendingCount = data.tasks.filter((task) => task.status === "Pending").length;
  const highCount = data.tasks.filter((task) => task.status === "Pending" && task.priority === "High").length;
  const currentRun = data.payrollRuns.find((run) => run.status === "Pending approval") ?? data.payrollRuns.find((run) => run.status !== "Released") ?? data.payrollRuns[0];
  const payrollTask = currentRun
    ? data.tasks
        .filter((task) => task.detail.includes(`Payroll run #${currentRun.id}`))
        .sort((a, b) => b.id - a.id)[0] ?? null
    : null;
  const handoffStages = currentRun
    ? buildPayrollHandoff(currentRun, { payrollExceptions: currentRun.exceptions, approvalTask: payrollTask })
    : [];
  const handoffRole = handoffViewerRole(data.access?.role ?? data.user?.role);
  const checkerMode = data.access?.role === "checker";
  const canSeeTeamLeaveCalendar =
    process.env.NEXT_PUBLIC_HCM_TEAM_LEAVE_CALENDAR_ENABLED === "true" &&
    !!data.access && (
      ["owner", "admin", "hr"].includes(data.access.role) ||
      (data.access.role === "manager" && !data.access.companyWide)
    );

  async function decide(task: Task, status: "Approved" | "Declined") {
    setPendingId(task.id);
    try {
      await onDecide(task.id, status);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="Approvals"
        title="Decisions, with a clear trail."
        copy={
          canDecide
            ? "Every decision is permission-checked on the server against the assigned approver and any active delegation."
            : "This role can review approval status and history, but decision controls stay with an assigned approver or checker."
        }
        actions={
          canSeeTeamLeaveCalendar || canManageDelegations ? (
            <div className="flex flex-wrap items-center gap-2">
              {canSeeTeamLeaveCalendar && (
                <Link
                  href={"/hcm/team-leave-calendar?organizationId=" + data.selectedOrganization.id}
                  className="inline-flex min-h-10 items-center rounded-lg bg-emerald-800 px-4 text-sm font-semibold text-white hover:bg-emerald-900"
                >
                  Team leave calendar
                </Link>
              )}
              {canManageDelegations && (
                <button className="secondary-button" onClick={() => setFormOpen((current) => !current)} aria-expanded={formOpen}>
                  <Settings2 size={15} className="i-slate" /> Delegation settings
                </button>
              )}
            </div>
          ) : undefined
        }
      />

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

      {checkerMode && currentRun && (
        <CheckerVarianceCenter
          run={currentRun}
          payrollTask={payrollTask}
          busy={busy}
          canDecide={canDecide}
          onDecide={onDecide}
        />
      )}

      <section className="stats-grid">
        <Metric label="Pending" value={String(pendingCount)} hint="awaiting a decision" icon={<ClipboardCheck size={16} className="i-amber" />} tone={pendingCount ? "amber" : "mint"} />
        <Metric label="High priority" value={String(highCount)} hint="flagged for today" icon={<Clock3 size={16} className="i-cyan" />} tone={highCount ? "red" : "slate"} />
        <Metric label="Decided" value={String(data.tasks.length - pendingCount)} hint="recorded in the audit trail" icon={<Check size={16} className="i-green" />} tone="mint" />
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

      <div className="table-toolbar" style={{ border: 0, padding: "0 0 14px" }}>
        <Segmented
          label="Approval filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "pending", label: `Pending (${pendingCount})` },
            { value: "all", label: `All (${data.tasks.length})` },
          ]}
        />
      </div>

      <article className="card">
        <div className="approval-list">
          {tasks.length === 0 && (
            <EmptyState icon={<Check size={20} className="i-green" />} title={filter === "pending" ? "Nothing waiting on you" : "No approval tasks"}>
              {filter === "pending"
                ? "Every task on this client has a recorded decision."
                : "Approval tasks are created by payroll runs, leave requests and lifecycle checklists."}
            </EmptyState>
          )}

          {tasks.map((task) => (
            <div className="approval-content" key={task.id}>
              <span className={`approval-symbol ${task.priority === "High" ? "" : ""}`} aria-hidden>
                <ClipboardCheck size={17} className="i-amber" />
              </span>
              <div>
                <div className="card-kicker">{task.priority === "High" ? "Priority review" : "Pending decision"}</div>
                <strong>{task.title}</strong>
                <p>{task.detail}</p>
                <div className="approval-meta">
                  <span>
                    <UserCheck size={12} className="i-purple" /> Approver <strong style={{ fontSize: 10.5 }}>{approverLabel(task.approver)}</strong>
                  </span>
                  <span>
                    <Clock3 size={12} className="i-cyan" /> {task.dueLabel}
                  </span>
                  {activeDelegations.some((row) => row.fromApprover === task.approver) && (
                    <span className="status status-delegated">Delegated</span>
                  )}
                </div>
              </div>
              {task.status === "Pending" && canDecide ? (
                <div className="approval-actions">
                  <button className="decline-button" disabled={busy && pendingId === task.id} onClick={() => decide(task, "Declined")}>
                    Decline
                  </button>
                  <button className="primary-button brand" disabled={busy && pendingId === task.id} onClick={() => decide(task, "Approved")}>
                    {busy && pendingId === task.id ? <Spinner label="Saving" /> : <Check size={14} className="i-green" />} Approve
                  </button>
                </div>
              ) : (
                <Status value={task.status} />
              )}
            </div>
          ))}
        </div>
      </article>

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
