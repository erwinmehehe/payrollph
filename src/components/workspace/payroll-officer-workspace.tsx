"use client";

import {
  AlertTriangle,
  ArrowRight,
  Check,
  Clock3,
  FileSearch,
  RefreshCw,
  Send,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { buildPayrollOfficerWorkflow, type PayrollOfficerChecklistItem, type PayrollOfficerWorkflowState } from "@/lib/payroll-officer-workflow";
import { readTrace, type DashboardData, type PayrollEntry, type PayrollRun, type Task } from "./types";
import { Spinner, Status } from "./ui";

type ChecklistItem = PayrollOfficerChecklistItem & {
  label: string;
};

type AssuranceFinding = {
  code: string;
  severity: "high" | "medium" | "info";
  blocking: boolean;
  title: string;
  detail: string;
  employeeId: number | null;
};

export function PayrollOfficerWorkspace({
  data,
  run,
  entries,
  checklist,
  assuranceFindings,
  relatedTask,
  calculated,
  busy,
  onCalculate,
  onSubmit,
  onOpenApproval,
  onPage,
  onInspectEntry,
  onExplainEmployee,
  onOpenEmployee,
  onOpenTimeIssue,
  onShowAllExceptions,
}: {
  data: DashboardData;
  run: PayrollRun;
  entries: PayrollEntry[];
  checklist: ChecklistItem[] | null;
  assuranceFindings: AssuranceFinding[];
  relatedTask?: Task;
  calculated: boolean;
  busy: boolean;
  onCalculate: () => void;
  onSubmit: () => void;
  onOpenApproval: () => void;
  onPage: (page: string) => void;
  onInspectEntry: (entry: PayrollEntry) => void;
  onExplainEmployee: (employeeId: number) => void;
  onOpenEmployee: (employeeId: number) => void;
  onOpenTimeIssue: (employeeId: number) => void;
  onShowAllExceptions: () => void;
}) {
  const exceptions = entries.filter((entry) => entry.status === "Exception");
  const workflow = buildPayrollOfficerWorkflow({
    runStatus: run.status,
    calculated,
    processedChunks: run.processedChunks,
    totalChunks: run.totalChunks,
    exceptionCount: exceptions.length,
    approvalStatus: relatedTask?.status,
    checklist,
  });

  const byKey = new Map((checklist ?? []).map((item) => [item.key, item]));
  const inputCheck = byKey.get("inputs");
  const attendanceCheck = byKey.get("attendance");
  const calculationCheck = byKey.get("calculation");
  const statutoryCheck = byKey.get("statutory");
  const exceptionCheck = byKey.get("exceptions");

  const attentionItems: Array<{
    key: string;
    title: string;
    detail: string;
    action: string;
    run: () => void;
  }> = [];

  const actionableFindings = assuranceFindings
    .filter((finding) =>
      finding.employeeId != null
      && finding.severity !== "info"
      && finding.code !== "ENGINE_EXCEPTION"
    )
    .slice(0, 8);

  const hasAttendanceFinding = actionableFindings.some((finding) => finding.code === "MISSING_ATTENDANCE");
  const hasStatutoryFinding = actionableFindings.some((finding) => finding.code === "MISSING_STATUTORY");

  if (inputCheck && !inputCheck.passed) {
    attentionItems.push({
      key: "inputs",
      title: inputCheck.label,
      detail: inputCheck.detail,
      action: "Open people",
      run: () => onPage("People"),
    });
  }
  if (attendanceCheck && !attendanceCheck.passed && !hasAttendanceFinding) {
    attentionItems.push({
      key: "attendance",
      title: attendanceCheck.label,
      detail: attendanceCheck.detail,
      action: "Open attendance",
      run: () => onPage("Time & attendance"),
    });
  }
  if (statutoryCheck && !statutoryCheck.passed && !hasStatutoryFinding) {
    attentionItems.push({
      key: "statutory",
      title: statutoryCheck.label,
      detail: statutoryCheck.detail,
      action: "Open register",
      run: onShowAllExceptions,
    });
  }
  if (exceptionCheck && !exceptionCheck.passed && exceptions.length === 0) {
    attentionItems.push({
      key: "assurance",
      title: exceptionCheck.label,
      detail: exceptionCheck.detail,
      action: "Open register",
      run: onShowAllExceptions,
    });
  }

  const findingAttentionItems = actionableFindings.map((finding) => {
    const employee = data.employees.find((person) => person.id === finding.employeeId);
    const employeeId = finding.employeeId!;
    const attendanceIssue = finding.code === "MISSING_ATTENDANCE";
    const employeeRecordIssue = finding.code === "MISSING_STATUTORY";
    return {
      key: `finding-${finding.code}-${finding.employeeId}`,
      title: employee
        ? `${finding.title} · ${employee.firstName} ${employee.lastName}`
        : finding.title,
      detail: finding.detail,
      action: attendanceIssue ? "Fix time" : employeeRecordIssue ? "Open employee" : "Explain pay",
      icon: attendanceIssue ? "time" : employeeRecordIssue ? "employee" : "explain",
      run: attendanceIssue
        ? () => onOpenTimeIssue(employeeId)
        : employeeRecordIssue
          ? () => onOpenEmployee(employeeId)
          : () => onExplainEmployee(employeeId),
    };
  });

  const calculationInProgress = ["Queued", "Processing", "Recalculating"].includes(run.status);
  const canCalculate =
    !calculationInProgress
    && !["Pending approval", "Ready for release", "Released", "Releasing"].includes(run.status);
  const submitCopy = relatedTask?.status === "Pending"
    ? `Waiting for ${relatedTask.approver}`
    : relatedTask?.status === "Approved"
      ? `Approved by ${relatedTask.approver}`
      : workflow.canSubmit
        ? "Calculation is ready for an independent checker."
        : "Finish calculation and resolve blocking assurance findings first.";

  return (
    <section className="payroll-officer-workflow" aria-label="Payroll Officer run workflow">
      <div className="payroll-officer-heading">
        <div>
          <div className="card-kicker">RUN PAYROLL</div>
          <h2>{run.periodLabel}</h2>
          <p>Work through each step in order. PayrollPH keeps the compliance and approval checks in the background.</p>
        </div>
        <div className="payroll-officer-heading-status">
          <Status value={run.status} />
          <span>{run.employeeCount} employees · {run.scopeLabel}</span>
        </div>
      </div>

      <div className="payroll-officer-steps">
        <WorkflowStep
          no={1}
          title="Review inputs"
          state={workflow.steps.inputs.state}
          detail={
            checklist == null
              ? "Checking employee inputs and attendance against the server-side payroll checklist."
              : workflow.inputIssues.length
                ? `${workflow.inputIssues.length} input area${workflow.inputIssues.length === 1 ? "" : "s"} need attention before handoff.`
                : "Required employee inputs and attendance checks are clear."
          }
          action={
            checklist == null ? (
              <span className="payroll-officer-step-done"><Clock3 size={13} /> Checking</span>
            ) : workflow.inputIssues.length ? (
              <button className="secondary-button" onClick={() => onPage(inputCheck && !inputCheck.passed ? "People" : "Time & attendance")}>
                <UsersRound size={14} /> Resolve inputs
              </button>
            ) : <span className="payroll-officer-step-done"><Check size={13} /> Ready</span>
          }
        />

        <WorkflowStep
          no={2}
          title="Calculate"
          state={workflow.steps.calculate.state}
          detail={
            calculationCheck?.detail ??
            (calculated ? "Stored payroll entries are calculated." : "Calculate the cutoff to create the payroll register.")
          }
          action={
            <button className="secondary-button" disabled={busy || !canCalculate} onClick={onCalculate}>
              {busy || calculationInProgress ? <Spinner label="Calculating" /> : <RefreshCw size={14} />}
              {calculationInProgress ? "Processing" : calculated ? "Recalculate" : "Calculate"}
            </button>
          }
        />

        <WorkflowStep
          no={3}
          title="Review changes"
          state={workflow.steps.exceptions.state}
          detail={
            !workflow.calculationReady
              ? "Calculation must finish before payroll changes can be reviewed."
              : exceptions.length
                ? `${exceptions.length} employee entr${exceptions.length === 1 ? "y" : "ies"} need explanation or correction.`
                : statutoryCheck && !statutoryCheck.passed
                  ? statutoryCheck.detail
                  : "No blocking payroll changes remain in the current register."
          }
          action={
            exceptions.length ? (
              <button className="secondary-button" onClick={onShowAllExceptions}>
                <AlertTriangle size={14} /> Review {exceptions.length}
              </button>
            ) : <span className="payroll-officer-step-done"><Check size={13} /> Clear</span>
          }
        />

        <WorkflowStep
          no={4}
          title="Submit"
          state={workflow.steps.submit.state}
          detail={submitCopy}
          action={
            relatedTask?.status === "Pending" ? (
              <button className="secondary-button" onClick={onOpenApproval}>
                <Clock3 size={14} /> Open approval
              </button>
            ) : relatedTask?.status === "Approved" ? (
              <span className="payroll-officer-step-done"><ShieldCheck size={13} /> Approved</span>
            ) : (
              <button className="primary-button brand" disabled={!workflow.canSubmit} onClick={onSubmit}>
                <Send size={14} /> Send for review
              </button>
            )
          }
        />
      </div>

      {(attentionItems.length > 0 || findingAttentionItems.length > 0 || exceptions.length > 0) && (
        <div className="payroll-officer-attention">
          <div className="payroll-officer-attention-heading">
            <div>
              <span className="card-kicker">NEEDS ATTENTION</span>
              <strong>Fix the affected input or inspect the employee calculation.</strong>
            </div>
            <span>
              {attentionItems.length + findingAttentionItems.length + exceptions.length} item{attentionItems.length + findingAttentionItems.length + exceptions.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="payroll-officer-attention-list">
            {attentionItems.map((item) => (
              <div className="payroll-officer-attention-row" key={item.key}>
                <span className="payroll-officer-attention-icon"><AlertTriangle size={14} /></span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </div>
                <button className="secondary-button" onClick={item.run}>{item.action} <ArrowRight size={13} /></button>
              </div>
            ))}

            {findingAttentionItems.map((item) => (
              <div className="payroll-officer-attention-row" key={item.key}>
                <span className="payroll-officer-attention-icon danger"><AlertTriangle size={14} /></span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </div>
                <button className="secondary-button" onClick={item.run}>
                  {item.icon === "time" ? <Clock3 size={13} /> : item.icon === "employee" ? <UsersRound size={13} /> : <FileSearch size={13} />} {item.action}
                </button>
              </div>
            ))}

            {exceptions.slice(0, 6).map((entry) => {
              const employee = data.employees.find((person) => person.id === entry.employeeId);
              const flags = readTrace(entry).flags;
              return (
                <div className="payroll-officer-attention-row" key={entry.id}>
                  <span className="payroll-officer-attention-icon danger"><AlertTriangle size={14} /></span>
                  <div>
                    <strong>{employee ? `${employee.firstName} ${employee.lastName}` : `Employee #${entry.employeeId}`}</strong>
                    <p>{flags.length ? flags.join(" · ") : "Payroll engine exception. Inspect the stored calculation trace."}</p>
                    <small>Explain pay shows stored SSS, PhilHealth, Pag-IBIG and withholding-tax bases when present.</small>
                  </div>
                  <div className="payroll-officer-attention-actions">
                    <button className="secondary-button" onClick={() => onInspectEntry(entry)}>Open row</button>
                    <button className="secondary-button" onClick={() => onExplainEmployee(entry.employeeId)}>
                      <FileSearch size={13} /> Explain pay
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {exceptions.length > 6 && (
            <button className="link-button" onClick={onShowAllExceptions}>
              Show all {exceptions.length} exceptions in the payroll register
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function WorkflowStep({
  no,
  title,
  state,
  detail,
  action,
}: {
  no: number;
  title: string;
  state: PayrollOfficerWorkflowState;
  detail: string;
  action: React.ReactNode;
}) {
  return (
    <article className="payroll-officer-step" data-state={state}>
      <div className="payroll-officer-step-top">
        <span className="payroll-officer-step-number">{state === "done" ? <Check size={14} /> : no}</span>
        <span className="payroll-officer-step-state">
          {state === "done" ? "Complete" : state === "attention" ? "Needs attention" : state === "locked" ? "Locked" : "Current"}
        </span>
      </div>
      <div>
        <h3>{title}</h3>
        <p>{detail}</p>
      </div>
      <div className="payroll-officer-step-action">{action}</div>
    </article>
  );
}
