"use client";

import {
  ArrowRight,
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileText,
  Plus,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import type { DashboardData, PayrollRun } from "@/components/workspace/types";
import { uiDate, uiMoney, type TaskTarget } from "@/lib/task-first-ui";

type Props = {
  data: DashboardData;
  run?: PayrollRun;
  onTask: (target: TaskTarget) => void;
  onNewRun: () => void;
};

const REVIEW_STATES = ["Pending approval", "Ready for release", "Released"];

export function TaskFirstPayrollHome({ data, run, onTask, onNewRun }: Props) {
  const activeEmployees = data.employees.filter((employee) => employee.status === "Active");
  const missingPayout = activeEmployees.filter(
    (employee) => !employee.bankCode || !employee.bankAccount,
  ).length;
  const attendance = new Set(
    (data.punches ?? [])
      .filter(
        (punch) =>
          (!run || (punch.workDate >= run.periodStart && punch.workDate <= run.periodEnd)) &&
          !(punch.timeIn && punch.timeOut),
      )
      .map((punch) => punch.employeeId),
  ).size;
  const exceptions = run?.exceptions ?? 0;
  const issueSignals = missingPayout + attendance + exceptions;
  const released = run?.status === "Released";
  const failed = run?.status === "Failed";
  const handedOff = Boolean(run && REVIEW_STATES.includes(run.status));
  const calculated = Boolean(run && (Number(run.grossPay) > 0 || released));
  const currentStep = !run
    ? 0
    : failed
      ? 1
      : attendance > 0 && !calculated
        ? 0
        : !calculated
          ? 1
          : exceptions > 0
            ? 2
            : 3;

  const stages = ["Inputs", "Calculate", "Review", "Handoff"] as const;
  const gross = calculated ? Number(run?.grossPay) : null;
  const net = calculated ? Number(run?.netPay) : null;
  const displayMoney = (value: number | null) =>
    value === null ? "Not calculated" : uiMoney(value);
  const payrollTask = (focus: "workflow" | "register" | "exceptions") =>
    run ? onTask({ page: "Payroll", runId: run.id, focus }) : onNewRun();

  const nextAction = !run
    ? "Start your first payroll"
    : failed
      ? "Review failed calculation"
      : handedOff
        ? "Open payroll handoff"
        : exceptions > 0
          ? "Review payroll exceptions"
          : calculated
            ? "Review the register"
            : "Prepare payroll";
  const nextFocus: "workflow" | "register" | "exceptions" =
    !failed && !handedOff && exceptions > 0 ? "exceptions" : !failed && calculated && !handedOff ? "register" : "workflow";
  const nextHint = failed
    ? "The calculation needs attention before this payroll can proceed."
    : handedOff
      ? released
        ? "Payroll has been released. Payment settlement is tracked separately."
        : "This run is in the independent review and release workflow."
      : exceptions > 0
        ? "Resolve flagged entries before sending this run for review."
        : calculated
          ? "Check employee-level amounts before handing the run to a checker."
          : "Confirm attendance, pay details, and adjustments before calculation.";

  return (
    <div className="tf-payroll-home">
      <header className="tf-home-header">
        <div>
          <div className="tf-kicker"><span className="tf-kicker-dot" />PAYROLL / WORKSPACE</div>
          <h1>Payday, without the guesswork.</h1>
          <p>Everything you need to prepare this payroll, all in one place.</p>
        </div>
        <span className="tf-org-chip"><span className="tf-org-mark">{data.selectedOrganization.name.slice(0, 1).toUpperCase()}</span>{data.selectedOrganization.name}<span className="tf-org-dot">·</span>Payroll officer</span>
      </header>

      <div className="tf-payroll-grid">
        <section className="tf-card tf-current" aria-labelledby="tf-current-title">
          <div className="tf-current-top">
            <div>
              <div className="tf-kicker">IN PROGRESS <span className="tf-run-id">{run ? `RUN #${run.id}` : "NO RUN YET"}</span></div>
              <h2 id="tf-current-title">{run?.periodLabel ?? "Start your next payroll"}</h2>
              <p>{run ? `${run.employeeCount} employees · Pay date ${uiDate(run.payDate)}` : "Create a run to begin preparing your team's pay."}</p>
            </div>
            <span className={`tf-status ${failed ? "tf-status-failed" : handedOff ? "tf-status-done" : exceptions ? "tf-status-attention" : "tf-status-open"}`}>
              <span className="tf-status-dot" />{run?.status ?? "Not started"}
            </span>
          </div>

          <div className="tf-progress-label">PAYROLL PROGRESS</div>
          <ol className="tf-step-track" aria-label="Payroll preparation progress">
            {stages.map((stage, index) => {
              const done = handedOff || index < currentStep;
              const current = !handedOff && index === currentStep;
              return <li className={done ? "tf-step-done" : current ? "tf-step-current" : ""} key={stage} aria-current={current ? "step" : undefined}>
                <span className="tf-step-number">{done ? <Check size={15} strokeWidth={3} /> : index + 1}</span><span>{stage}</span>
              </li>;
            })}
          </ol>

          <div className="tf-primary-foot">
            <div className="tf-next-copy">
              <span className="tf-next-label">{handedOff ? "CURRENT POSITION" : "RECOMMENDED NEXT STEP"}</span>
              <strong>{nextAction}</strong>
              <p>{nextHint}</p>
            </div>
            <button type="button" className="tf-primary" onClick={() => payrollTask(nextFocus)}>
              {run ? "Open this run" : "Create payroll"} <ArrowRight size={17} aria-hidden />
            </button>
          </div>
        </section>

        <aside className="tf-card tf-payday" aria-label="Current payroll pay date">
          <div className="tf-payday-heading"><div className="tf-kicker">PAY DATE</div><span className="tf-payday-icon"><CalendarDays size={19} /></span></div>
          <strong>{run ? uiDate(run.payDate) : "Not scheduled"}</strong>
          <p>{run ? `${run.employeeCount} employees in this payroll` : "No payroll run selected"}</p>
          <div className="tf-payday-divider" />
          <span className="tf-payday-detail">PAYROLL SCOPE</span>
          <span className="tf-sublabel">{run?.scopeLabel ?? "New payroll"}</span>
          <div className="tf-payday-bottom"><ShieldCheck size={16} /> Reviewer and release controls stay separate</div>
        </aside>
      </div>

      <div className="tf-overview-heading"><h2>Payroll snapshot</h2><span>Stored figures for the selected run · not payment confirmation</span></div>
      <section className="tf-metrics" aria-label="Stored payroll totals">
        <Metric icon={<Wallet size={17}/>} label="Gross compensation" value={displayMoney(gross)} note={calculated ? "Calculated earnings" : "Awaiting calculation"} />
        <Metric icon={<FileText size={17}/>} label="Deductions" value={displayMoney(gross !== null && net !== null ? Math.max(0, gross - net) : null)} note="Tax, statutory and other" />
        <Metric icon={<ShieldCheck size={17}/>} label="Net pay" value={displayMoney(net)} note={calculated ? "Subject to release controls" : "Awaiting calculation"} emphasis />
        <Metric icon={<Users size={17}/>} label="Employees in run" value={String(run?.employeeCount ?? activeEmployees.length)} note={run ? "Included in selected period" : "Active employee records"} />
      </section>

      <div className="tf-lower-grid">
        <section className="tf-card tf-attention" aria-labelledby="tf-attention-title">
          <div className="tf-card-heading tf-row-heading">
            <div><div className="tf-kicker">01 / WHAT NEEDS WORK</div><h2 id="tf-attention-title">Needs your attention</h2></div>
            <span className={`tf-count ${issueSignals ? "tf-count-issue" : ""}`}>{issueSignals ? `${issueSignals} signals` : "All clear"}</span>
          </div>
          <ActionRow icon={<Clock3 />} issue={attendance > 0}
            title={attendance ? `${attendance} employee(s) with incomplete attendance` : "No incomplete attendance identified"}
            detail={attendance ? "Check missing or unresolved time entries." : "Based on the attendance records currently loaded."}
            action="Review" onClick={() => onTask({ page: "Time & attendance", filter: "attendance-exceptions" })} />
          <ActionRow icon={<AlertTriangle />} issue={exceptions > 0}
            title={exceptions ? `${exceptions} payroll exception(s)` : "No payroll exceptions reported"}
            detail={exceptions ? "Open the flagged entries for this exact run." : "You can still inspect the complete register."}
            action="Inspect" onClick={() => payrollTask(exceptions ? "exceptions" : "register")} />
          <ActionRow icon={<ShieldCheck />} issue={missingPayout > 0}
            title={missingPayout ? `${missingPayout} employee(s) missing payout fields` : "Required payout fields are present"}
            detail="Field completeness does not verify a bank account."
            action="View" onClick={() => onTask({ page: "People", filter: "missing-payout" })} />
          <p className="tf-attention-foot">Counts may overlap by employee and are not a distinct-person total.</p>
        </section>

        <section className="tf-card tf-actions" aria-labelledby="tf-actions-title">
          <div className="tf-card-heading tf-row-heading"><div><div className="tf-kicker">02 / SHORTCUTS</div><h2 id="tf-actions-title">Your next moves</h2></div><ClipboardList size={19} className="tf-section-icon" /></div>
          <ActionRow icon={<ClipboardList />} title="Prepare payroll inputs" detail="Review attendance, pay and adjustments." onClick={() => payrollTask("workflow")} />
          <ActionRow icon={<FileText />} title="Open payroll register" detail="Inspect the employee-level calculation." onClick={() => payrollTask("register")} />
          <ActionRow icon={<Plus />} title="Start a new payroll" detail="Create a separate period without changing this run." onClick={onNewRun} />
        </section>
      </div>
      <p className="tf-footer-note"><CheckCircle2 size={14} aria-hidden/> Values come from the selected run. Calculation, checker approval, payroll release and bank payout are separate operations governed by existing server controls.</p>
    </div>
  );
}

function Metric({ icon, label, value, note, emphasis = false }: {
  icon: ReactNode; label: string; value: string; note: string; emphasis?: boolean;
}) {
  return <div className={`tf-metric ${emphasis ? "tf-metric-emphasis" : ""}`}>
    <span>{icon}{label}</span><strong title={value}>{value}</strong><small>{note}</small>
  </div>;
}

function ActionRow({ icon, title, detail, issue = false, action = "Open", onClick }: {
  icon: ReactNode; title: string; detail: string; issue?: boolean; action?: string; onClick: () => void;
}) {
  return <button type="button" className={`tf-action-row ${issue ? "tf-action-issue" : ""}`} onClick={onClick}>
    <span className={`tf-action-icon ${issue ? "tf-icon-issue" : ""}`}>{icon}</span>
    <span className="tf-action-copy"><strong>{title}</strong><small>{detail}</small></span>
    <span className="tf-action-go">{action}<ArrowRight size={15} aria-hidden /></span>
  </button>;
}
