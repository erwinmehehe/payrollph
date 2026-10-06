"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clock3, Gauge, Layers3, RefreshCcw, Save, ShieldCheck, X } from "lucide-react";
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
  budgetId: number | null;
  budgetMinutesAtDecision: number | null;
  budgetApprovedMinutesBefore: number | null;
  budgetOverrideReason: string | null;
  createdAt: string;
  updatedAt: string;
};

type OvertimeBudgetRow = {
  id: number;
  organizationId: number;
  orgUnitId: number;
  periodStart: string;
  periodEnd: string;
  budgetMinutes: number;
  warningThresholdPercent: number;
  active: boolean;
  approvedMinutesBefore: number;
  pendingMinutes: number;
  remainingMinutesBefore: number;
  projectedApprovedMinutes: number;
  projectedUtilizationPercent: number;
  warning: boolean;
  overBudget: boolean;
};

type OrgUnitOption = {
  id: number;
  name: string;
  code: string;
  type: string;
};

function monthWindow(dateText: string) {
  const [year, month] = dateText.split("-").map(Number);
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { start: `${dateText.slice(0, 7)}-01`, end };
}

function todayManila() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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
  const initialMonth = monthWindow(todayManila());
  const [requests, setRequests] = useState<OvertimeRequestRow[]>([]);
  const [budgets, setBudgets] = useState<OvertimeBudgetRow[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnitOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const [employeeId, setEmployeeId] = useState<number>(data.employees[0]?.id ?? 0);
  const [workDate, setWorkDate] = useState(todayManila());
  const [requestedMinutes, setRequestedMinutes] = useState("60");
  const [requestKind, setRequestKind] = useState("pre_approved");
  const [reason, setReason] = useState("Operational overtime requirement");

  const [budgetOrgUnitId, setBudgetOrgUnitId] = useState<number>(0);
  const [budgetStart, setBudgetStart] = useState(initialMonth.start);
  const [budgetEnd, setBudgetEnd] = useState(initialMonth.end);
  const [budgetMinutes, setBudgetMinutes] = useState("2400");
  const [warningThresholdPercent, setWarningThresholdPercent] = useState("80");
  const [budgetOverrideReason, setBudgetOverrideReason] = useState("");

  const employees = useMemo(
    () => new Map(data.employees.map((employee) => [employee.id, employee])),
    [data.employees],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/workforce/overtime?organizationId=${organizationId}`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not load overtime requests.");
      const nextRequests = Array.isArray(body.requests) ? body.requests as OvertimeRequestRow[] : [];
      const nextBudgets = Array.isArray(body.budgets) ? body.budgets as OvertimeBudgetRow[] : [];
      const nextUnits = Array.isArray(body.orgUnits) ? body.orgUnits as OrgUnitOption[] : [];
      setRequests(nextRequests);
      setBudgets(nextBudgets);
      setOrgUnits(nextUnits);
      setSelectedIds((current) => current.filter((id) =>
        nextRequests.some((request) => request.id === id && request.status === "pending"),
      ));
      setBudgetOrgUnitId((current) => current || nextUnits[0]?.id || 0);
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
    action: string,
    payload: Record<string, unknown>,
    success: string,
  ) {
    setSaving(
      action === "create_request"
        ? "create"
        : action === "decide_request"
          ? String(payload.requestId ?? "decision")
          : action,
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

  async function saveBudget() {\n    const minutes = Number(budgetMinutes);\n    const threshold = Number(warningThresholdPercent);\n    if (!budgetOrgUnitId || !budgetStart || !budgetEnd || budgetEnd < budgetStart || !Number.isInteger(minutes) || minutes < 0 || !Number.isInteger(threshold) || threshold < 1 || threshold > 100) {\n      notify("Choose a unit, valid dates, whole budget minutes, and a warning threshold from 1–100%.", "err");\n      return;\n    }\n    await mutate("upsert_budget", {\n      orgUnitId: budgetOrgUnitId,\n      periodStart: budgetStart,\n      periodEnd: budgetEnd,\n      budgetMinutes: minutes,\n      warningThresholdPercent: threshold,\n    }, "OT budget saved.");\n  }\n  async function decide(requestId: number, decision: "approved" | "rejected") {
    await mutate(
      "decide_request",
      {
        requestId,
        decision,
        ...(budgetOverrideReason.trim() ? { budgetOverrideReason: budgetOverrideReason.trim() } : {}),
      },
      decision === "approved" ? "Overtime request approved." : "Overtime request rejected.",
    );
  }

  async function bulkDecide(decision: "approved" | "rejected") {\n    if (selectedIds.length === 0) {\n      notify("Select at least one pending OT request.", "err");\n      return;\n    }\n    const ok = await mutate("bulk_decide_requests", {\n      requestIds: selectedIds,\n      decision,\n      ...(budgetOverrideReason.trim() ? { budgetOverrideReason: budgetOverrideReason.trim() } : {}),\n    }, selectedIds.length + " overtime request(s) " + decision + " in one governed decision.");\n    if (ok) setSelectedIds([]);\n  }\n  const visible = useMemo(
    () => requests
      .filter((request) => filter === "all" || request.status === "pending")
      .sort((a, b) => String(b.workDate).localeCompare(String(a.workDate)) || b.id - a.id),
    [filter, requests],
  );
  const pending = requests.filter((request) => request.status === "pending").length;
  const approved = requests.filter((request) => request.status === "approved").length;
  const rejected = requests.filter((request) => request.status === "rejected").length;
  const activeBudgets = budgets.filter((budget) => budget.active);
  const warningBudgets = activeBudgets.filter((budget) => budget.warning || budget.overBudget).length;

  function budgetForRequest(request: OvertimeRequestRow) {
    const employee = employees.get(request.employeeId);
    if (!employee?.orgUnitId) return null;
    return budgets.find((budget) =>
      budget.active
      && budget.orgUnitId === employee.orgUnitId
      && request.workDate >= String(budget.periodStart)
      && request.workDate <= String(budget.periodEnd),
    ) ?? null;
  }

  const visiblePendingIds = visible.filter((request) => request.status === "pending").map((request) => request.id);
  const allVisibleSelected = visiblePendingIds.length > 0 && visiblePendingIds.every((id) => selectedIds.includes(id));

  return (
    <section style={{ marginTop: 16 }}>
      <div className="card-header" style={{ padding: "0 0 12px" }}>
        <div>
          <div className="card-kicker">Enterprise OT control</div>
          <h2>Overtime authorization</h2>
          <p>Pre-approve planned OT or record emergency post-approval without turning authorization into a wage-calculation switch.</p>
        </div>
        <button className="secondary-button" onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner label="Loading" /> : <RefreshCcw size={14} className="i-cyan" />} Refresh
        </button>
      </div>

      <section className="stats-grid">
        <Metric label="Pending" value={String(pending)} hint="awaiting independent decision" icon={<Clock3 size={16} className="i-amber" />} tone={pending ? "amber" : "slate"} />
        <Metric label="Approved" value={String(approved)} hint="authorization evidence" icon={<Check size={16} className="i-green" />} tone={approved ? "mint" : "slate"} />
        <Metric label="Rejected" value={String(rejected)} hint="does not erase worked OT" icon={<X size={16} className="i-red" />} tone={rejected ? "red" : "slate"} />
        <Metric label="Four-eyes" value="On" hint="requester cannot self-approve" icon={<ShieldCheck size={16} className="i-cyan" />} tone="blue" />
      </section>

      <div className="notice notice-slate">
        <ShieldCheck size={15} className="i-green" />
        <span>
          <strong>Authorization and entitlement stay separate.</strong> Missing or rejected approval can trigger payroll review, but validated legally payable overtime is still calculated.
        </span>
      </div>

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
          <div className="data-table-wrap slim-scroll">
            <table className="data-table">
              <thead>
                <tr>
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
