"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, FileCheck2, RefreshCcw, ShieldAlert } from "lucide-react";
import type { DashboardData, Notify } from "./types";
import { EmptyState, Metric, Spinner, Status } from "./ui";

type Timesheet = {
  id: number;
  employeeId: number;
  periodStart: string;
  periodEnd: string;
  version: number;
  status: string;
  scheduledMinutes: number;
  workedMinutes: number;
  overtimeMinutes: number;
  exceptionCount: number;
  blockerCount: number;
  submittedBy: string | null;
  submittedByUserId: number | null;
  decidedBy: string | null;
  decisionNote: string | null;
};

type Payload = {
  policy: { active: boolean; enforcementMode: "advisory" | "block" };
  manager: boolean;
  employees: Array<{ id: number; employeeNo: string; name: string; orgUnitId: number | null }>;
  latest: Timesheet[];
  history: Timesheet[];
};

function localToday() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function addDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function hours(minutes: number) {
  return `${Math.round(minutes / 6) / 10}h`;
}

export function WorkforceTimesheetPanel({
  data,
  notify,
  canManage,
}: {
  data: DashboardData;
  notify: Notify;
  canManage: boolean;
}) {
  const organizationId = data.selectedOrganization.id;
  const today = localToday();
  const [periodEnd, setPeriodEnd] = useState(today);
  const [periodStart, setPeriodStart] = useState(addDays(today, -14));
  const [payload, setPayload] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({
      organizationId: String(organizationId),
      periodStart,
      periodEnd,
    });
    const response = await fetch(`/api/workforce/timesheets?${params.toString()}`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Could not load workforce timesheets.");
    setPayload(body as Payload);
  }, [organizationId, periodEnd, periodStart]);

  useEffect(() => {
    void load().catch((error) =>
      notify(error instanceof Error ? error.message : "Could not load workforce timesheets.", "err"),
    );
  }, [load, notify]);

  async function mutate(action: string, extra: Record<string, unknown>, success: string) {
    setBusy(action);
    try {
      const response = await fetch("/api/workforce/timesheets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, action, ...extra }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Timesheet action failed.");
      notify(success, "ok");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Timesheet action failed.", "err");
    } finally {
      setBusy(null);
    }
  }

  const employeeById = useMemo(
    () => new Map((payload?.employees ?? []).map((employee) => [employee.id, employee])),
    [payload],
  );
  const latestByEmployee = useMemo(
    () => new Map((payload?.latest ?? []).map((row) => [row.employeeId, row])),
    [payload],
  );

  const approved = (payload?.latest ?? []).filter((row) => row.status === "approved").length;
  const submitted = (payload?.latest ?? []).filter((row) => row.status === "submitted").length;
  const stale = (payload?.latest ?? []).filter((row) => row.status === "stale").length;
  const blockers = (payload?.latest ?? []).reduce((sum, row) => sum + row.blockerCount, 0);

  async function updatePolicy(mode: "advisory" | "block") {
    await mutate("update_policy", {
      enforcementMode: mode,
      active: true,
    }, mode === "block"
      ? "Timesheet approval is now required before payroll processing."
      : "Timesheet approval is advisory for payroll.");
  }

  return (
    <article className="card" style={{ marginTop: 16 }} data-wfm-timesheets>
      <div className="card-header">
        <div>
          <div className="card-kicker">Period finalization</div>
          <h2>Approve the time payroll will consume.</h2>
          <p>
            Each submitted version stores an immutable attendance and schedule snapshot. Changed evidence makes the submitted version stale instead of rewriting history.
          </p>
        </div>
        <button className="secondary-button" onClick={() => void load()}>
          <RefreshCcw size={14} /> Refresh
        </button>
      </div>

      <section className="stats-grid" style={{ padding: "0 18px 18px" }}>
        <Metric label="Approved" value={String(approved)} hint="latest employee versions" icon={<CheckCircle2 size={16} />} tone="mint" />
        <Metric label="Submitted" value={String(submitted)} hint="awaiting independent review" icon={<FileCheck2 size={16} />} tone={submitted ? "amber" : "slate"} />
        <Metric label="Stale" value={String(stale)} hint="evidence changed after submission" icon={<RefreshCcw size={16} />} tone={stale ? "amber" : "slate"} />
        <Metric label="Blockers" value={String(blockers)} hint="attendance / OT integrity issues" icon={<ShieldAlert size={16} />} tone={blockers ? "amber" : "slate"} />
      </section>

      <div className="setting-form" style={{ padding: "0 18px 18px" }}>
        <label>Period start<input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></label>
        <label>Period end<input type="date" min={periodStart} value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></label>
        {canManage && data.access?.companyWide && (
          <label>
            Payroll enforcement
            <select
              value={payload?.policy.enforcementMode ?? "advisory"}
              onChange={(event) => void updatePolicy(event.target.value === "block" ? "block" : "advisory")}
              disabled={busy !== null}
            >
              <option value="advisory">Advisory only</option>
              <option value="block">Require approved timesheets</option>
            </select>
          </label>
        )}
      </div>

      {payload?.policy.enforcementMode === "block" && payload.policy.active && (
        <div className="notice notice-amber" style={{ margin: "0 18px 18px" }}>
          <ShieldAlert size={15} />
          <span>
            <strong>Payroll gate is blocking.</strong> Every active employee in the payroll scope must have an approved latest timesheet version for this exact period before payroll can calculate.
          </span>
        </div>
      )}

      <div className="data-table-wrap slim-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Version</th>
              <th>Scheduled</th>
              <th>Worked / OT</th>
              <th>Exceptions</th>
              <th>Status</th>
              <th>Workflow</th>
            </tr>
          </thead>
          <tbody>
            {(payload?.employees ?? []).map((employee) => {
              const row = latestByEmployee.get(employee.id);
              return (
                <tr key={employee.id}>
                  <td><strong>{employee.name}</strong><div className="id">{employee.employeeNo}</div></td>
                  <td>{row ? `v${row.version}` : "—"}</td>
                  <td>{row ? hours(row.scheduledMinutes) : "—"}</td>
                  <td>{row ? `${hours(row.workedMinutes)} / ${hours(row.overtimeMinutes)} OT` : "—"}</td>
                  <td>
                    {row
                      ? row.blockerCount
                        ? <Status value={`${row.blockerCount} blocker${row.blockerCount === 1 ? "" : "s"}`} />
                        : <span className="id">{row.exceptionCount} review note(s)</span>
                      : "—"}
                  </td>
                  <td>{row ? <Status value={row.status} /> : <Status value="Not submitted" />}</td>
                  <td>
                    {!row || ["rejected", "stale"].includes(row.status) ? (
                      <button
                        className="secondary-button"
                        disabled={busy !== null}
                        onClick={() => void mutate("submit", {
                          employeeId: employee.id,
                          periodStart,
                          periodEnd,
                        }, `${employee.name} timesheet submitted.`)}
                      >
                        Submit
                      </button>
                    ) : row.status === "submitted" && canManage ? (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button
                          className="secondary-button"
                          disabled={busy !== null}
                          onClick={() => void mutate("decide", {
                            timesheetId: row.id,
                            decision: "approved",
                            decisionNote: "Reviewed against attendance and workforce schedule",
                          }, `${employee.name} timesheet approved.`)}
                        >
                          Approve
                        </button>
                        <button
                          className="secondary-button"
                          disabled={busy !== null}
                          onClick={() => void mutate("decide", {
                            timesheetId: row.id,
                            decision: "rejected",
                            decisionNote: "Returned for correction",
                          }, `${employee.name} timesheet returned.`)}
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <span className="id">{row.status === "approved" ? `Approved by ${row.decidedBy ?? "reviewer"}` : "Awaiting reviewer"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {(payload?.employees.length ?? 0) === 0 && (
          <EmptyState icon={<Clock3 size={20} />} title="No employees in your WFM scope">
            Timesheets appear here when employees are available in the current workforce scope.
          </EmptyState>
        )}
      </div>
    </article>
  );
}
