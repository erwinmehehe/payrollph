"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Download,
  FileText,
  LockKeyhole,
  ShieldCheck,
  Upload,
  UsersRound,
  WalletCards,
} from "lucide-react";
import {
  dashboardDate,
  dashboardMoney,
  dashboardPayrollSummary,
} from "@/lib/dashboard-presentation";
import type { DashboardData, PayrollRun } from "./types";
import { Status } from "./ui";
import { StatutoryRemittanceWatch } from "./statutory-remittance-watch";
import { taskFirstUiEnabled, type TaskTarget } from "@/lib/task-first-ui";

type Props = {
  data: DashboardData;
  currentRun?: PayrollRun;
  role: "owner" | "payroll" | "checker";
  onPage: (page: string) => void;
  onNewRun: () => void;
  onTask?: (target: TaskTarget) => void;
};

export function CleanRoleDashboard({
  data,
  currentRun: run,
  role,
  onPage,
  onNewRun,
  onTask,
}: Props) {
  const active = data.employees.filter(
    (employee) => employee.status === "Active",
  );
  const missingBank = active.filter(
    (employee) => !employee.bankAccount || !employee.bankCode,
  ).length;
  const summary = dashboardPayrollSummary(run, missingBank);
  const releaseCheck = useReleaseCheck(role === "owner" ? run : undefined);
  const releaseReady = Boolean(
    run?.status === "Ready for release" && releaseCheck?.ready,
  );
  const passed = (key: string) =>
    Boolean(releaseCheck?.items.find((item) => item.key === key)?.passed);
  const openPayroll = () => (run ? (taskFirstUiEnabled() && onTask ? onTask({page:"Payroll",runId:run.id,focus:"workflow"}) : onPage("Payroll")) : onNewRun());
  const openTask = (target: TaskTarget) => taskFirstUiEnabled() && onTask ? onTask(target) : onPage(target.page);
  return (
    <div className="clean-dashboard" data-role-dashboard={role}>
      <div className="clean-heading">
        <div>
          <h1>
            {role === "payroll"
              ? "Let’s make payday a good day."
              : role === "owner"
                ? "Ready for payday"
                : "Payroll review"}
          </h1>
          <p>
            {role === "payroll"
              ? "Here’s where your payroll stands."
              : role === "owner"
                ? `${run?.periodLabel ?? "Next payroll"} · ${run?.employeeCount ?? active.length} employees`
                : "Review changes. Resolve exceptions."}
          </p>
        </div>
        {role === "owner" ? <Status value={run?.status ?? "Not started"} /> : (
          <span className="clean-period">{run?.periodLabel ?? "Your workspace"}</span>
        )}
      </div>
      {role === "payroll" ? (
        <PayrollHome
          data={data}
          run={run}
          onPage={onPage}
          onOpen={openPayroll}
          onTask={openTask}
        />
      ) : role === "owner" ? (
        <section className="clean-card clean-owner">
          <div
            className={`clean-assurance ${releaseReady || summary.released ? "clear" : "pending"}`}
          >
            <ShieldCheck size={28} />
            <div>
              <h2>
                {summary.released
                  ? "Payroll released"
                  : releaseReady
                    ? "All checks completed"
                    : "Checks before release"}
              </h2>
              <CheckLine ok={passed("calculation")}>
                Payroll calculated
              </CheckLine>
              <CheckLine ok={passed("approval")}>Checker approved</CheckLine>
              <CheckLine ok={passed("exceptions")}>
                {run?.exceptions
                  ? `${run.exceptions} payroll exceptions need review`
                  : "No unresolved payroll exceptions"}
              </CheckLine>
              <CheckLine ok={passed("bank")}>
                Payout details for this payroll
              </CheckLine>
              {!releaseCheck && (
                <p className="clean-muted" role="status">
                  Open Payroll for the full release checklist. Checks remain
                  unverified until loaded.
                </p>
              )}
            </div>
          </div>
          <div className="clean-funding">
            <div>
              <span className="clean-muted">Net payroll funding</span>
              <strong>{dashboardMoney(summary.net)}</strong>
              <p>Payday: {dashboardDate(run?.payDate)}</p>
            </div>
            <div className="clean-funding-note">
              <WalletCards size={24} />
              <div>
                <strong>Payout details</strong>
                <p>Confirm the funding account before release.</p>
                <button type="button" className="clean-link" onClick={openPayroll}>View details <ArrowRight size={15} /></button>
              </div>
            </div>
          </div>
          <button
            type="button"
            className={`clean-button ${releaseReady ? "release" : ""}`}
            onClick={openPayroll}
          >
            <LockKeyhole size={17} />
            {summary.released
              ? "View released payroll"
              : releaseReady
                ? "Review and release"
                : run
                  ? "Continue payroll"
                  : "Create payroll"}
            <ArrowRight size={17} />
          </button>
          <p className="clean-footnote">
            {releaseReady
              ? "Confirm the amount and payout details before release."
              : summary.released
                ? "View payout progress and released payslips."
                : "Review the remaining checks in your payroll workspace."}
          </p>
        </section>
      ) : (
        <CheckerHome run={run} onPage={onPage} />
      )}
      {role !== "checker" && (
        <PayrollHistory
          runs={data.payrollRuns}
          onOpen={() => onPage("Payroll")}
        />
      )}
      {role !== "checker" && (
        <StatutoryRemittanceWatch
          organizationId={data.selectedOrganization.id}
          onOpen={() => onPage("Payroll")}
        />
      )}
    </div>
  );
}

type ReleaseCheck = {
  ready: boolean;
  items: Array<{ key: string; passed: boolean }>;
};
function useReleaseCheck(run?: PayrollRun) {
  const [result, setResult] = useState<{
    key: string;
    value: ReleaseCheck;
  } | null>(null);
  const runId = run?.id;
  const key = run ? String(run.id) + ":" + run.status : "";
  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController();
    fetch(`/api/payroll-runs/${runId}/release-checklist`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Checklist unavailable");
        const value = await response.json();
        if (!controller.signal.aborted) setResult({ key, value });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult(null);
      });
    return () => controller.abort();
  }, [runId, key]);
  return result?.key === key ? result.value : null;
}

function PayrollHome({
  data,
  run,
  onPage,
  onOpen,
  onTask,
}: {
  data: DashboardData;
  run?: PayrollRun;
  onPage: Props["onPage"];
  onOpen: () => void;
  onTask?: (target: TaskTarget) => void;
}) {
  const active = data.employees.filter(
    (employee) => employee.status === "Active",
  );
  const missingBank = active.filter(
    (employee) => !employee.bankAccount || !employee.bankCode,
  ).length;
  const summary = dashboardPayrollSummary(run, missingBank);
  const attendanceIds = new Set(
    (data.punches ?? [])
      .filter(
        (punch) =>
          (!run ||
            (punch.workDate >= run.periodStart &&
              punch.workDate <= run.periodEnd)) &&
          !["complete", "present", "ok", "approved"].includes(
            punch.status.toLowerCase(),
          ),
      )
      .map((punch) => punch.employeeId),
  );
  const attendance = attendanceIds.size;
  const exceptions = run?.exceptions ?? 0;
  const attention = attendance + exceptions + missingBank;
  const step =
    !run || attendance > 0 ? 0 : !summary.calculated ? 1 : exceptions ? 2 : 3;
  const submitted =
    run &&
    ["Pending approval", "Ready for release", "Released"].includes(run.status);
  return (
    <>
      <div className="clean-payroll-top">
        <section className="clean-card clean-current-payroll">
          <span className="clean-eyebrow">Current payroll</span>
          <CardHeader
            title={run ? `${run.periodLabel} payroll` : "Your next payroll"}
          >
            <Status value={run?.status ?? "Not started"} />
          </CardHeader>
          <p className="clean-muted">
            {run?.employeeCount ?? active.length} employees
            {run ? ` · ${run.scopeLabel}` : " · Create a run to get started"}
          </p>
          <ol className="clean-steps" aria-label="Payroll progress">
            {["Inputs", "Calculate", "Review", "Submit"].map((label, i) => (
              <li
                key={label}
                className={
                  submitted || i < step ? "done" : i === step ? "current" : ""
                }
                aria-current={!submitted && i === step ? "step" : undefined}
              >
                <span>
                  {submitted || i < step ? <Check size={14} /> : i + 1}
                </span>
                <strong>{label}</strong>
              </li>
            ))}
          </ol>
          <div className="clean-card-footer">
            <span>
              {submitted
                ? "Track review and payout progress in Payroll."
                : summary.calculated
                  ? "Review your register before submitting payroll."
                  : "Complete inputs before calculating payroll."}
            </span>
            <button type="button" className="clean-button" onClick={onOpen}>
              {!run
                ? "Create payroll"
                : summary.released
                  ? "View payroll"
                  : "Continue payroll"}
              <ArrowRight size={16} />
            </button>
          </div>
        </section>
        <section className="clean-card clean-payday">
          <h2>{summary.released ? "Payday" : "Upcoming payday"}</h2>
          <CalendarDays size={24} />
          <strong>
            {run
              ? new Intl.DateTimeFormat("en-PH", {
                  day: "numeric",
                  timeZone: "Asia/Manila",
                }).format(new Date(run.payDate + "T00:00:00+08:00"))
              : "—"}
          </strong>
          <span>{dashboardDate(run?.payDate)}</span>
          <p>
            <UsersRound size={16} />
            {run?.employeeCount ?? active.length} employees
          </p>
        </section>
      </div>
      <div className="clean-metrics">
        <SummaryMetric
          icon={<CircleDollarSign size={22} />}
          label="Gross pay"
          value={dashboardMoney(summary.gross)}
          note={
            summary.calculated
              ? "Current payroll"
              : "Available after calculation"
          }
        />
        <SummaryMetric
          icon={<FileText size={22} />}
          label="Deductions"
          value={dashboardMoney(summary.deductions)}
          note={
            summary.calculated
              ? "Current payroll"
              : "Available after calculation"
          }
          tone="amber"
        />
        <SummaryMetric
          icon={<WalletCards size={22} />}
          label="Net pay"
          value={dashboardMoney(summary.net)}
          note={
            summary.calculated
              ? "Current payroll"
              : "Available after calculation"
          }
          tone="green"
        />
        <SummaryMetric
          icon={<UsersRound size={22} />}
          label="Employees"
          value={String(run?.employeeCount ?? active.length)}
          note={run ? "Included in this run" : "Active employees"}
        />
      </div>
      <div className="clean-work-grid">
        <section className="clean-card">
          <CardHeader title="Needs your attention">
            <span className={`clean-count ${attention ? "attention" : ""}`}>
              {attention}
            </span>
          </CardHeader>
          <ActionRow
            icon={<AlertCircle size={19} />}
            tone={attendance ? "rose" : "green"}
            title={
              attendance
                ? `${attendance} employees have incomplete attendance`
                : "Attendance inputs are clear"
            }
            detail={
              attendance
                ? "Resolve missing time entries before calculation."
                : "No incomplete attendance in the loaded period."
            }
            onClick={() => onTask?.({page:"Time & attendance",filter:"attendance-exceptions"}) ?? onPage("Time & attendance")}
          />
          <ActionRow
            icon={<ClipboardCheck size={19} />}
            tone={exceptions ? "amber" : "green"}
            title={
              exceptions
                ? `${exceptions} payroll exceptions to review`
                : summary.calculated
                  ? "No payroll exceptions"
                  : "Payroll hasn’t been calculated yet"
            }
            detail={
              exceptions
                ? "Check flagged entries in your payroll register."
                : "Review the register in your payroll workspace."
            }
            onClick={onOpen}
          />
          <ActionRow
            icon={<ShieldCheck size={19} />}
            tone={missingBank ? "rose" : "green"}
            title={
              missingBank
                ? `${missingBank} employees need payout details`
                : "Bank details are complete"
            }
            detail={
              active.length
                ? "Payout details for active employees."
                : "Add your team to prepare for payday."
            }
            onClick={() => onTask?.({page:"People",filter:"missing-payout"}) ?? onPage("People")}
          />
        </section>
        <section className="clean-card">
          <CardHeader title="Quick actions" />
          <ActionRow
            icon={<Upload size={19} />}
            title="Import adjustments"
            onClick={() => onTask && run ? onTask({page:"Payroll",runId:run.id,focus:"workflow"}) : onOpen()}
          />
          <ActionRow
            icon={<FileText size={19} />}
            title="Preview payroll register"
            onClick={() => onTask && run ? onTask({page:"Payroll",runId:run.id,focus:"register"}) : onOpen()}
          />
          <ActionRow
            icon={<AlertCircle size={19} />}
            title="Review exceptions"
            onClick={() => onTask && run ? onTask({page:"Payroll",runId:run.id,focus:"exceptions"}) : onOpen()}
          />
        </section>
      </div>
    </>
  );
}

type VarianceSummary = {
  runId: number;
  runStatus?: string;
  summary: {
    exceptionCount: number;
    changedEmployees: number;
    categoryCounts: Record<string, number>;
  };
};
function CheckerHome({
  run,
  onPage,
}: {
  run?: PayrollRun;
  onPage: Props["onPage"];
}) {
  const [result, setResult] = useState<VarianceSummary | null>(null);
  const [failure, setFailure] = useState<number | null>(null);
  const [tab, setTab] = useState("changes");
  const runId = run?.id;
  const runStatus = run?.status;
  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController();
    fetch(`/api/payroll-runs/${runId}/variance`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Variance unavailable");
        const body = await response.json();
        if (!controller.signal.aborted)
          setResult({ runId, runStatus, summary: body.summary });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailure(runId);
      });
    return () => controller.abort();
  }, [runId, runStatus]);
  const loaded =
    result?.runId === run?.id && result?.runStatus === run?.status
      ? result
      : null;
  const counts = loaded?.summary.categoryCounts;
  const exceptions = loaded?.summary.exceptionCount ?? run?.exceptions ?? 0;
  const categories = [
    ["salary_change", "Salary changes"],
    ["new_hire", "New hires"],
    ["overtime_spike", "Overtime increases"],
    ["bank_details", "Bank detail changes"],
    ["statutory", "Statutory changes"],
    ["retro", "Retro adjustments"],
    ["separation", "Separations"],
    ["net_variance", "Net pay changes"],
    ["new_to_run", "Employees new to this run"],
    ["missing_from_run", "Employees missing from this run"],
  ];
  const total = loaded?.summary.changedEmployees ?? null;
  return (
    <section className="clean-card clean-checker">
      <CardHeader title={run?.periodLabel ?? "No payroll to review"}>
        <Status value={run?.status ?? "Not started"} />
      </CardHeader>
      <p className="clean-muted">
        {run
          ? `${run.employeeCount} employees · ${dashboardDate(run.payDate)}`
          : "Your review summary appears when a payroll run is available."}
      </p>
      <div className="clean-net-strip">
        <span>Net pay</span>
        <strong>{dashboardMoney(dashboardPayrollSummary(run, 0).net)}</strong>
      </div>
      <div
        className="clean-tabs"
        role="tablist"
        aria-label="Payroll review sections"
      >
        {[
          ["changes", `Changes${total === null ? "" : ` (${total})`}`],
          ["exceptions", `Exceptions (${exceptions})`],
          ["summary", "Summary"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`review-tab-${id}`}
            aria-controls="review-panel"
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
            onKeyDown={(event) => {
              const ids = ["changes", "exceptions", "summary"];
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                const next =
                  ids[
                    (ids.indexOf(id) + (event.key === "ArrowRight" ? 1 : 2)) % 3
                  ];
                setTab(next);
                document.getElementById(`review-tab-${next}`)?.focus();
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        id="review-panel"
        role="tabpanel"
        aria-labelledby={`review-tab-${tab}`}
      >
        {tab === "changes" ? (
          <>
            <h3>What changed?</h3>
            {run && !loaded && (
              <p className="clean-muted" role="status">
                {failure === run.id
                  ? "Comparison unavailable. Open payroll review to try again."
                  : "Loading the stored payroll comparison…"}
              </p>
            )}
            {categories.map(([key, label]) => (
              <ActionRow
                key={key}
                icon={<FileText size={18} />}
                title={label}
                detail={
                  counts ? `${counts[key] ?? 0} employees` : "Unavailable"
                }
                onClick={() => onPage("Payroll")}
              />
            ))}
          </>
        ) : tab === "exceptions" ? (
          <ActionRow
            icon={<AlertCircle size={20} />}
            tone={exceptions ? "amber" : "green"}
            title={
              exceptions
                ? `${exceptions} exceptions need review`
                : run
                  ? "No flagged payroll exceptions"
                  : "No payroll available"
            }
            detail="Open the payroll workspace to inspect entries and validation checks."
            onClick={() => onTask?.({page:"Payroll",runId:run?.id,focus:"exceptions"}) ?? onPage("Payroll")}
          />
        ) : (
          <div className="clean-metrics">
            <SummaryMetric
              label="Gross pay"
              value={dashboardMoney(dashboardPayrollSummary(run, 0).gross)}
            />
            <SummaryMetric
              label="Deductions"
              value={dashboardMoney(dashboardPayrollSummary(run, 0).deductions)}
            />
            <SummaryMetric
              label="Employees"
              value={String(run?.employeeCount ?? 0)}
            />
          </div>
        )}
      </div>
      {exceptions > 0 && (
        <div className="clean-notice">
          <AlertCircle size={20} />
          <div>
            <strong>{exceptions} exceptions need review</strong>
            <p>Resolve flagged entries before approval.</p>
          </div>
        </div>
      )}
      <div className="clean-card-footer">
        <button
          type="button"
          className="clean-button secondary"
          disabled={!run}
          onClick={() => onPage("Payroll")}
        >
          <Download size={16} />
          Open comparison
        </button>
        <button
          type="button"
          className="clean-button"
          disabled={!run}
          onClick={() => onPage("Payroll")}
        >
          {exceptions ? "Review exceptions" : "Review payroll"}
          <ArrowRight size={16} />
        </button>
      </div>
    </section>
  );
}

export function CardHeader({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="clean-card-header">
      <h2>{title}</h2>
      {children}
    </div>
  );
}
export function SummaryMetric({
  icon,
  label,
  value,
  note,
  tone = "blue",
}: {
  icon?: ReactNode;
  label: string;
  value: string;
  note?: string;
  tone?: string;
}) {
  return (
    <div className="clean-card clean-metric">
      {icon && <span className={`clean-icon ${tone}`}>{icon}</span>}
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {note && <small>{note}</small>}
      </div>
    </div>
  );
}
function CheckLine({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <p className="clean-check-line">
      <span className={ok ? "verified" : "unverified"}>
        {ok ? <Check size={13} /> : <AlertCircle size={13} />}
      </span>
      {children}
    </p>
  );
}
function ActionRow({
  icon,
  title,
  detail,
  onClick,
  tone = "blue",
}: {
  icon: ReactNode;
  title: string;
  detail?: string;
  onClick: () => void;
  tone?: string;
}) {
  return (
    <button type="button" className="clean-action-row" onClick={onClick}>
      <span className={`clean-icon ${tone}`}>{icon}</span>
      <span>
        <strong>{title}</strong>
        {detail && <small>{detail}</small>}
      </span>
      <ChevronRight size={17} />
    </button>
  );
}
function PayrollHistory({
  runs,
  onOpen,
}: {
  runs: PayrollRun[];
  onOpen: () => void;
}) {
  return (
    <section className="clean-card">
      <CardHeader title="Recent payrolls">
        <button type="button" className="clean-link" onClick={onOpen}>
          View all <ArrowRight size={15} />
        </button>
      </CardHeader>
      <div className="clean-table-scroll">
        <table className="clean-history">
          <thead>
            <tr>
              <th>Payroll period</th>
              <th>Employees</th>
              <th>Net pay</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {runs.slice(0, 4).map((run) => (
              <tr key={run.id}>
                <td>
                  <button type="button" className="clean-link" onClick={onOpen}>
                    {run.periodLabel}
                  </button>
                </td>
                <td>{run.employeeCount}</td>
                <td>{dashboardMoney(dashboardPayrollSummary(run, 0).net)}</td>
                <td>
                  <Status value={run.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!runs.length && (
        <p className="clean-muted">
          Your payroll history will appear here after you create a run.
        </p>
      )}
    </section>
  );
}
