"use client";

import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  CreditCard,
  FileText,
  Plus,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import type { DashboardData, PayrollRun } from "@/components/workspace/types";
import { summarizeTaskFirstPayroll, uiDate, uiMoney, type TaskTarget } from "@/lib/task-first-ui";

type Props = {
  data: DashboardData;
  run?: PayrollRun;
  onTask: (target: TaskTarget) => void;
  onNewRun: () => void;
};

const REVIEW_STATES = ["Pending approval", "Ready for release", "Released"];

export function TaskFirstPayrollHome({ data, run, onTask, onNewRun }: Props) {
  const activeEmployees = data.employees.filter((employee) => employee.status === "Active");
  // The dashboard returns masked bank accounts. An existing masked account still counts as present.
  const missingPayout = activeEmployees.filter(
    (employee) => !employee.bankCode || !employee.bankAccount,
  ).length;
  const incompleteAttendance = new Set(
    (data.punches ?? [])
      .filter(
        (punch) =>
          (!run || (punch.workDate >= run.periodStart && punch.workDate <= run.periodEnd)) &&
          !(punch.timeIn && punch.timeOut),
      )
      .map((punch) => punch.employeeId),
  ).size;
  const exceptions = run?.exceptions ?? 0;
  const issueCategories = [missingPayout, exceptions, incompleteAttendance].filter((count) => count > 0).length;
  const released = run?.status === "Released";
  const failed = run?.status === "Failed";
  const handedOff = Boolean(run && REVIEW_STATES.includes(run.status));
  const { calculated, gross, net, deductions } = summarizeTaskFirstPayroll(run, data.payrollEntries);
  const attendanceEvidenceAvailable = Boolean(data.punches?.length);

  const payrollTask = (focus: "workflow" | "register" | "exceptions") =>
    run ? onTask({ page: "Payroll", runId: run.id, focus }) : onNewRun();

  const nextFocus: "workflow" | "register" | "exceptions" =
    !failed && !handedOff && exceptions > 0
      ? "exceptions"
      : !failed && !handedOff && calculated
        ? "register"
        : "workflow";
  const nextAction = !run
    ? "Create payroll"
    : failed
      ? "Review calculation"
      : handedOff
        ? "View run status"
        : exceptions > 0
          ? "Review exceptions"
          : calculated
            ? "Open register"
            : "Prepare payroll";
  const nextHint = failed
    ? "Calculation failed — review this run before trying again."
    : handedOff
      ? released
        ? "Payroll released. This does not confirm that employees have been paid."
        : "This payroll is in the independent review or release workflow."
      : exceptions > 0
        ? "Review the flagged entries before submitting the run."
        : calculated
          ? "Check stored employee-level amounts before handoff."
          : "Check attendance and pay inputs before calculating.";

  return (
    <div className="tf-payroll-home">
      <header className="tf-home-header">
        <div>
          <span className="tf-kicker">PAYROLL OFFICER <ChevronRight size={13} aria-hidden /> OVERVIEW</span>
          <h1>Payroll overview</h1>
          <p>Your current payroll, exceptions and next steps in one place.</p>
        </div>
      </header>

      <section className="tf-run-strip" aria-labelledby="tf-run-title">
        <div className="tf-strip-info">
          <div className="tf-strip-label">CURRENT PAYROLL</div>
          <div className="tf-strip-title-row">
            <h2 id="tf-run-title">{run?.periodLabel ?? "No payroll run yet"}</h2>
            <span className={`tf-status ${failed ? "tf-status-failed" : released ? "tf-status-done" : exceptions > 0 || run?.status === "Needs review" ? "tf-status-attention" : ""}`}>
              <span className="tf-status-dot" aria-hidden />{run?.status ?? "Not started"}
            </span>
          </div>
          <div className="tf-run-facts">
            <span><CalendarDays size={15} aria-hidden /> {run ? `Pay date ${uiDate(run.payDate)}` : "Pay date not scheduled"}</span>
            <span><Users size={15} aria-hidden /> {run ? `${run.employeeCount} employees` : `${activeEmployees.length} active employees`}</span>
            {run && <span><ShieldCheck size={15} aria-hidden /> {run.scopeLabel}</span>}
          </div>
        </div>
        <div className="tf-strip-next">
          <p>{nextHint}</p>
          <button type="button" className="tf-primary" onClick={() => payrollTask(nextFocus)}>
            {nextAction}<ArrowRight size={17} aria-hidden />
          </button>
        </div>
      </section>

      <section className="tf-metrics" aria-label="Current payroll summary">
        <Metric icon={<Wallet size={18}/>} label="Gross compensation" value={gross === null ? "Not calculated" : uiMoney(gross)} note={calculated ? "Calculated earnings" : "Awaiting calculation"} />
        <Metric icon={<FileText size={18}/>} label="Deductions" value={deductions === null ? (calculated ? "Verify register" : "Not calculated") : uiMoney(deductions)} note={deductions === null ? "Entry totals not yet reconciled" : "Reconciled stored payroll entries"} />
        <Metric icon={<ShieldCheck size={18}/>} label="Net pay" value={net === null ? "Not calculated" : uiMoney(net)} note={released ? "Released, payment unconfirmed" : calculated ? "Not yet released" : "Awaiting calculation"} emphasis />
        <Metric icon={<Users size={18}/>} label={run ? "Employees in run" : "Active employees"} value={String(run?.employeeCount ?? activeEmployees.length)} note={run ? "Included in selected payroll" : "No payroll run selected"} />
      </section>

      <div className="tf-lower-grid">
        <section className="tf-card tf-attention" aria-labelledby="tf-attention-title">
          <div className="tf-card-heading">
            <div>
              <h2 id="tf-attention-title">Needs your attention</h2>
              <p>Items worth checking before payroll moves forward.</p>
            </div>
            <span className={`tf-count ${issueCategories ? "tf-count-issue" : ""}`}>
              {issueCategories ? `${issueCategories} ${issueCategories === 1 ? "area" : "areas"} to review` : "Check readiness"}
            </span>
          </div>
          <ActionRow
            icon={<CreditCard size={19}/>}
            issue={missingPayout > 0}
            title={missingPayout ? `${missingPayout} ${missingPayout === 1 ? "employee" : "employees"} missing payout details` : "Payout fields recorded"}
            detail={missingPayout ? "Active employees with missing fields; verify the selected run." : "Field presence does not verify bank ownership or run readiness."}
            action="View employees"
            onClick={() => onTask({ page: "People", filter: "missing-payout" })}
          />
          <ActionRow
            icon={<AlertTriangle size={19}/>}
            issue={exceptions > 0}
            title={exceptions ? `${exceptions} payroll ${exceptions === 1 ? "exception" : "exceptions"}` : "No payroll exceptions reported"}
            detail={exceptions ? "Inspect flagged entries for the selected run." : "Review the register before handing off payroll."}
            action="Review exceptions"
            onClick={() => payrollTask(exceptions ? "exceptions" : "register")}
          />
          <ActionRow
            icon={<Clock3 size={19}/>}
            issue={incompleteAttendance > 0}
            title={incompleteAttendance ? `${incompleteAttendance} ${incompleteAttendance === 1 ? "employee" : "employees"} with incomplete time entries` : attendanceEvidenceAvailable ? "No incomplete punches in loaded records" : "Attendance coverage not verified"}
            detail={incompleteAttendance ? "Review incomplete punches in the selected period." : attendanceEvidenceAvailable ? "This does not confirm all scheduled work has been recorded." : "Check the attendance register before payroll handoff."}
            action="Review attendance"
            onClick={() => onTask({ page: "Time & attendance", filter: "attendance-exceptions" })}
          />
          <p className="tf-attention-foot">Counts cover visible records, not a payroll release checklist. Categories may overlap and payout fields are not bank verification.</p>
        </section>

        <section className="tf-card tf-actions" aria-labelledby="tf-actions-title">
          <div className="tf-card-heading">
            <div>
              <h2 id="tf-actions-title">Your next moves</h2>
              <p>Go directly to the task you need.</p>
            </div>
          </div>
          <ActionRow
            icon={<ClipboardCheck size={19}/>}
            title="Review payroll inputs"
            detail="Open the preparation workflow for this payroll."
            action="Open"
            onClick={() => payrollTask("workflow")}
          />
          <ActionRow
            icon={<FileText size={19}/>}
            title="Open payroll register"
            detail="Inspect stored calculations by employee."
            action="Open"
            onClick={() => payrollTask("register")}
          />
          <ActionRow
            icon={<Plus size={19}/>}
            title="Start another payroll"
            detail="Create a separate payroll period."
            action="Start"
            onClick={onNewRun}
          />
        </section>
      </div>

      <p className="tf-footer-note"><CheckCircle2 size={15} aria-hidden /> Amounts are from the selected run. Payroll release and bank settlement are separate steps with existing server-side controls.</p>
    </div>
  );
}

function Metric({ icon, label, value, note, emphasis = false }: {
  icon: ReactNode;
  label: string;
  value: string;
  note: string;
  emphasis?: boolean;
}) {
  return (
    <article className={`tf-metric ${emphasis ? "tf-metric-emphasis" : ""}`}>
      <span className="tf-metric-title">{icon}<span>{label}</span></span>
      <strong className={value === "Not calculated" || value === "Verify register" ? "tf-metric-pending" : ""}>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function ActionRow({ icon, title, detail, issue = false, action, onClick }: {
  icon: ReactNode;
  title: string;
  detail: string;
  issue?: boolean;
  action: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="tf-action-row" onClick={onClick}>
      <span className={`tf-action-icon ${issue ? "tf-icon-issue" : ""}`} aria-hidden>{icon}</span>
      <span className="tf-action-copy"><strong>{title}</strong><small>{detail}</small></span>
      <span className="tf-action-go">{action}<ArrowRight size={15} aria-hidden /></span>
    </button>
  );
}
