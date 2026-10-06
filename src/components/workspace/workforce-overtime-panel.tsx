"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clock3, Gauge, RefreshCcw, ShieldCheck, X } from "lucide-react";
import type { DashboardData, Notify } from "./types";
import { EmptyState, Metric, Segmented, Spinner, Status } from "./ui";

type OvertimeRequestRow = {
  id: number;
  organizationId: number;
  employeeId: number;
  orgUnitId: number | null;
  workDate: string;
  requestedMinutes: number;
  reason: string;
  requestKind: string;
  status: string;
  budgetId: number | null;
  budgetSnapshot: Record<string, unknown> | null;
  requestedBy: string;
  requestedByUserId: number | null;
  decidedBy: string | null;
  decidedByUserId: number | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  updatedAt: string;
};

type OrgUnitRow = {
  id: number;
  name: string;
  code: string;
};

type OvertimeBudget = {
  id: number;
  organizationId: number;
  orgUnitId: number;
  periodMonth: string;
  budgetMinutes: number;
  approvedMinutes: number;
  pendingMinutes: number;
  remainingMinutes: number;
  committedPercent: number;
  pendingIfApprovedMinutes: number;
  pendingIfApprovedPercent: number;
  overBudget: boolean;
  projectedOverBudget: boolean;
  enforcementMode: string;
  active: boolean;
  notes: string | null;
};

function todayManila() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function currentManilaMonth() {
  return todayManila().slice(0, 7);
}

function minutesLabel(minutes: number) {
  const sign = minutes < 0 ? "-" : "";
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const rest = absolute % 60;
  if (!hours) return `${sign}${rest}m`;
  return rest ? `${sign}${hours}h ${rest}m` : `${sign}${hours}h`;
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
  const [orgUnits, setOrgUnits] = useState<OrgUnitRow[]>([]);
  const [budgets, setBudgets] = useState<OvertimeBudget[]>([]);
  const [canManageBudgets, setCanManageBudgets] = useState(false);
  const [canDecide, setCanDecide] = useState(false);
  const [month, setMonth] = useState(currentManilaMonth());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const [employeeId, setEmployeeId] = useState<number>(data.employees[0]?.id ?? 0);
  const [workDate, setWorkDate] = useState(todayManila());
  const [requestedMinutes, setRequestedMinutes] = useState("60");
  const [requestKind, setRequestKind] = useState("pre_approved");
  const [reason, setReason] = useState("Operational overtime requirement");

  const [budgetOrgUnitId, setBudgetOrgUnitId] = useState<number>(data.orgUnits?.[0]?.id ?? 0);
  const [budgetHours, setBudgetHours] = useState("40");
  const [budgetEnforcement, setBudgetEnforcement] = useState<"advisory" | "block">("advisory");
  const [budgetNotes, setBudgetNotes] = useState("");

  const employees = useMemo(
    () => new Map(data.employees.map((employee) => [employee.id, employee])),
    [data.employees],
  );
  const unitById = useMemo(
    () => new Map(orgUnits.map((unit) => [unit.id, unit])),
    [orgUnits],
  );
  const budgetByUnit = useMemo(
    () => new Map(budgets.map((budget) => [budget.orgUnitId, budget])),
    [budgets],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/workforce/overtime?organizationId=${organizationId}&month=${month}`,
        { cache: "no-store" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not load overtime requests.");
      setRequests(Array.isArray(body.requests) ? body.requests : []);
      setOrgUnits(Array.isArray(body.orgUnits) ? body.orgUnits : []);
      setBudgets(Array.isArray(body.budgets) ? body.budgets : []);
      setCanManageBudgets(Boolean(body.canManageBudgets));
      setCanDecide(Boolean(body.canDecide));
      setBudgetOrgUnitId((current) => current || body.orgUnits?.[0]?.id || 0);
      setSelectedIds([]);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load overtime requests.", "err");
    } finally {
      setLoading(false);
    }
  }, [month, notify, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(
    action: "create_request" | "decide_request" | "bulk_decide_requests" | "save_budget",
    payload: Record<string, unknown>,
    success: string,
  ) {
    setSaving(
      action === "create_request"
        ? "create"
        : action === "save_budget"
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
        notify(body.error ?? "The overtime action could not be completed.", "err");
        return false;
      }
      await load();
      notify(success);
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

  async function saveBudget() {
    const hours = Number(budgetHours);
    const minutes = Math.round(hours * 60);
    if (!budgetOrgUnitId || !Number.isFinite(hours) || hours < 0 || minutes > 1_000_000) {
      notify("Choose a department and enter a valid monthly OT budget.", "err");
      return;
    }
    await mutate("save_budget", {
      orgUnitId: budgetOrgUnitId,
      periodMonth: month,
      budgetMinutes: minutes,
      enforcementMode: budgetEnforcement,
      notes: budgetNotes,
    }, "Monthly OT budget saved.");
  }

  async function decide(requestId: number, decision: "approved" | "rejected") {
    await mutate(
      "decide_request",
      { requestId, decision },
      decision === "approved" ? "Overtime request approved." : "Overtime request rejected.",
    );
  }

  async function bulkDecide(decision: "approved" | "rejected") {
    const requestIds = [...new Set(selectedIds)];
    if (!requestIds.length) {
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

  const monthRequests = requests.filter((request) => String(request.workDate).slice(0, 7) === month);
  const visible = useMemo(
    () => monthRequests
      .filter((request) => filter === "all" || request.status === "pending")
      .sort((a, b) => String(b.workDate).localeCompare(String(a.workDate)) || b.id - a.id),
    [filter, monthRequests],
  );
  const pendingRows = visible.filter((request) => request.status === "pending");
  const selectedPending = pendingRows.filter((request) => selectedIds.includes(request.id));
  const pending = monthRequests.filter((request) => request.status === "pending").length;
  const approved = monthRequests.filter((request) => request.status === "approved").length;
  const rejected = monthRequests.filter((request) => request.status === "rejected").length;
  const budgetPressure = budgets.filter((budget) => budget.projectedOverBudget).length;
  const approvedBudgetMinutes = budgets.reduce((sum, budget) => sum + budget.approvedMinutes, 0);
  const totalBudgetMinutes = budgets.reduce((sum, budget) => sum + budget.budgetMinutes, 0);

  function toggleSelection(requestId: number) {
    setSelectedIds((current) =>
      current.includes(requestId)
        ? current.filter((id) => id !== requestId)
        : [...current, requestId],
    );
  }

  return (
    <section style={{ marginTop: 16 }} data-wfm-overtime-budget>
      <div className="card-header" style={{ padding: "0 0 12px" }}>
        <div>
          <div className="card-kicker">Enterprise OT control</div>
          <h2>Overtime authorization & budgets</h2>
          <p>Control planned overtime by department without turning authorization or budget status into a wage-calculation switch.</p>
        </div>
        <button className="secondary-button" onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner label="Loading" /> : <RefreshCcw size={14} className="i-cyan" />} Refresh
        </button>
      </div>

      <section className="stats-grid">
        <Metric label="Pending" value={String(pending)} hint="awaiting independent decision" icon={<Clock3 size={16} className="i-amber" />} tone={pending ? "amber" : "slate"} />
        <Metric label="Approved" value={String(approved)} hint={totalBudgetMinutes ? `${minutesLabel(approvedBudgetMinutes)} of ${minutesLabel(totalBudgetMinutes)} budgeted` : "authorization evidence"} icon={<Check size={16} className="i-green" />} tone={approved ? "mint" : "slate"} />
        <Metric label="Budget pressure" value={String(budgetPressure)} hint="departments projected over monthly cap" icon={<Gauge size={16} className="i-amber" />} tone={budgetPressure ? "amber" : "slate"} />
        <Metric label="Four-eyes" value="On" hint="requester cannot self-approve" icon={<ShieldCheck size={16} className="i-cyan" />} tone="blue" />
      </section>

      <div className="notice notice-slate">
        <ShieldCheck size={15} className="i-green" />
        <span>
          <strong>Authorization, budget, and entitlement stay separate.</strong> A budget can control forward-looking pre-approval, but validated legally payable worked overtime is still calculated. Emergency post-approval can record a budget overrun instead of hiding work already performed.
        </span>
      </div>

      <div className="setting-form" style={{ marginTop: 16 }}>
        <label>Budget / decision month<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
      </div>

      <section className="module-grid two" style={{ marginTop: 16 }}>
        {canManageBudgets && (
          <article className="card">
            <div className="card-header">
              <div><div className="card-kicker">Department budget</div><h2>Set monthly OT capacity</h2><p>Hard mode blocks pre-approval beyond the cap. Advisory mode records the overrun but allows approval.</p></div>
            </div>
            <div className="setting-form">
              <label>
                Department
                <select value={budgetOrgUnitId || ""} onChange={(event) => setBudgetOrgUnitId(Number(event.target.value))}>
                  {orgUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} · {unit.name}</option>)}
                </select>
              </label>
              <label>Budget hours<input type="number" min={0} step={0.5} value={budgetHours} onChange={(event) => setBudgetHours(event.target.value)} /></label>
              <label>
                Enforcement
                <select value={budgetEnforcement} onChange={(event) => setBudgetEnforcement(event.target.value as "advisory" | "block")}>
                  <option value="advisory">Advisory · allow + flag overrun</option>
                  <option value="block">Hard · block pre-approval over cap</option>
                </select>
              </label>
              <label>Notes<input maxLength={240} value={budgetNotes} onChange={(event) => setBudgetNotes(event.target.value)} placeholder="Optional planning note" /></label>
            </div>
            <div className="run-actions">
              <button className="primary-button brand" disabled={saving !== null || !budgetOrgUnitId} onClick={() => void saveBudget()}>
                {saving === "budget" ? <Spinner label="Saving" /> : <Gauge size={14} />} Save monthly budget
              </button>
            </div>
          </article>
        )}

        <article className="card table-card" style={{ gridColumn: canManageBudgets ? undefined : "1 / -1" }}>
          <div className="table-toolbar">
            <div><div className="card-kicker">Budget ledger</div><h2 style={{ margin: "3px 0 0" }}>{month}</h2></div>
          </div>
          <div className="data-table-wrap slim-scroll">
            <table className="data-table">
              <thead><tr><th>Department</th><th>Approved</th><th>Pending</th><th>Remaining</th><th>Mode</th></tr></thead>
              <tbody>
                {budgets.map((budget) => (
                  <tr key={budget.id}>
                    <td><strong>{unitById.get(budget.orgUnitId)?.name ?? `Unit #${budget.orgUnitId}`}</strong><div className="id">{minutesLabel(budget.budgetMinutes)} monthly cap</div></td>
                    <td><strong>{minutesLabel(budget.approvedMinutes)}</strong><div className="id">{budget.committedPercent}% committed</div></td>
                    <td><strong>{minutesLabel(budget.pendingMinutes)}</strong><div className="id">{budget.pendingIfApprovedPercent}% if all approved</div></td>
                    <td><Status value={minutesLabel(budget.remainingMinutes)} /></td>
                    <td><Status value={budget.enforcementMode === "block" ? "Hard cap" : "Advisory"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && budgets.length === 0 && (
              <EmptyState icon={<Gauge size={20} className="i-cyan" />} title="No OT budgets for this month">
                Overtime authorization still works. Add a department budget when you want capacity controls.
              </EmptyState>
            )}
          </div>
        </article>
      </section>

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
              <h2 style={{ margin: "3px 0 0" }}>OT requests · {month}</h2>
            </div>
            <div className="toolbar-spacer" />
            <Segmented
              label="OT request filter"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "pending", label: `Pending (${pending})` },
                { value: "all", label: `All (${monthRequests.length})` },
              ]}
            />
          </div>

          {canDecide && pendingRows.length > 0 && (
            <div className="run-actions" style={{ padding: "0 16px 12px" }}>
              <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={pendingRows.length > 0 && pendingRows.every((row) => selectedIds.includes(row.id))}
                  onChange={(event) => setSelectedIds(event.target.checked ? pendingRows.map((row) => row.id) : [])}
                />
                Select pending
              </label>
              <div className="toolbar-spacer" />
              <button className="tiny-button approve" disabled={saving !== null || !selectedPending.length} onClick={() => void bulkDecide("approved")}>
                <Check size={13} /> Approve selected ({selectedPending.length})
              </button>
              <button className="tiny-button decline" disabled={saving !== null || !selectedPending.length} onClick={() => void bulkDecide("rejected")}>
                <X size={13} /> Reject selected
              </button>
            </div>
          )}

          <div className="data-table-wrap slim-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Employee / date</th>
                  <th>Request</th>
                  <th>Budget</th>
                  <th>Status</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((request) => {
                  const employee = employees.get(request.employeeId);
                  const budget = request.orgUnitId ? budgetByUnit.get(request.orgUnitId) : null;
                  return (
                    <tr key={request.id}>
                      <td>
                        {request.status === "pending" && canDecide
                          ? <input type="checkbox" checked={selectedIds.includes(request.id)} onChange={() => toggleSelection(request.id)} />
                          : null}
                      </td>
                      <td>
                        <strong>{employee ? `${employee.firstName} ${employee.lastName}` : `Employee #${request.employeeId}`}</strong>
                        <div className="id">{request.workDate} · #{request.id} · {request.orgUnitId ? unitById.get(request.orgUnitId)?.name ?? `Unit #${request.orgUnitId}` : "No department"}</div>
                      </td>
                      <td>
                        <strong>{minutesLabel(request.requestedMinutes)}</strong>
                        <div className="id">{request.requestKind === "emergency_post_approval" ? "Emergency post-approval" : "Pre-approved"} · {request.reason}</div>
                      </td>
                      <td>
                        {budget
                          ? <>
                              <strong>{minutesLabel(budget.remainingMinutes)} remaining</strong>
                              <div className="id">{budget.enforcementMode === "block" ? "Hard cap" : "Advisory"} · {budget.committedPercent}% used</div>
                            </>
                          : <span className="id">No monthly cap</span>}
                      </td>
                      <td>
                        <Status value={request.status} />
                        <div className="id">Requested by {request.requestedBy}</div>
                      </td>
                      <td>
                        {request.status === "pending" && canDecide ? (
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

      {rejected > 0 && <div className="id" style={{ marginTop: 10 }}>{rejected} rejected request(s) in {month}; rejection remains authorization evidence and does not erase worked OT.</div>}
    </section>
  );
}
