"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Clock3,
  FileWarning,
  Fingerprint,
  ListChecks,
  UsersRound,
} from "lucide-react";
import {
  buildHrPayrollReadiness,
  type HrReadinessAction,
  type HrReadinessIssueKey,
} from "@/lib/hr-payroll-readiness";
import type { DashboardData, Employee } from "./types";
import { Avatar, Status } from "./ui";

const issueLabel: Record<HrReadinessIssueKey, string> = {
  bank_details: "Payout details",
  government_ids: "Government IDs",
  employment_dates: "Employment dates",
  pay_basis: "Pay basis",
  attendance: "Attendance",
  leave_overlap: "Leave overlap",
  rest_day: "Rest day",
  onboarding: "Onboarding",
};

const issueOrder: HrReadinessIssueKey[] = [
  "bank_details",
  "government_ids",
  "pay_basis",
  "attendance",
  "leave_overlap",
  "rest_day",
  "employment_dates",
  "onboarding",
];

function issueIcon(key: HrReadinessIssueKey) {
  if (key === "bank_details") return <Banknote size={14} />;
  if (key === "government_ids") return <Fingerprint size={14} />;
  if (key === "attendance") return <Clock3 size={14} />;
  if (key === "leave_overlap" || key === "employment_dates") return <CalendarClock size={14} />;
  if (key === "onboarding") return <ListChecks size={14} />;
  if (key === "pay_basis") return <FileWarning size={14} />;
  return <CircleUserRound size={14} />;
}

export function HrPayrollReadinessCenter({
  data,
  onOpenEmployee,
  onPage,
}: {
  data: DashboardData;
  onOpenEmployee: (employee: Employee) => void;
  onPage: (page: string) => void;
}) {
  const [filter, setFilter] = useState<"attention" | "ready" | HrReadinessIssueKey>("attention");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const period = data.payrollHandoffRun?.periodStart && data.payrollHandoffRun?.periodEnd
    ? {
        periodStart: data.payrollHandoffRun.periodStart,
        periodEnd: data.payrollHandoffRun.periodEnd,
        periodLabel: data.payrollHandoffRun.periodLabel,
      }
    : null;

  const model = useMemo(
    () => buildHrPayrollReadiness({
      employees: data.employees,
      punches: data.punches,
      leaveRequests: data.leaveRequests,
      provisioning: data.provisioning,
      separations: data.separations,
      period,
    }),
    [data.employees, data.punches, data.leaveRequests, data.provisioning, data.separations, period?.periodStart, period?.periodEnd, period?.periodLabel],
  );

  const visible = useMemo(() => {
    const rows = model.rows.filter((row) => {
      if (filter === "ready") return row.ready;
      if (filter === "attention") return !row.ready;
      return row.issues.some((issue) => issue.key === filter);
    });
    return [...rows].sort((a, b) => {
      if (a.ready !== b.ready) return a.ready ? 1 : -1;
      if (a.issues.length !== b.issues.length) return b.issues.length - a.issues.length;
      return a.employeeName.localeCompare(b.employeeName);
    });
  }, [model.rows, filter]);

  const percentage = model.total ? Math.round((model.ready / model.total) * 100) : 100;

  function toggle(employeeId: number) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  }

  function runAction(action: HrReadinessAction, employeeId: number) {
    if (action === "attendance") {
      onPage("Time & attendance");
      return;
    }
    if (action === "leave") {
      onPage("Leave");
      return;
    }
    if (action === "separation") {
      onPage("Separation");
      return;
    }
    const employee = data.employees.find((row) => row.id === employeeId);
    if (employee) onOpenEmployee(employee);
  }

  return (
    <section className="hr-readiness-center" aria-label="HR payroll readiness">
      <div className="hr-readiness-heading">
        <div>
          <div className="card-kicker">PAYROLL READINESS</div>
          <h2>{model.ready} of {model.total} employees ready</h2>
          <p>
            {period
              ? `Inputs for ${period.periodLabel}. An employee becomes Ready only when the visible payroll blockers below are clear.`
              : "No active payroll period is visible to HR. Readiness is based on current employee records and open people issues."}
          </p>
        </div>
        <div className="hr-readiness-score">
          <strong>{percentage}%</strong>
          <span>{model.blocked ? `${model.blocked} need attention` : "All ready"}</span>
        </div>
      </div>

      <div className="hr-readiness-progress" aria-label={`${percentage}% payroll ready`}>
        <span style={{ width: `${percentage}%` }} />
      </div>

      <div className="hr-readiness-summary">
        <button className={filter === "attention" ? "active" : ""} onClick={() => setFilter("attention")}>
          <AlertTriangle size={14} /> Needs attention <strong>{model.blocked}</strong>
        </button>
        <button className={filter === "ready" ? "active" : ""} onClick={() => setFilter("ready")}>
          <BadgeCheck size={14} /> Ready <strong>{model.ready}</strong>
        </button>
        {issueOrder.map((key) => {
          const count = model.issueCounts[key];
          if (!count) return null;
          return (
            <button key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>
              {issueIcon(key)} {issueLabel[key]} <strong>{count}</strong>
            </button>
          );
        })}
      </div>

      <div className="hr-readiness-list">
        {visible.length === 0 ? (
          <div className="hr-readiness-empty">
            <BadgeCheck size={18} />
            <div>
              <strong>{filter === "attention" ? "No payroll blockers in this queue." : "No employees match this filter."}</strong>
              <span>{filter === "attention" ? "The current readiness checks are clear." : "Choose another readiness filter."}</span>
            </div>
          </div>
        ) : visible.map((row) => {
          const employee = data.employees.find((item) => item.id === row.employeeId);
          const open = expanded.has(row.employeeId);
          return (
            <article className="hr-readiness-row" key={row.employeeId} data-ready={row.ready ? "true" : "false"}>
              <button className="hr-readiness-row-main" onClick={() => toggle(row.employeeId)} aria-expanded={open}>
                <span className="hr-readiness-chevron">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
                <span className="hr-readiness-person">
                  {employee && <Avatar initials={employee.avatarInitials} index={employee.id} />}
                  <span>
                    <strong>{row.employeeName}</strong>
                    <small>{row.employeeNo} · {row.employeeStatus}</small>
                  </span>
                </span>
                <span className="hr-readiness-issues">
                  {row.ready ? (
                    <span className="hr-readiness-ready-chip"><BadgeCheck size={11} /> Ready</span>
                  ) : row.issues.slice(0, 4).map((issue) => (
                    <span key={issue.key} data-issue={issue.key}>{issueLabel[issue.key]}</span>
                  ))}
                  {row.issues.length > 4 && <span>+{row.issues.length - 4}</span>}
                </span>
                <span className="hr-readiness-status">
                  <Status value={row.ready ? "Ready" : "Needs attention"} />
                </span>
              </button>

              {open && (
                <div className="hr-readiness-row-details">
                  {row.ready ? (
                    <div className="hr-readiness-ready-detail">
                      <BadgeCheck size={15} />
                      <span>Bank, government IDs, pay setup, work schedule, attendance, leave overlap and onboarding checks are clear.</span>
                    </div>
                  ) : (
                    row.issues.map((issue) => (
                      <div className="hr-readiness-issue-row" key={issue.key}>
                        <span className="hr-readiness-issue-icon">{issueIcon(issue.key)}</span>
                        <div>
                          <strong>{issue.label}</strong>
                          <p>{issue.detail}</p>
                        </div>
                        <button className="secondary-button" onClick={() => runAction(issue.action, row.employeeId)}>
                          {issue.action === "attendance"
                            ? "Open attendance"
                            : issue.action === "leave"
                              ? "Review leave"
                              : issue.action === "separation"
                                ? "Open separation"
                                : "Fix employee"}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="hr-readiness-footer">
        <UsersRound size={14} />
        <span>
          <strong>{model.issueTotal} open readiness issue{model.issueTotal === 1 ? "" : "s"}.</strong>{" "}
          Fixing employee records refreshes this queue from the server; readiness is not manually overridden.
        </span>
      </div>
    </section>
  );
}
