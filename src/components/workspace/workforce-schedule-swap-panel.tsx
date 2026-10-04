"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Check, RefreshCcw, ShieldCheck, X } from "lucide-react";
import type { DashboardData, Notify } from "./types";
import { EmptyState, Metric, Segmented, Spinner, Status } from "./ui";

type SwapRow = {
  id: number;
  organizationId: number;
  requesterEmployeeId: number;
  counterpartyEmployeeId: number;
  requesterWorkDate: string;
  counterpartyWorkDate: string;
  reason: string;
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

function todayManila() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function WorkforceScheduleSwapPanel({
  data,
  notify,
}: {
  data: DashboardData;
  notify: Notify;
}) {
  const organizationId = data.selectedOrganization.id;
  const [swaps, setSwaps] = useState<SwapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [requesterEmployeeId, setRequesterEmployeeId] = useState(data.employees[0]?.id ?? 0);
  const [counterpartyEmployeeId, setCounterpartyEmployeeId] = useState(data.employees[1]?.id ?? data.employees[0]?.id ?? 0);
  const [requesterWorkDate, setRequesterWorkDate] = useState(todayManila());
  const [counterpartyWorkDate, setCounterpartyWorkDate] = useState(todayManila());
  const [reason, setReason] = useState("Schedule coverage swap");

  const employees = useMemo(
    () => new Map(data.employees.map((employee) => [employee.id, employee])),
    [data.employees],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/workforce/schedule-swaps?organizationId=${organizationId}`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not load schedule swaps.");
      setSwaps(Array.isArray(body.swaps) ? body.swaps : []);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load schedule swaps.", "err");
    } finally {
      setLoading(false);
    }
  }, [notify, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(action: "create_request" | "decide_request", payload: Record<string, unknown>, success: string) {
    setSaving(action === "create_request" ? "create" : String(payload.requestId ?? "decision"));
    try {
      const response = await fetch("/api/workforce/schedule-swaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, action, ...payload }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(body.error ?? "The schedule swap action could not be completed.", "err");
        return false;
      }
      await load();
      notify(success);
      return true;
    } catch {
      notify("Could not reach the schedule swap workflow.", "err");
      return false;
    } finally {
      setSaving(null);
    }
  }

  async function createSwap() {
    if (
      !requesterEmployeeId
      || !counterpartyEmployeeId
      || requesterEmployeeId === counterpartyEmployeeId
      || !requesterWorkDate
      || !counterpartyWorkDate
      || !reason.trim()
    ) {
      notify("Choose two different employees, both work dates, and a reason.", "err");
      return;
    }
    await mutate("create_request", {
      requesterEmployeeId,
      counterpartyEmployeeId,
      requesterWorkDate,
      counterpartyWorkDate,
      reason,
    }, "Schedule swap submitted for independent review.");
  }

  async function decide(requestId: number, decision: "approved" | "rejected") {
    await mutate(
      "decide_request",
      { requestId, decision },
      decision === "approved"
        ? "Schedule swap approved after server-side revalidation."
        : "Schedule swap rejected.",
    );
  }

  const pending = swaps.filter((swap) => swap.status === "pending").length;
  const approved = swaps.filter((swap) => swap.status === "approved").length;
  const rejected = swaps.filter((swap) => swap.status === "rejected").length;
  const visible = useMemo(
    () => swaps
      .filter((swap) => filter === "all" || swap.status === "pending")
      .sort((a, b) => b.id - a.id),
    [filter, swaps],
  );

  return (
    <section style={{ marginTop: 16 }}>
      <div className="card-header" style={{ padding: "0 0 12px" }}>
        <div>
          <div className="card-kicker">Roster control</div>
          <h2>Schedule swaps</h2>
          <p>Exchange two employee/date schedules with independent approval and fail-closed revalidation.</p>
        </div>
        <button className="secondary-button" onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner label="Loading" /> : <RefreshCcw size={14} className="i-cyan" />} Refresh
        </button>
      </div>

      <section className="stats-grid">
        <Metric label="Pending" value={String(pending)} hint="awaiting independent review" icon={<ArrowLeftRight size={16} className="i-amber" />} tone={pending ? "amber" : "slate"} />
        <Metric label="Approved" value={String(approved)} hint="overrides written after revalidation" icon={<Check size={16} className="i-green" />} tone={approved ? "mint" : "slate"} />
        <Metric label="Rejected" value={String(rejected)} hint="no roster change written" icon={<X size={16} className="i-red" />} tone={rejected ? "red" : "slate"} />
        <Metric label="Four-eyes" value="On" hint="requester cannot self-approve" icon={<ShieldCheck size={16} className="i-cyan" />} tone="blue" />
      </section>

      <div className="notice notice-slate">
        <ShieldCheck size={15} className="i-green" />
        <span>
          <strong>Approval revalidates both schedules.</strong> If either roster changed, became unassigned, gained an override, or conflicts with another pending swap, approval fails instead of guessing.
        </span>
      </div>

      <section className="module-grid two" style={{ marginTop: 16 }}>
        <article className="card">
          <div className="card-header">
            <div>
              <div className="card-kicker">Request</div>
              <h2>Propose a schedule swap</h2>
              <p>The server snapshots the payroll-relevant schedule for both employee/date assignments.</p>
            </div>
          </div>
          <div className="setting-form">
            <label>
              Employee A
              <select value={requesterEmployeeId || ""} onChange={(event) => setRequesterEmployeeId(Number(event.target.value))}>
                {data.employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>{employee.employeeNo} · {employee.firstName} {employee.lastName}</option>
                ))}
              </select>
            </label>
            <label>Employee A date<input type="date" value={requesterWorkDate} onChange={(event) => setRequesterWorkDate(event.target.value)} /></label>
            <label>
              Employee B
              <select value={counterpartyEmployeeId || ""} onChange={(event) => setCounterpartyEmployeeId(Number(event.target.value))}>
                {data.employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>{employee.employeeNo} · {employee.firstName} {employee.lastName}</option>
                ))}
              </select>
            </label>
            <label>Employee B date<input type="date" value={counterpartyWorkDate} onChange={(event) => setCounterpartyWorkDate(event.target.value)} /></label>
            <label>Reason<input value={reason} maxLength={240} onChange={(event) => setReason(event.target.value)} /></label>
          </div>
          <div className="run-actions">
            <button className="primary-button brand" disabled={saving !== null || data.employees.length < 2} onClick={() => void createSwap()}>
              {saving === "create" ? <Spinner label="Saving" /> : <ArrowLeftRight size={14} />} Submit swap
            </button>
          </div>
        </article>

        <article className="card table-card">
          <div className="table-toolbar">
            <div>
              <div className="card-kicker">Decision queue</div>
              <h2 style={{ margin: "3px 0 0" }}>Swap requests</h2>
            </div>
            <div className="toolbar-spacer" />
            <Segmented
              label="Schedule swap filter"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "pending", label: `Pending (${pending})` },
                { value: "all", label: `All (${swaps.length})` },
              ]}
            />
          </div>
          <div className="data-table-wrap slim-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Swap</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((swap) => {
                  const requester = employees.get(swap.requesterEmployeeId);
                  const counterparty = employees.get(swap.counterpartyEmployeeId);
                  return (
                    <tr key={swap.id}>
                      <td>
                        <strong>{requester ? `${requester.firstName} ${requester.lastName}` : `Employee #${swap.requesterEmployeeId}`}</strong>
                        <div className="id">{swap.requesterWorkDate}</div>
                        <div className="id">↔ {counterparty ? `${counterparty.firstName} ${counterparty.lastName}` : `Employee #${swap.counterpartyEmployeeId}`} · {swap.counterpartyWorkDate}</div>
                      </td>
                      <td>{swap.reason}</td>
                      <td>
                        <Status value={swap.status} />
                        <div className="id">Requested by {swap.requestedBy}</div>
                      </td>
                      <td>
                        {swap.status === "pending" ? (
                          <span className="action-group">
                            <button className="tiny-button approve" disabled={saving !== null} onClick={() => void decide(swap.id, "approved")}>
                              <Check size={13} /> Approve
                            </button>
                            <button className="tiny-button decline" disabled={saving !== null} onClick={() => void decide(swap.id, "rejected")}>
                              <X size={13} /> Reject
                            </button>
                          </span>
                        ) : (
                          <span className="id">{swap.decidedBy ? `By ${swap.decidedBy}` : "Final"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!loading && visible.length === 0 && (
              <EmptyState icon={<ArrowLeftRight size={20} className="i-green" />} title="No schedule swaps in this view">
                New swap requests will appear here for independent review.
              </EmptyState>
            )}
          </div>
        </article>
      </section>
    </section>
  );
}
