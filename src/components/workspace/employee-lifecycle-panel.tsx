"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  RefreshCcw,
  ShieldCheck,
  UserRoundCog,
  XCircle,
} from "lucide-react";
import type { DashboardData } from "./types";
import { Spinner, Status, formatDate } from "./ui";

type LifecycleTransaction = {
  id: number;
  employeeId: number;
  changeType: string;
  effectiveDate: string;
  targetPositionId: number | null;
  targetManagerEmployeeId: number | null;
  targetEmploymentType: string | null;
  reason: string;
  status: string;
  requestedChanges: Record<string, unknown>;
  requestedByUserId: number | null;
  requestedByName: string;
  decidedByName: string | null;
  decisionNote: string | null;
  applyError: string | null;
  appliedAt: string | null;
  createdAt: string;
};

type LifecyclePosition = {
  id: number;
  code: string;
  jobProfileId: number;
  orgUnitId: number | null;
  managerEmployeeId: number | null;
  employmentType: string;
  status: string;
};

type LifecycleProfile = {
  id: number;
  title: string;
  family: string;
  level: string;
};

type LifecycleEmployee = {
  id: number;
  employeeNo: string;
  firstName: string;
  lastName: string;
  title: string;
  employmentType: string;
  orgUnitId: number | null;
  status: string;
};

type LifecyclePayload = {
  currentUserId: number;
  employees: LifecycleEmployee[];
  positions: LifecyclePosition[];
  profiles: LifecycleProfile[];
  transactions: LifecycleTransaction[];
};

const CHANGE_TYPES = [
  { value: "promotion", label: "Promotion", needsPosition: true },
  { value: "transfer", label: "Transfer", needsPosition: true },
  { value: "position_change", label: "Position change", needsPosition: true },
  { value: "manager_change", label: "Manager change", needsManager: true },
  { value: "employment_type_change", label: "Employment type change", needsEmploymentType: true },
] as const;

function manilaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function changeLabel(value: string) {
  return CHANGE_TYPES.find((item) => item.value === value)?.label ?? value.replaceAll("_", " ");
}

export function EmployeeLifecyclePanel({
  data,
  canManage,
  onRefresh,
}: {
  data: DashboardData;
  canManage: boolean;
  onRefresh: () => Promise<void>;
}) {
  const organizationId = data.selectedOrganization.id;
  const [payload, setPayload] = useState<LifecyclePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const [employeeId, setEmployeeId] = useState(0);
  const [changeType, setChangeType] = useState("promotion");
  const [effectiveDate, setEffectiveDate] = useState(manilaToday());
  const [targetPositionId, setTargetPositionId] = useState("");
  const [targetManagerEmployeeId, setTargetManagerEmployeeId] = useState("");
  const [targetEmploymentType, setTargetEmploymentType] = useState("Regular");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/hcm/lifecycle?organizationId=${organizationId}`,
        { cache: "no-store" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not load employee lifecycle transactions.");
      setPayload(body as LifecyclePayload);
    } catch (error) {
      setMessage({
        tone: "err",
        text: error instanceof Error ? error.message : "Could not load employee lifecycle transactions.",
      });
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const first = payload?.employees.find((employee) => ["Active", "On leave"].includes(employee.status));
    if (!employeeId && first) setEmployeeId(first.id);
  }, [employeeId, payload]);

  const selectedEmployee = payload?.employees.find((employee) => employee.id === employeeId) ?? null;
  const profileById = useMemo(
    () => new Map((payload?.profiles ?? []).map((profile) => [profile.id, profile])),
    [payload],
  );
  const positionById = useMemo(
    () => new Map((payload?.positions ?? []).map((position) => [position.id, position])),
    [payload],
  );
  const employeeById = useMemo(
    () => new Map((payload?.employees ?? []).map((employee) => [employee.id, employee])),
    [payload],
  );

  const availablePositions = useMemo(
    () => (payload?.positions ?? []).filter((position) =>
      position.status === "approved"
      && !payload?.transactions.some((transaction) =>
        ["pending", "scheduled"].includes(transaction.status)
        && transaction.targetPositionId === position.id,
      ),
    ),
    [payload],
  );

  const currentChange = CHANGE_TYPES.find((item) => item.value === changeType)!;
  const activeTransactions = (payload?.transactions ?? []).filter((transaction) =>
    ["pending", "scheduled", "failed"].includes(transaction.status),
  );
  const appliedCount = (payload?.transactions ?? []).filter((transaction) => transaction.status === "applied").length;

  async function mutate(
    action: string,
    body: Record<string, unknown>,
    success: string,
  ) {
    setBusy(action);
    setMessage(null);
    try {
      const response = await fetch("/api/hcm/lifecycle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, action, ...body }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Lifecycle action failed.");
      setMessage({ tone: "ok", text: success });
      await load();
      await onRefresh();
      return true;
    } catch (error) {
      setMessage({
        tone: "err",
        text: error instanceof Error ? error.message : "Lifecycle action failed.",
      });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function submitRequest() {
    if (!employeeId || !reason.trim()) {
      setMessage({ tone: "err", text: "Employee and reason are required." });
      return;
    }
    const body: Record<string, unknown> = {
      employeeId,
      changeType,
      effectiveDate,
      reason: reason.trim(),
    };
    if (currentChange.needsPosition) body.targetPositionId = Number(targetPositionId);
    if (currentChange.needsManager) {
      body.targetManagerEmployeeId = targetManagerEmployeeId ? Number(targetManagerEmployeeId) : null;
    }
    if (currentChange.needsEmploymentType) body.targetEmploymentType = targetEmploymentType;

    const ok = await mutate(
      "create",
      body,
      "Lifecycle transaction submitted for independent approval.",
    );
    if (ok) {
      setReason("");
      setTargetPositionId("");
      setTargetManagerEmployeeId("");
    }
  }

  async function decide(transaction: LifecycleTransaction, action: "approve" | "reject" | "retry" | "cancel") {
    let decisionNote: string | undefined;
    if (action === "reject") {
      decisionNote = window.prompt("Rejection reason")?.trim() || undefined;
      if (!decisionNote) return;
    }
    await mutate(
      action,
      { transactionId: transaction.id, decisionNote },
      action === "approve"
        ? "Lifecycle transaction approved."
        : action === "reject"
          ? "Lifecycle transaction rejected."
          : action === "retry"
            ? "Lifecycle transaction retried."
            : "Lifecycle transaction cancelled.",
    );
  }

  return (
    <article className="card" style={{ marginBottom: 16 }} data-employee-lifecycle-panel>
      <div className="card-header">
        <div>
          <div className="card-kicker">ENTERPRISE HCM · EMPLOYEE LIFECYCLE</div>
          <h2>Govern promotions, transfers, managers and employment changes.</h2>
          <p>
            Changes are independently approved, effective-dated, audit-snapshotted, and applied automatically when their effective date arrives.
          </p>
        </div>
        <button className="secondary-button" onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner label="Loading" /> : <RefreshCcw size={14} />} Refresh
        </button>
      </div>

      <div className="run-stats" style={{ margin: "0 18px 18px" }}>
        <div>
          <span>Needs action</span>
          <strong>{activeTransactions.length}</strong>
          <small>pending · scheduled · failed</small>
        </div>
        <div>
          <span>Applied</span>
          <strong>{appliedCount}</strong>
          <small>immutable lifecycle history</small>
        </div>
        <div>
          <span>Control</span>
          <strong>2-person</strong>
          <small>requester cannot self-approve</small>
        </div>
      </div>

      {message && (
        <div className={message.tone === "err" ? "notice notice-red" : "notice notice-green"} style={{ margin: "0 18px 16px" }}>
          {message.tone === "err" ? <XCircle size={15} /> : <CheckCircle2 size={15} />}
          <span>{message.text}</span>
        </div>
      )}

      {canManage && (
        <div style={{ padding: "0 18px 18px" }}>
          <div className="card-kicker" style={{ marginBottom: 8 }}>Request lifecycle change</div>
          <div className="setting-form">
            <label>
              Employee
              <select value={employeeId || ""} onChange={(event) => setEmployeeId(Number(event.target.value))}>
                {(payload?.employees ?? [])
                  .filter((employee) => ["Active", "On leave"].includes(employee.status))
                  .map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.employeeNo} · {employee.firstName} {employee.lastName} · {employee.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Change
              <select value={changeType} onChange={(event) => setChangeType(event.target.value)}>
                {CHANGE_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <label>
              Effective date
              <input type="date" min={manilaToday()} value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} />
            </label>

            {currentChange.needsPosition && (
              <label>
                Target approved position
                <select value={targetPositionId} onChange={(event) => setTargetPositionId(event.target.value)}>
                  <option value="">Select position</option>
                  {availablePositions.map((position) => {
                    const profile = profileById.get(position.jobProfileId);
                    return (
                      <option key={position.id} value={position.id}>
                        {position.code} · {profile?.title ?? "Job profile"} · {position.employmentType}
                      </option>
                    );
                  })}
                </select>
              </label>
            )}

            {currentChange.needsManager && (
              <label>
                New manager
                <select value={targetManagerEmployeeId} onChange={(event) => setTargetManagerEmployeeId(event.target.value)}>
                  <option value="">No manager / clear manager</option>
                  {(payload?.employees ?? [])
                    .filter((employee) => employee.status === "Active" && employee.id !== employeeId)
                    .map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.firstName} {employee.lastName} · {employee.title}
                      </option>
                    ))}
                </select>
              </label>
            )}

            {currentChange.needsEmploymentType && (
              <label>
                New employment type
                <input
                  value={targetEmploymentType}
                  onChange={(event) => setTargetEmploymentType(event.target.value)}
                  placeholder="Regular, Probationary, Project…"
                  maxLength={32}
                />
              </label>
            )}

            <label>
              Business reason
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Promotion approved in org review, transfer to new team…"
                maxLength={320}
              />
            </label>
          </div>

          {selectedEmployee && (
            <div className="modal-note" style={{ margin: "10px 0" }}>
              Current state: <strong>{selectedEmployee.title}</strong> · {selectedEmployee.employmentType}. Compensation is deliberately not changed here; governed pay changes remain in the compensation/pay workflow.
            </div>
          )}

          <div className="run-actions">
            <button
              className="primary-button brand"
              disabled={
                busy !== null
                || !employeeId
                || !reason.trim()
                || (currentChange.needsPosition && !targetPositionId)
                || (currentChange.needsEmploymentType && targetEmploymentType.trim().length < 2)
              }
              onClick={() => void submitRequest()}
            >
              {busy === "create" ? <Spinner label="Submitting" /> : <ArrowRightLeft size={14} />}
              Submit for approval
            </button>
          </div>
        </div>
      )}

      <div className="data-table-wrap slim-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Employee / change</th>
              <th>Target</th>
              <th>Effective</th>
              <th>Requested by</th>
              <th>Status</th>
              <th>Decision</th>
            </tr>
          </thead>
          <tbody>
            {(payload?.transactions ?? []).slice(0, 30).map((transaction) => {
              const employee = employeeById.get(transaction.employeeId);
              const position = transaction.targetPositionId ? positionById.get(transaction.targetPositionId) : null;
              const profile = position ? profileById.get(position.jobProfileId) : null;
              const manager = transaction.targetManagerEmployeeId
                ? employeeById.get(transaction.targetManagerEmployeeId)
                : null;
              const ownRequest = transaction.requestedByUserId === payload?.currentUserId;

              const target = position
                ? `${position.code} · ${profile?.title ?? "Position"}`
                : transaction.changeType === "manager_change"
                  ? manager
                    ? `${manager.firstName} ${manager.lastName}`
                    : "Clear manager"
                  : transaction.targetEmploymentType ?? "—";

              return (
                <tr key={transaction.id}>
                  <td>
                    <strong>
                      {employee ? `${employee.firstName} ${employee.lastName}` : `Employee #${transaction.employeeId}`}
                    </strong>
                    <div className="id">{changeLabel(transaction.changeType)} · {transaction.reason}</div>
                  </td>
                  <td>{target}</td>
                  <td>{formatDate(transaction.effectiveDate)}</td>
                  <td>{transaction.requestedByName}</td>
                  <td>
                    <Status value={transaction.status} />
                    {transaction.applyError && <div className="id" style={{ maxWidth: 260 }}>{transaction.applyError}</div>}
                  </td>
                  <td>
                    {transaction.status === "pending" && ownRequest ? (
                      <span className="id"><ShieldCheck size={12} /> Needs another reviewer</span>
                    ) : transaction.status === "pending" ? (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button className="secondary-button" disabled={busy !== null} onClick={() => void decide(transaction, "approve")}>
                          <CheckCircle2 size={13} /> Approve
                        </button>
                        <button className="secondary-button" disabled={busy !== null} onClick={() => void decide(transaction, "reject")}>
                          <XCircle size={13} /> Reject
                        </button>
                      </div>
                    ) : transaction.status === "failed" && !ownRequest ? (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button className="secondary-button" disabled={busy !== null} onClick={() => void decide(transaction, "retry")}>
                          <RefreshCcw size={13} /> Retry
                        </button>
                        <button className="secondary-button" disabled={busy !== null} onClick={() => void decide(transaction, "cancel")}>
                          Cancel
                        </button>
                      </div>
                    ) : ["scheduled", "failed"].includes(transaction.status) ? (
                      <button className="secondary-button" disabled={busy !== null} onClick={() => void decide(transaction, "cancel")}>
                        Cancel
                      </button>
                    ) : (
                      <span className="id">
                        {transaction.status === "applied"
                          ? `Applied ${transaction.appliedAt ? formatDate(transaction.appliedAt) : ""}`
                          : transaction.decidedByName ?? "Complete"}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!loading && (payload?.transactions.length ?? 0) === 0 && (
        <div className="card-body" style={{ textAlign: "center" }}>
          <BriefcaseBusiness size={20} />
          <p>No lifecycle transactions yet. Promotions, transfers and manager changes will appear here.</p>
        </div>
      )}

      <div className="notice notice-blue" style={{ margin: 18 }}>
        <CalendarClock size={15} />
        <span>
          Future-dated approvals are applied automatically by the HCM scheduler. If employee or position state changes before the effective date, the transaction fails closed for review instead of overwriting newer HCM data.
        </span>
      </div>
    </article>
  );
}
