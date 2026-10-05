"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clock3, RefreshCcw, ShieldCheck, X } from "lucide-react";
import type { Employee, Notify, Punch } from "./types";
import { EmptyState, Spinner, Status } from "./ui";

type PunchSnapshot = {
  workDate?: string;
  timeIn?: string | null;
  timeOut?: string | null;
  breakStart?: string | null;
  breakEnd?: string | null;
  status?: string;
};

type Correction = {
  id: number;
  employeeId: number;
  punchId: number;
  workDate: string;
  originalPunchSnapshot: PunchSnapshot;
  proposedPunchSnapshot: PunchSnapshot;
  reason: string;
  status: string;
  requestedBy: string;
  requestedByUserId?: number | null;
  decidedBy?: string | null;
  decisionNote?: string | null;
  invalidatedPayrollRunIds?: number[];
};

function phLocalInput(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() + 8 * 60 * 60_000).toISOString().slice(0, 16);
}

function phIso(value: string) {
  return value ? `${value}:00+08:00` : null;
}

function timeLabel(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function AttendanceCorrectionsPanel({
  organizationId,
  punches,
  employees,
  notify,
  canManage,
  canDecide,
  currentUserId,
}: {
  organizationId: number;
  punches: Punch[];
  employees: Employee[];
  notify: Notify;
  canManage: boolean;
  canDecide: boolean;
  currentUserId: number | null;
}) {
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedPunchId, setSelectedPunchId] = useState<number | null>(null);
  const [timeIn, setTimeIn] = useState("");
  const [timeOut, setTimeOut] = useState("");
  const [reason, setReason] = useState("");

  const employeeById = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee])),
    [employees],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/workforce/attendance-corrections?organizationId=${organizationId}`,
        { cache: "no-store" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not load attendance corrections.");
      setCorrections(Array.isArray(body.requests) ? body.requests : []);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load attendance corrections.", "err");
    } finally {
      setLoading(false);
    }
  }, [notify, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingPunchIds = useMemo(
    () => new Set(
      corrections
        .filter((row) => row.status === "pending")
        .map((row) => row.punchId),
    ),
    [corrections],
  );

  const selectablePunches = useMemo(
    () => [...punches]
      .filter((punch) => !pendingPunchIds.has(punch.id))
      .sort((a, b) => String(b.workDate).localeCompare(String(a.workDate)))
      .slice(0, 120),
    [pendingPunchIds, punches],
  );

  function selectPunch(punchId: number) {
    const punch = punches.find((row) => row.id === punchId);
    setSelectedPunchId(punchId || null);
    setTimeIn(phLocalInput(punch?.timeIn));
    setTimeOut(phLocalInput(punch?.timeOut));
  }

  async function requestCorrection() {
    if (!selectedPunchId || !reason.trim()) {
      notify("Choose a punch and enter the correction reason.", "err");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/workforce/attendance-corrections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId,
          action: "create_request",
          punchId: selectedPunchId,
          proposedTimeIn: phIso(timeIn),
          proposedTimeOut: phIso(timeOut),
          reason: reason.trim(),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not request attendance correction.");
      notify("Attendance correction sent for independent approval.", "ok");
      setSelectedPunchId(null);
      setTimeIn("");
      setTimeOut("");
      setReason("");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not request attendance correction.", "err");
    } finally {
      setSaving(false);
    }
  }

  async function decide(requestId: number, decision: "approved" | "rejected") {
    setSaving(true);
    try {
      const response = await fetch("/api/workforce/attendance-corrections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId,
          action: "decide_request",
          requestId,
          decision,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not decide attendance correction.");
      notify(
        decision === "approved"
          ? "Attendance correction approved. Any stale unreleased payroll calculation was invalidated."
          : "Attendance correction rejected.",
        decision === "approved" ? "ok" : "info",
      );
      if (decision === "approved") {
        window.location.reload();
        return;
      }
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not decide attendance correction.", "err");
    } finally {
      setSaving(false);
    }
  }

  const pending = corrections.filter((row) => row.status === "pending");

  return (
    <article className="card table-card" style={{ marginTop: 16 }}>
      <div className="table-toolbar">
        <div>
          <div className="card-kicker">Controlled corrections</div>
          <h2 style={{ margin: "3px 0 0" }}>Attendance correction queue</h2>
          <p className="id" style={{ marginTop: 5 }}>
            Original punches stay in the audit snapshot. A different authorized manager must approve any change before payroll can consume it.
          </p>
        </div>
        <div className="toolbar-spacer" />
        <button className="secondary-button" onClick={() => void load()} disabled={loading || saving}>
          {loading ? <Spinner label="Loading" /> : <RefreshCcw size={14} className="i-cyan" />} Refresh
        </button>
      </div>

      {canManage && (
        <div style={{ padding: "0 18px 18px", display: "grid", gap: 10 }}>
          <div className="form-grid" style={{ margin: 0 }}>
            <label>
              <span>Punch</span>
              <select
                value={selectedPunchId ?? ""}
                onChange={(event) => selectPunch(Number(event.target.value))}
              >
                <option value="">Choose attendance punch</option>
                {selectablePunches.map((punch) => {
                  const employee = employeeById.get(punch.employeeId);
                  return (
                    <option value={punch.id} key={punch.id}>
                      {punch.workDate} · {employee ? `${employee.firstName} ${employee.lastName}` : `Employee #${punch.employeeId}`}
                    </option>
                  );
                })}
              </select>
            </label>
            <label>
              <span>Correct time in · PH time</span>
              <input
                type="datetime-local"
                value={timeIn}
                onChange={(event) => setTimeIn(event.target.value)}
                disabled={!selectedPunchId}
              />
            </label>
            <label>
              <span>Correct time out · PH time</span>
              <input
                type="datetime-local"
                value={timeOut}
                onChange={(event) => setTimeOut(event.target.value)}
                disabled={!selectedPunchId}
              />
            </label>
            <label>
              <span>Reason</span>
              <input
                value={reason}
                maxLength={240}
                placeholder="e.g. biometric OUT failed to sync"
                onChange={(event) => setReason(event.target.value)}
                disabled={!selectedPunchId}
              />
            </label>
          </div>
          <div>
            <button className="primary-button" onClick={() => void requestCorrection()} disabled={saving || !selectedPunchId}>
              <ShieldCheck size={15} /> Request independent approval
            </button>
          </div>
        </div>
      )}

      <div className="data-table-wrap slim-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Date</th>
              <th>Original</th>
              <th>Proposed</th>
              <th>Reason</th>
              <th>Status</th>
              {canManage && <th>Decision</th>}
            </tr>
          </thead>
          <tbody>
            {corrections
              .slice()
              .sort((a, b) => b.id - a.id)
              .slice(0, 60)
              .map((row) => {
                const employee = employeeById.get(row.employeeId);
                return (
                  <tr key={row.id}>
                    <td>
                      <strong>{employee ? `${employee.firstName} ${employee.lastName}` : `Employee #${row.employeeId}`}</strong>
                      <div className="id">{employee?.employeeNo ?? `Punch #${row.punchId}`}</div>
                    </td>
                    <td className="num">{row.workDate}</td>
                    <td className="num">
                      {timeLabel(row.originalPunchSnapshot?.timeIn)} → {timeLabel(row.originalPunchSnapshot?.timeOut)}
                    </td>
                    <td className="num">
                      {timeLabel(row.proposedPunchSnapshot?.timeIn)} → {timeLabel(row.proposedPunchSnapshot?.timeOut)}
                    </td>
                    <td>
                      {row.reason}
                      <div className="id">Requested by {row.requestedBy}</div>
                    </td>
                    <td>
                      <Status value={row.status} />
                      {Array.isArray(row.invalidatedPayrollRunIds) && row.invalidatedPayrollRunIds.length > 0 && (
                        <div className="id">Recalc required: {row.invalidatedPayrollRunIds.length} run(s)</div>
                      )}
                    </td>
                    {canManage && (
                      <td>
                        {row.status === "pending" ? (
                          canDecide && row.requestedByUserId !== currentUserId ? (
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <button className="secondary-button" onClick={() => void decide(row.id, "approved")} disabled={saving}>
                                <Check size={13} className="i-green" /> Approve
                              </button>
                              <button className="secondary-button" onClick={() => void decide(row.id, "rejected")} disabled={saving}>
                                <X size={13} className="i-red" /> Reject
                              </button>
                            </div>
                          ) : (
                            <span className="id">
                              {row.requestedByUserId === currentUserId ? "Needs another reviewer" : "Reviewer role required"}
                            </span>
                          )
                        ) : (
                          <span className="id">{row.decidedBy ? `by ${row.decidedBy}` : "—"}</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
          </tbody>
        </table>

        {!loading && corrections.length === 0 && (
          <EmptyState icon={<Clock3 size={20} className="i-green" />} title="No attendance corrections">
            Corrections will appear here with original and proposed punch values preserved side by side.
          </EmptyState>
        )}
      </div>

      {pending.length > 0 && (
        <div className="notice notice-amber" style={{ margin: 16 }}>
          <ShieldCheck size={14} />
          <span>
            {pending.length} correction{pending.length === 1 ? "" : "s"} waiting for a different authorized reviewer. Released payroll is never rewritten.
          </span>
        </div>
      )}
    </article>
  );
}
