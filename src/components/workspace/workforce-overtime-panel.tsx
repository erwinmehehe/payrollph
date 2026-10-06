"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clock3, Gauge, RefreshCcw, ShieldCheck, UsersRound, X } from "lucide-react";
import type { DashboardData, Notify } from "./types";
import { EmptyState, Metric, Segmented, Spinner, Status } from "./ui";

type OvertimeRequestRow = {
  id: number;
  organizationId: number;
  employeeId: number;
  workDate: string;
  requestedMinutes: number;
  reason: string;
  requestKind: string;
  status: string;
  requestedBy: string;
  requestedByUserId: number | null;
  decidedBy: string | null;
  decidedByUserId: number | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  updatedAt: string;
};

type OvertimeBudgetRow = {
  id: number;
  orgUnitId: number;
  managerUserId: number | null;
  monthStart: string;
  budgetMinutes: number;
  enforcementMode: string;
  active: boolean;
  usedMinutes: number;
  remainingMinutes: number;
  exceeded: boolean;
};

type OvertimeManager = {
  userId: number;
  name: string;
  role: string;
  orgUnitId: number | null;
};

function todayManila() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function currentMonthStart() {
  return `${todayManila().slice(0, 7)}-01`;
}

function minutesLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function WorkforceOvertimePanel({
  data,
  notify,
}: {
  data: DashboardData;
  notify: Notify;
}) {
  const organizationId = data.selectedOrganization.id;
  const [requests, setRequests] = useState<OvertimeRequestRow[]>([]);
  const [budgets, setBudgets] = useState<OvertimeBudgetRow[]>([]);
  const [managers, setManagers] = useState<OvertimeManager[]>([]);
  const [canManageBudgets, setCanManageBudgets] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [selectedRequestIds, setSelectedRequestIds] = useState<Set<number>>(new Set());

  const [employeeId, setEmployeeId] = useState<number>(data.employees[0]?.id ?? 0);
  const [workDate, setWorkDate] = useState(todayManila());
  const [requestedMinutes, setRequestedMinutes] = useState("60");
  const [requestKind, setRequestKind] = useState("pre_approved");
  const [reason, setReason] = useState("Operational overtime requirement");

  const [budgetOrgUnitId, setBudgetOrgUnitId] = useState<number>(data.orgUnits?.[0]?.id ?? 0);
  const [budgetManagerUserId, setBudgetManagerUserId] = useState<number | null>(null);
  const [budgetMonthStart, setBudgetMonthStart] = useState(currentMonthStart());
  const [budgetHours, setBudgetHours] = useState("40");
  const [budgetMode, setBudgetMode] = useState("advisory");

  const employees = useMemo(
    () => new Map(data.employees.map((employee) => [employee.id, employee])),
    [data.employees],
  );
  const orgUnits = useMemo(
    () => new Map((data.orgUnits ?? []).map((unit) => [unit.id, unit])),
    [data.orgUnits],
  );
  const managerMap = useMemo(
    () => new Map(managers.map((manager) => [manager.userId, manager])),
    [managers],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/workforce/overtime?organizationId=${organizationId}`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not load overtime requests.");
      setRequests(Array.isArray(body.requests) ? body.requests : []);
      setBudgets(Array.isArray(body.budgets) ? body.budgets : []);
      setManagers(Array.isArray(body.managers) ? body.managers : []);
      setCanManageBudgets(body.canManageBudgets === true);
      setSelectedRequestIds((current) => {
        const pendingIds = new Set(
          (Array.isArray(body.requests) ? body.requests : [])
            .filter((request: OvertimeRequestRow) => request.status === "pending")
            .map((request: OvertimeRequestRow) => request.id),
        );
        return new Set([...current].filter((id) => pendingIds.has(id)));
      });
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load overtime requests.", "err");
    } finally {
      setLoading(false);
    }
  }, [notify, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(
    action: "create_request" | "decide_request" | "bulk_decide_requests" | "upsert_budget",
    payload: Record<string, unknown>,
    success: string,
  ) {
    setSaving(
      action === "create_request"
        ? "create"
        : action === "upsert_budget"
          ? "budget"
          : action === "bulk_decide_requests"
            ? "bulk"
            : String(payload.requestId ?? "decision"),
    );
    try {
      const response = await fetch("/api/workforce/overtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, action, ...payload }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const warning = Array.isArray(body.budgetWarnings) && body.budgetWarnings[0]
          ? ` ${body.budgetWarnings[0]}`
          : "";
        notify(`${body.error ?? "The overtime action could not be completed."}${warning}`, "err");
        return false;
      }
      await load();
      setSelectedRequestIds(new Set());
      notify(success);
      if (Array.isArray(body.budgetWarnings) && body.budgetWarnings.length > 0) {
        notify(body.budgetWarnings.join(" "), "info");
      }
      return true;
    } catch {
      notify("Could not reach the overtime workflow.", "err");
      return false;
    } finally {
      setSaving(null);
    }
  }

  async function createRequest() {
    const minutes = Number(requestedMinutes);
    if (!employeeId || !workDate || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440 || !reason.trim()) {
      notify("Employee, work date, whole requested minutes (1–1440), and reason are required.", "err");
      return;
    }
    await mutate("create_request", {
      employeeId,
      workDate,
      requestedMinutes: minutes,
      requestKind,
      reason,
    }, "Overtime request created for independent manager review.");
  }

  async function decide(requestId: number, decision: "approved" | "rejected") {
    await mutate(
      "decide_request",
      { requestId, decision },
      decision === "approved" ? "Overtime request approved." : "Overtime request rejected.",
    );
  }

  async function bulkDecide(decision: "approved" | "rejected") {
    const requestIds = [...selectedRequestIds];
    if (requestIds.length === 0) {
      notify("Select at least one pending overtime request.", "err");
      return;
    }
    await mutate(
      "bulk_decide_requests",
      { requestIds, decision },
      decision === "approved"
        ? `${requestIds.length} overtime request(s) approved.`
        : `${requestIds.length} overtime request(s) rejected.`,
    );
  }

  async function saveBudget() {
    const hours = Number(budgetHours);
    if (
      !budgetOrgUnitId
      || !/^\d{4}-\d{2}-01$/.test(budgetMonthStart)
      || !Number.isFinite(hours)
      || hours < 0
    ) {
      notify("Organization unit, month, and a non-negative OT-hours budget are required.", "err");
      return;
    }
    await mutate("upsert_budget", {
      orgUnitId: budgetOrgUnitId,
      managerUserId: budgetManagerUserId,
      monthStart: budgetMonthStart,
      budgetMinutes: Math.round(hours * 60),
      enforcementMode: budgetMode,
    }, "Overtime budget saved.");
  }

  const visible = useMemo(
    () => requests
      .filter((request) => filter === "all" || request.status === "pending")
      .sort((a, b) => String(b.workDate).localeCompare(String(a.workDate)) || b.id - a.id),
    [filter, requests],
  );
  const pendingVisibleIds = visible.filter((request) => request.status === "pending").map((request) => request.id);
  const pending = requests.filter((request) => request.status === "pending").length;
  const approved = requests.filter((request) => request.status === "approved").length;
  const rejected = requests.filter((request) => request.status === "rejected").length;
  const exceededBudgets = budgets.filter((budget) => budget.exceeded).length;

  function toggleRequest(id: number) {
    setSelectedRequestIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllPending() {
    setSelectedRequestIds((current) => {
      const allSelected = pendingVisibleIds.length > 0 && pendingVisibleIds.every((id) => current.has(id));
      if (allSelected) return new Set();
      return new Set(pendingVisibleIds);
    });
  }

  return (
    <section style={{ marginTop: 16 }}>
      <div className="card-header" style={{ padding: "0 0 12px" }}>
        <div>
          <div className="card-kicker">Enterprise OT control</div>
          <h2>Overtime authorization</h2>
          <p>Control planned OT against department or manager budgets without turning authorization into a wage-calculation switch.</p>
        </div>
        <button className="secondary-button" onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner label="Loading" /> : <RefreshCcw size={14} className="i-cyan" />} Refresh
        </button>
      </div>

      <section className="stats-grid">
        <Metric label="Pending" value={String(pending)} hint="awaiting independent decision" icon={<Clock3 size={16} className="i-amber" />} tone={pending ? "amber" : "slate"} />
        <Metric label="Approved" value={String(approved)} hint="authorization evidence" icon={<Check size={16} className="i-green" />} tone={approved ? "mint" : "slate"} />
        <Metric label="Budget alerts" value={String(exceededBudgets)} hint="monthly scopes over budget" icon={<Gauge size={16} className="i-red" />} tone={exceededBudgets ? "red" : "slate"} />
        <Metric label="Four-eyes" value="On" hint="requester cannot self-approve" icon={<ShieldCheck size={16} className="i-cyan" />} tone="blue" />
      </section>

      <div className="notice notice-slate">
        <ShieldCheck size={15} className="i-green" />
        <span>
          <strong>Authorization and entitlement stay separate.</strong> A blocking budget can stop authorization, but validated legally payable overtime is still calculated from actual attendance.
        </span>
      </div>

      {canManageBudgets && (
        <article className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <div>
              <div className="card-kicker">Monthly OT budget</div>
              <h2>Set department or manager authorization limits</h2>
              <p>Manager-specific budgets take precedence over the department-wide fallback for that manager.</p>
            </div>
          </div>
          <div className="setting-form">
            <label>
              Organization unit
              <select value={budgetOrgUnitId || ""} onChange={(event) => setBudgetOrgUnitId(Number(event.target.value))}>
                {(data.orgUnits ?? []).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
              </select>
            </label>
            <label>
              Budget owner
              <select
                value={budgetManagerUserId ?? ""}
                onChange={(event) => setBudgetManagerUserId(event.target.value ? Number(event.target.value) : null)}
              >
                <option value="">Department-wide</option>
                {managers
                  .filter((manager) => manager.orgUnitId == null || manager.orgUnitId === budgetOrgUnitId)
                  .map((manager) => <option key={manager.userId} value={manager.userId}>{manager.name} · {manager.role}</option>)}
              </select>
            </label>
            <label>Month<input type="date" value={budgetMonthStart} onChange={(event) => setBudgetMonthStart(`${event.target.value.slice(0, 7)}-01`)} /></label>
            <label>OT budget hours<input type="number" min={0} step={0.5} value={budgetHours} onChange={(event) => setBudgetHours(event.target.value)} /></label>
            <label>
              Enforcement
              <select value={budgetMode} onChange={(event) => setBudgetMode(event.target.value)}>
                <option value="advisory">Advisory, warn but allow approval</option>
                <option value="blocking">Blocking, stop approval over budget</option>
              </select>
            </label>
          </div>
          <div className="run-actions">
            <button className="primary-button brand" disabled={saving !== null || !budgetOrgUnitId} onClick={() => void saveBudget()}>
              {saving === "budget" ? <Spinner label="Saving" /> : <Gauge size={14} />} Save OT budget
            </button>
          </div>
        </article>
      )}

      {budgets.length > 0 && (
        <article className="card table-card" style={{ marginTop: 16 }}>
          <div className="table-toolbar">
            <div>
              <div className="card-kicker">Budget utilization</div>
              <h2 style={{ margin: "3px 0 0" }}>Authorization capacity</h2>
            </div>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>Scope</th><th>Month</th><th>Used / budget</th><th>Remaining</th><th>Mode</th></tr></thead>
              <tbody>
                {budgets.map((budget) => {
                  const unit = orgUnits.get(budget.orgUnitId);
                  const manager = budget.managerUserId ? managerMap.get(budget.managerUserId) : null;
                  return (
                    <tr key={budget.id}>
                      <td><strong>{unit?.name ?? `Unit #${budget.orgUnitId}`}</strong><div className="id">{manager ? `Manager · ${manager.name}` : "Department-wide"}</div></td>
                      <td>{budget.monthStart.slice(0, 7)}</td>
                      <td><strong>{minutesLabel(budget.usedMinutes)} / {minutesLabel(budget.budgetMinutes)}</strong></td>
                      <td>{budget.exceeded ? <Status value="Over budget" /> : minutesLabel(budget.remainingMinutes)}</td>
                      <td><Status value={budget.enforcementMode} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </article>
      )}

      <section className="module-grid two" style={{ marginTop: 16 }}>
        <article className="card">
          <div className="card-header">
            <div>
              <div className="card-kicker">Request</div>
              <h2>Create OT authorization</h2>
              <p>Use emergency post-approval only when the employee has already worked the overtime.</p>
            </div>
          </div>
          <div className="setting-form">
            <label>
              Employee
              <select value={employeeId || ""} onChange={(event) => setEmployeeId(Number(event.target.value))}>
                {data.employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>{employee.employeeNo} · {employee.firstName} {employee.lastName}</option>
                ))}
              </select>
            </label>
            <label>Work date<input type="date" value={workDate} onChange={(event) => setWorkDate(event.target.value)} /></label>
            <label>
              Request type
              <select value={requestKind} onChange={(event) => setRequestKind(event.target.value)}>
                <option value="pre_approved">Pre-approved OT</option>
                <option value="emergency_post_approval">Emergency post-approval</option>
              </select>
            </label>
            <label>Requested minutes<input type="number" min={1} max={1440} step={1} value={requestedMinutes} onChange={(event) => setRequestedMinutes(event.target.value)} /></label>
            <label>Reason<input value={reason} maxLength={240} onChange={(event) => setReason(event.target.value)} /></label>
          </div>
          <div className="run-actions">
            <button className="primary-button brand" disabled={saving !== null} onClick={() => void createRequest()}>
              {saving === "create" ? <Spinner label="Saving" /> : <ShieldCheck size={14} />} Submit for review
            </button>
          </div>
        </article>

        <article className="card table-card">
          <div className="table-toolbar">
            <div>
              <div className="card-kicker">Decision queue</div>
              <h2 style={{ margin: "3px 0 0" }}>OT requests</h2>
            </div>
            <div className="toolbar-spacer" />
            <Segmented
              label="OT request filter"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "pending", label: `Pending (${pending})` },
                { value: "all", label: `All (${requests.length})` },
              ]}
            />
          </div>

          {pendingVisibleIds.length > 0 && (
            <div className="run-actions" style={{ padding: "0 16px 12px" }}>
              <button className="secondary-button" disabled={saving !== null || selectedRequestIds.size === 0} onClick={() => void bulkDecide("approved")}>
                <Check size={14} /> Approve selected ({selectedRequestIds.size})
              </button>
              <button className="secondary-button" disabled={saving !== null || selectedRequestIds.size === 0} onClick={() => void bulkDecide("rejected")}>
                <X size={14} /> Reject selected
              </button>
            </div>
          )}

          <div className="data-table-wrap slim-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>
                    <input
                      aria-label="Select all pending overtime requests"
                      type="checkbox"
                      checked={pendingVisibleIds.length > 0 && pendingVisibleIds.every((id) => selectedRequestIds.has(id))}
                      onChange={toggleAllPending}
                    />
                  </th>
                  <th>Employee / date</th>
                  <th>Request</th>
                  <th>Status</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((request) => {
                  const employee = employees.get(request.employeeId);
                  return (
                    <tr key={request.id}>
                      <td>
                        {request.status === "pending" && (
                          <input
                            aria-label={`Select overtime request #${request.id}`}
                            type="checkbox"
                            checked={selectedRequestIds.has(request.id)}
                            onChange={() => toggleRequest(request.id)}
                          />
                        )}
                      </td>
                      <td>
                        <strong>{employee ? `${employee.firstName} ${employee.lastName}` : `Employee #${request.employeeId}`}</strong>
                        <div className="id">{request.workDate} · #{request.id}</div>
                      </td>
                      <td>
                        <strong>{minutesLabel(request.requestedMinutes)}</strong>
                        <div className="id">{request.requestKind === "emergency_post_approval" ? "Emergency post-approval" : "Pre-approved"} · {request.reason}</div>
                      </td>
                      <td>
                        <Status value={request.status} />
                        <div className="id">Requested by {request.requestedBy}</div>
                      </td>
                      <td>
                        {request.status === "pending" ? (
                          <span className="action-group">
                            <button className="tiny-button approve" disabled={saving !== null} onClick={() => void decide(request.id, "approved")}>
                              <Check size={13} /> Approve
                            </button>
                            <button className="tiny-button decline" disabled={saving !== null} onClick={() => void decide(request.id, "rejected")}>
                              <X size={13} /> Reject
                            </button>
                          </span>
                        ) : (
                          <span className="id">{request.decidedBy ? `By ${request.decidedBy}` : "Final"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!loading && visible.length === 0 && (
              <EmptyState icon={<Clock3 size={20} className="i-green" />} title="No overtime requests in this view">
                New pre-approval or emergency post-approval requests will appear here.
              </EmptyState>
            )}
          </div>
        </article>
      </section>
    </section>
  );
}
