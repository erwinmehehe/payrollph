"use client";

import { useCallback, useMemo, useState } from "react";
import { CheckCircle2, Clock3, FileCheck2, RefreshCcw, ShieldAlert } from "lucide-react";
import type { DashboardData, Notify } from "./types";
import { phWorkDateAt } from "@/lib/workforce-manager-actions";
import { EmptyState, Metric, Spinner, Status } from "./ui";
import { useScopedAsyncResource } from "./use-scoped-async-resource";
import { resolveWorkforcePayrollHandoff, verifiedWorkforceTimesheetCounts } from "@/lib/workforce-payroll-handoff";
import { firstPayrollRunHref } from "@/lib/first-payroll-run-navigation";

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

type TimesheetExpectation = {
  id: number;
  payrollRunId: number;
  employeeId: number;
  periodStart: string;
  periodEnd: string;
  expectedBy: string;
  enforcementMode: "advisory" | "block";
  status: "expected" | "submitted" | "approved" | "cancelled";
  version: number;
  latestTimesheetId: number | null;
  latestTimesheetVersion: number | null;
};

type Payload = {
  policy: { active: boolean; enforcementMode: "advisory" | "block" };
  manager: boolean;
  employees: Array<{ id: number; employeeNo: string; name: string; orgUnitId: number | null }>;
  latest: Timesheet[];
  history: Timesheet[];
  expectations: TimesheetExpectation[];
};

function localToday() {
  return phWorkDateAt();
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
  initialPeriod,
  onPeriodChange,
}: {
  data: DashboardData;
  notify: Notify;
  canManage: boolean;
  initialPeriod?: { periodStart: string; periodEnd: string };
  onPeriodChange?: (period: { periodStart: string; periodEnd: string }) => void;
}) {
  const organizationId = data.selectedOrganization.id;
  const today = localToday();
  const [periodEnd, setPeriodEnd] = useState(initialPeriod?.periodEnd ?? today);
  const [periodStart, setPeriodStart] = useState(initialPeriod?.periodStart ?? addDays(today, -14));
  const [busy, setBusy] = useState<string | null>(null);

  const fetchTimesheets = useCallback(async (signal: AbortSignal) => {
    const params = new URLSearchParams({
      organizationId: String(organizationId),
      periodStart,
      periodEnd,
    });
    const response = await fetch(`/api/workforce/timesheets?${params.toString()}`, { cache: "no-store", signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Could not load workforce timesheets.");
    return body as Payload;
  }, [organizationId, periodEnd, periodStart]);

  const scopeKey = JSON.stringify([organizationId, periodStart, periodEnd]);
  const onLoadError = useCallback((error: Error) => notify(error.message, "err"), [notify]);
  const { data: payload, error: loadError, loading, reload: load } = useScopedAsyncResource(scopeKey, fetchTimesheets, onLoadError);
  // Unknown or incomplete reads cannot masquerade as zero open timecards or safe approvals.
  const verifiedCounts = !loading && !loadError
    ? verifiedWorkforceTimesheetCounts(payload, { periodStart, periodEnd })
    : null;
  const trustedPayload = verifiedCounts ? payload : null;
  const handoff = resolveWorkforcePayrollHandoff({
    organizationId,
    viewerId: data.user?.id,
    access: data.access,
    connectedNavigationEnabled: data.firstPayrollConnectedEnabled === true,
    period: { periodStart, periodEnd },
    timesheetResponse: trustedPayload,
    payrollRuns: data.payrollRuns,
    multiEntityMode: data.multiEntity?.enabled === true,
    selectedLegalEntityId: data.multiEntity?.enabled && !data.multiEntity.group
      ? data.multiEntity.legalEntityId
      : null,
  });

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
    () => new Map((trustedPayload?.employees ?? []).map((employee) => [employee.id, employee])),
    [trustedPayload],
  );
  const latestByEmployee = useMemo(
    () => new Map((trustedPayload?.latest ?? []).map((row) => [row.employeeId, row])),
    [trustedPayload],
  );
  const expectationByEmployee = useMemo(() => {
    const map = new Map<number, TimesheetExpectation>();
    for (const row of trustedPayload?.expectations ?? []) {
      if (!map.has(row.employeeId)) map.set(row.employeeId, row);
    }
    return map;
  }, [trustedPayload]);

  const approved = verifiedCounts?.approved;
  const submitted = verifiedCounts?.submitted;
  const stale = verifiedCounts?.stale;
  const missingExpected = verifiedCounts?.expectedMissing;
  const blockers = verifiedCounts?.blockers;

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
            Each submitted version stores an immutable attendance and schedule snapshot. New payroll runs also freeze the exact employee cohort expected to submit, so a true missing timesheet is distinguishable from a period with no obligation.
          </p>
        </div>
        <button className="secondary-button" onClick={() => void load()} disabled={loading}>
          <RefreshCcw size={14} /> Refresh
        </button>
      </div>

      {loading && <div style={{ padding: "0 18px 18px" }}><Spinner label="Loading timesheets" /></div>}
      {loadError && <div className="notice notice-red" role="alert" style={{ margin: "0 18px 18px" }}>{loadError.message}</div>}

      <section className="stats-grid" style={{ padding: "0 18px 18px" }}>
        <Metric label="Approved" value={approved === undefined ? "—" : String(approved)} hint={verifiedCounts ? "latest employee versions" : "Source not verified"} icon={<CheckCircle2 size={16} />} tone="mint" />
        <Metric label="Submitted" value={submitted === undefined ? "—" : String(submitted)} hint={verifiedCounts ? "awaiting independent review" : "Source not verified"} icon={<FileCheck2 size={16} />} tone={submitted ? "amber" : "slate"} />
        <Metric label="Stale" value={stale === undefined ? "—" : String(stale)} hint={verifiedCounts ? "evidence changed after submission" : "Source not verified"} icon={<RefreshCcw size={16} />} tone={stale ? "amber" : "slate"} />
        <Metric label="Expected missing" value={missingExpected === undefined ? "—" : String(missingExpected)} hint={verifiedCounts ? "frozen payroll cohort; never submitted" : "Source not verified"} icon={<Clock3 size={16} />} tone={missingExpected ? "amber" : "slate"} />
        <Metric label="Blockers" value={blockers === undefined ? "—" : String(blockers)} hint={verifiedCounts ? "attendance / OT integrity issues" : "Source not verified"} icon={<ShieldAlert size={16} />} tone={blockers ? "amber" : "slate"} />
      </section>

      <div className="setting-form" style={{ padding: "0 18px 18px" }}>
        <label>Period start<input type="date" value={periodStart} onChange={(event) => {
          const nextStart = event.target.value;
          setPeriodStart(nextStart);
          onPeriodChange?.({ periodStart: nextStart, periodEnd });
        }} /></label>
        <label>Period end<input type="date" min={periodStart} value={periodEnd} onChange={(event) => {
          const nextEnd = event.target.value;
          setPeriodEnd(nextEnd);
          onPeriodChange?.({ periodStart, periodEnd: nextEnd });
        }} /></label>
        {canManage && data.access?.companyWide && (
          <label>
            Payroll enforcement
            <select
              value={trustedPayload?.policy.enforcementMode ?? "advisory"}
              onChange={(event) => void updatePolicy(event.target.value === "block" ? "block" : "advisory")}
              disabled={busy !== null || !trustedPayload}
            >
              <option value="advisory">Advisory only</option>
              <option value="block">Require approved timesheets</option>
            </select>
          </label>
        )}
      </div>

      {trustedPayload?.policy.enforcementMode === "block" && trustedPayload.policy.active && (
        <div className="notice notice-amber" style={{ margin: "0 18px 18px" }}>
          <ShieldAlert size={15} />
          <span>
            <strong>Payroll gate is blocking.</strong> Every active employee in the payroll scope must have an approved latest timesheet version for this exact period before payroll can calculate.
          </span>
        </div>
      )}

      {handoff.kind !== "restricted" && (
        <section className="notice notice-slate" data-wfm-payroll-handoff
          aria-label="Timesheet to payroll review handoff"
          style={{ margin: "0 18px 18px", display: "grid", gap: 8 }}>
          <strong>Payroll review handoff · {periodStart} to {periodEnd}</strong>
          {handoff.kind === "disabled" ? (
            <p>Direct payroll-run navigation is not enabled for this employer. Use the existing Payroll workspace to review runs.</p>
          ) : handoff.kind === "unverified" ? (
            <p role="status">The selected cutoff or source data could not be verified. No payroll-run link is available. Refresh timesheets or retry the employer workspace.</p>
          ) : (
            <>
              <p>
                Visible timecard source: {handoff.counts.employees} employees · {handoff.counts.approved} approved · {handoff.counts.submitted} submitted · {handoff.counts.stale} stale · {handoff.counts.expectedMissing} expected submissions missing · {handoff.counts.blockers} recorded blockers.
              </p>
              <p>This is a read-only navigation shortcut, not a payroll readiness, checker approval, records-release, or payout decision. The Payroll workspace enforces its own source and role checks.</p>
              {handoff.runs.length === 0 ? (
                <p>No exact-cutoff payroll run appears in the currently loaded employer dashboard. This is not proof that payroll can proceed.</p>
              ) : (
                <>
                  {handoff.runs.length > 1 && <p>Multiple payroll runs match this cutoff. Choose the intended scope; nothing is selected automatically.</p>}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {handoff.runs.map(run => (
                      <a key={run.id} className="secondary-button"
                        data-wfm-payroll-run-link={run.id}
                        href={firstPayrollRunHref(organizationId, run.id)}
                        style={{ display: "inline-flex", alignItems: "center", minHeight: 44, maxWidth: "100%", overflowWrap: "anywhere" }}>
                        Open payroll run #{run.id} · {run.scopeLabel || run.periodLabel} · {run.status}
                      </a>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </section>
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
            {(trustedPayload?.employees ?? []).map((employee) => {
              const row = latestByEmployee.get(employee.id);
              const expectation = expectationByEmployee.get(employee.id);
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
                  <td>
                    {row
                      ? <Status value={row.status} />
                      : expectation?.status === "expected"
                        ? <><Status value="Expected · not submitted" /><div className="id">Payroll #{expectation.payrollRunId} · due {expectation.expectedBy} · {expectation.enforcementMode}</div></>
                        : <Status value="Not expected / no submission" />}
                  </td>
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
        {trustedPayload && trustedPayload.employees.length === 0 && (
          <EmptyState icon={<Clock3 size={20} />} title="No employees in your WFM scope">
            Timesheets appear here when employees are available in the current workforce scope.
          </EmptyState>
        )}
      </div>
    </article>
  );
}
