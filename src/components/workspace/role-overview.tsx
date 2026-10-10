"use client";

import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  Check,
  ClipboardCheck,
  Clock3,
  FileWarning,
  History,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { PayrollHandoff } from "@/components/payroll-handoff";
import type { TaskTarget } from "@/lib/task-first-ui";
import { DashboardAlertBanner, type DashboardAlertItem } from "./dashboard-alert-banner";
import { DashboardStatCard } from "./dashboard-stat-card";
import { RecentPayrollRuns } from "./recent-payroll-runs";
import { RoleOverviewV2 } from "./role-overview-v2";
import { CleanRoleDashboard } from "./clean-role-dashboard";
import { buildPayrollHandoff, payrollHandoffRank, type PayrollHandoffStage } from "@/lib/payroll-handoff";
import type { DashboardData, PayrollHandoffRunSummary, PayrollRun, Task } from "./types";
import {
  Avatar,
  EmptyState,
  Metric,
  PageHeading,
  Status,
  relativeTime,
  shortMoney,
} from "./ui";

export type WorkspaceDashboardRole = "owner" | "hr" | "payroll" | "checker" | "bookkeeper";

export function RoleOverviewView({
  data,
  currentRun,
  role,
  onPage,
  onNewRun,
  onTask,
}: {
  data: DashboardData;
  currentRun?: PayrollRun;
  role: WorkspaceDashboardRole;
  onPage: (page: string) => void;
  onNewRun: () => void;
  onTask?: (target: TaskTarget) => void;
}) {
  if (role === "owner" || role === "payroll" || role === "checker") {
    return <CleanRoleDashboard data={data} currentRun={currentRun} role={role} onPage={onPage} onNewRun={onNewRun} onTask={onTask} />;
  }
  return (
    <RoleOverviewV2
      data={data}
      currentRun={currentRun}
      role={role}
      onPage={onPage}
      onNewRun={onNewRun}
    />
  );
}

type RoleDashboardProps = {
  data: DashboardData;
  currentRun?: PayrollRun;
  handoffRun?: PayrollHandoffRunSummary | PayrollRun;
  firstName: string;
  activePeople: DashboardData["employees"];
  pendingTasks: Task[];
  highPriorityTasks: Task[];
  pendingLeave: NonNullable<DashboardData["leaveRequests"]>;
  openProvisioning: NonNullable<DashboardData["provisioning"]>;
  payrollExceptions: DashboardData["payrollEntries"];
  pendingRetro: NonNullable<DashboardData["retroAdjustments"]>;
  attendanceIssues: NonNullable<DashboardData["punches"]>;
  peopleMissingGovernmentIds: DashboardData["employees"];
  activeAdvisories: DashboardData["advisories"];
  handoffStages: PayrollHandoffStage[];
  handoffAction: HandoffAction;
  onPage: (page: string) => void;
  onNewRun: () => void;
};

function PayrollFocusCard({
  title,
  status,
  payDate,
  employees,
  gross,
  net,
  actionLabel,
  onAction,
  comparison,
}: {
  title: string;
  status: string;
  payDate?: string;
  employees?: number;
  gross?: string | number;
  net?: string | number;
  actionLabel: string;
  onAction: () => void;
  comparison?: string;
}) {
  return (
    <section className="payroll-focus-card">
      <div className="payroll-focus-main">
        <span className="dashboard-section-kicker">Current payroll</span>
        <div className="payroll-focus-title-row">
          <h2>{title}</h2>
          <Status value={status} />
        </div>
        <div className="payroll-focus-meta">
          {payDate && <span><CalendarClock size={13} /> Pay date {payDate}</span>}
          {employees !== undefined && <span><UsersRound size={13} /> {employees} employees</span>}
          {comparison && <span><History size={13} /> {comparison}</span>}
        </div>
      </div>
      <div className="payroll-focus-summary">
        {gross !== undefined && <div><span>Gross</span><strong>{shortMoney(gross)}</strong></div>}
        {gross !== undefined && net !== undefined && <div><span>Deductions</span><strong>{shortMoney(Math.max(0, Number(gross) - Number(net)))}</strong></div>}
        {net !== undefined && <div><span>Net pay</span><strong>{shortMoney(net)}</strong></div>}
        {employees !== undefined && <div><span>Employees</span><strong>{employees}</strong></div>}
      </div>
      <button className="payroll-focus-action" type="button" onClick={onAction}>
        {actionLabel} <ArrowRight size={14} />
      </button>
    </section>
  );
}

function HrReadinessCard({
  ready,
  total,
  issues,
  onAction,
}: {
  ready: number;
  total: number;
  issues: number;
  onAction: () => void;
}) {
  const percentage = total > 0 ? Math.round((ready / total) * 100) : 0;
  return (
    <section className="payroll-focus-card payroll-readiness-focus">
      <div className="payroll-focus-main">
        <span className="dashboard-section-kicker">Payroll input readiness</span>
        <div className="payroll-focus-title-row">
          <h2>{ready} of {total} employees ready</h2>
          <Status value={issues ? "Needs attention" : "Ready"} />
        </div>
        <p>{issues ? `${issues} people or attendance item${issues === 1 ? "" : "s"} should be cleared before payroll handoff.` : "Core employee and attendance inputs are ready for payroll."}</p>
        <div className="readiness-progress" aria-label={`${percentage}% ready`}>
          <span style={{ width: `${percentage}%` }} />
        </div>
      </div>
      <button className="payroll-focus-action" type="button" onClick={onAction}>
        {issues ? "Resolve issues" : "Open people"} <ArrowRight size={14} />
      </button>
    </section>
  );
}


function OwnerDashboard(props: RoleDashboardProps) {
  const {
    data,
    currentRun,
    handoffRun,
    firstName,
    activePeople,
    pendingTasks,
    payrollExceptions,
    peopleMissingGovernmentIds,
    activeAdvisories,
    handoffStages,
    handoffAction,
    onPage,
    onNewRun,
  } = props;

  const missingBankDetails = activePeople.filter((employee) => !employee.bankAccount || !employee.bankCode).length;
  const ownerAlertItems: DashboardAlertItem[] = [];
  if (missingBankDetails) ownerAlertItems.push({ id: "bank", label: `${missingBankDetails} employee${missingBankDetails === 1 ? "" : "s"} missing bank details`, tone: "danger" });
  if (payrollExceptions.length) ownerAlertItems.push({ id: "exceptions", label: `${payrollExceptions.length} payroll exception${payrollExceptions.length === 1 ? "" : "s"} need review`, tone: "warning" });
  if (pendingTasks.length) ownerAlertItems.push({ id: "approval", label: `${pendingTasks.length} approval item${pendingTasks.length === 1 ? "" : "s"} waiting`, tone: "info" });
  if (!ownerAlertItems.length) ownerAlertItems.push({ id: "clear", label: "No release blocker is visible in this workspace", tone: "success" });
  const ownerIssueCount = ownerAlertItems.filter((item) => item.tone !== "success").length;

  return (
    <div className="payrollph-dashboard" data-dashboard-variant="owner">
      <PageHeading
        eyebrow={data.selectedOrganization.legalName + " · Owner"}
        title={"Good morning, " + firstName + "!"}
        copy="Here’s what needs attention before payroll can be released."
      />

      <PayrollFocusCard
        title={currentRun?.periodLabel ?? "Next payroll"}
        status={currentRun?.status ?? "Not started"}
        payDate={currentRun?.payDate}
        employees={currentRun?.employeeCount ?? activePeople.length}
        gross={currentRun?.grossPay}
        net={currentRun?.netPay}
        actionLabel={!currentRun ? "Create payroll" : currentRun.status === "Approved" ? "Release payroll" : "Continue payroll"}
        onAction={currentRun ? () => onPage("Payroll") : onNewRun}
      />

      <DashboardAlertBanner
        title={ownerIssueCount ? `${ownerIssueCount} thing${ownerIssueCount === 1 ? "" : "s"} need attention` : "Payroll looks ready"}
        detail={ownerIssueCount ? "Resolve these before sending or releasing payroll." : "The visible payroll checks are clear. Review the run before release."}
        items={ownerAlertItems}
        actionLabel={ownerIssueCount ? "Review issues" : "Open payroll"}
        onAction={() => onPage(missingBankDetails ? "People" : payrollExceptions.length ? "Payroll" : pendingTasks.length ? "Approvals" : "Payroll")}
      />

      <RecentPayrollRuns runs={data.payrollRuns} onViewAll={() => onPage("Payroll")} />

      <details className="dashboard-deep-details"><summary>More payroll details</summary><div className="dashboard-secondary-controls">
        <PayrollHandoff
          stages={handoffStages}
          period={handoffRun?.periodLabel ?? "Next payroll"}
          status={handoffRun?.status ?? "Waiting for inputs"}
          payDate={handoffRun?.payDate}
          viewerRole="owner"
        />
        <HandoffActionBanner action={handoffAction} onPage={onPage} role="owner" />
      </div>

      <section className="role-dashboard-grid">
        <RoleCard kicker="Release readiness" title="What has to be true before money moves" action="Open payroll" onAction={() => onPage("Payroll")}>
          <GateRow
            label="Payroll calculated"
            detail={currentRun ? String(data.payrollEntries.length) + " entries available" : "No live run"}
            ok={Boolean(currentRun && data.payrollEntries.length)}
          />
          <GateRow
            label="Exceptions understood"
            detail={payrollExceptions.length ? String(payrollExceptions.length) + " flagged entries" : "No flagged entries"}
            ok={payrollExceptions.length === 0}
          />
          <GateRow
            label="Independent decisions"
            detail={pendingTasks.length ? String(pendingTasks.length) + " approval item(s) still open" : "Approval queue clear"}
            ok={pendingTasks.length === 0}
          />
          <GateRow
            label="Release authority"
            detail="Owner/admin only. Payroll makers cannot release their own run."
            ok
          />
        </RoleCard>

        <TaskQueue
          title="Decision queue"
          tasks={pendingTasks}
          empty="There are no pending approval decisions."
          onOpen={() => onPage("Approvals")}
        />

        <RoleCard kicker="Workforce health" title="People records that can affect filings" action="Open people" onAction={() => onPage("People")}>
          {peopleMissingGovernmentIds.length ? (
            <div className="role-focus-list">
              {peopleMissingGovernmentIds.slice(0, 4).map((employee) => (
                <div className="role-focus-row" key={employee.id}>
                  <Avatar initials={employee.avatarInitials} index={employee.id} />
                  <div>
                    <strong>{employee.firstName} {employee.lastName}</strong>
                    <span>{missingIdLabel(employee)}</span>
                  </div>
                  <Status value="Needs review" />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={<BadgeCheck size={19} />} title="Government IDs are complete">
              Active people have the identifiers used by the filing exports.
            </EmptyState>
          )}
        </RoleCard>

        <RoleCard kicker="Recorded control" title="Latest audit activity" action="Open audit trail" onAction={() => onPage("Audit trail")}>
          <AuditRows data={data} />
        </RoleCard>
      </section></details>
    </div>
  );
}

function HrDashboard(props: RoleDashboardProps) {
  const {
    data,
    currentRun,
    handoffRun,
    firstName,
    activePeople,
    pendingLeave,
    openProvisioning,
    attendanceIssues,
    peopleMissingGovernmentIds,
    handoffStages,
    handoffAction,
    onPage,
  } = props;

  const missingBankDetails = activePeople.filter((employee) => !employee.bankAccount || !employee.bankCode).length;
  const hrAlertItems: DashboardAlertItem[] = [];
  if (missingBankDetails) hrAlertItems.push({ id: "bank", label: `${missingBankDetails} employee${missingBankDetails === 1 ? "" : "s"} need payout details`, tone: "danger" });
  if (pendingLeave.length) hrAlertItems.push({ id: "leave", label: `${pendingLeave.length} leave request${pendingLeave.length === 1 ? "" : "s"} need review`, tone: "warning" });
  if (attendanceIssues.length) hrAlertItems.push({ id: "attendance", label: `${attendanceIssues.length} attendance issue${attendanceIssues.length === 1 ? "" : "s"} need context`, tone: "info" });
  if (!hrAlertItems.length) hrAlertItems.push({ id: "clear", label: "People records are ready for payroll handoff", tone: "success" });
  const withBankDetails = Math.max(activePeople.length - missingBankDetails, 0);
  const hrIssueCount = [missingBankDetails, pendingLeave.length, attendanceIssues.length].filter((count) => count > 0).length;
  const incompleteEmployeeIds = new Set([
    ...activePeople.filter((employee) => !employee.bankAccount || !employee.bankCode).map((employee) => employee.id),
    ...peopleMissingGovernmentIds.map((employee) => employee.id),
  ]);
  const readyEmployees = Math.max(0, activePeople.length - incompleteEmployeeIds.size);
  const readinessIssues = incompleteEmployeeIds.size + pendingLeave.length + attendanceIssues.length;

  return (
    <div className="payrollph-dashboard" data-dashboard-variant="hr">
      <PageHeading
        eyebrow={data.selectedOrganization.legalName + " · HR Admin"}
        title={"Good morning, " + firstName + "!"}
        copy="Here’s your HR setup progress before the next payroll cutoff."
      />

      <HrReadinessCard
        ready={readyEmployees}
        total={activePeople.length}
        issues={readinessIssues}
        onAction={() => onPage("People")}
      />

      <DashboardAlertBanner
        title={missingBankDetails ? `${missingBankDetails} employee${missingBankDetails === 1 ? "" : "s"} need payout details` : hrIssueCount ? `${hrIssueCount} people item${hrIssueCount === 1 ? "" : "s"} need attention` : "People inputs look ready"}
        detail={missingBankDetails ? "Complete bank accounts so payroll can be processed on time." : hrIssueCount ? "Clear the remaining people inputs before the next payroll handoff." : "No current HR data issue is blocking the payroll handoff."}
        items={hrAlertItems}
        actionLabel="View employees"
        onAction={() => onPage("People")}
      />

      <section className="dashboard-metrics-grid">
        <DashboardStatCard icon={<UsersRound size={18} />} label="Total Employees" value={String(activePeople.length)} hint="Active people" tone="blue" />
        <DashboardStatCard icon={<BadgeCheck size={18} />} label="With Bank Details" value={String(withBankDetails)} hint="Ready for payout" tone="green" />
        <DashboardStatCard icon={<FileWarning size={18} />} label="Missing Details" value={String(missingBankDetails)} hint="Bank details incomplete" tone={missingBankDetails ? "red" : "green"} />
        <DashboardStatCard icon={<ClipboardCheck size={18} />} label="For Onboarding" value={String(openProvisioning.length)} hint={openProvisioning.length ? "Open lifecycle tasks" : "Queue clear"} tone={openProvisioning.length ? "amber" : "green"} />
      </section>

      <details className="dashboard-deep-details"><summary>More payroll details</summary><div className="dashboard-secondary-controls">
        <PayrollHandoff
          stages={handoffStages}
          period={handoffRun?.periodLabel ?? "Next payroll"}
          status={handoffRun?.status ?? "Waiting for inputs"}
          payDate={handoffRun?.payDate}
          viewerRole="hr"
        />
        <HandoffActionBanner action={handoffAction} onPage={onPage} role="hr" />
      </div>

      <section className="role-dashboard-grid">
        <RoleCard kicker="People requiring attention" title="Fix records before they become payroll problems" action="Open people" onAction={() => onPage("People")}>
          {peopleMissingGovernmentIds.length ? (
            <div className="role-focus-list">
              {peopleMissingGovernmentIds.slice(0, 5).map((employee) => (
                <div className="role-focus-row" key={employee.id}>
                  <Avatar initials={employee.avatarInitials} index={employee.id} />
                  <div>
                    <strong>{employee.firstName} {employee.lastName}</strong>
                    <span>{missingIdLabel(employee)}</span>
                  </div>
                  <Status value="Incomplete" />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={<BadgeCheck size={19} />} title="People records look complete">
              No active employee is missing the core filing IDs.
            </EmptyState>
          )}
        </RoleCard>

        <RoleCard kicker="Leave & attendance" title="Items HR should clear before payroll" action="Open attendance" onAction={() => onPage("Time & attendance")}>
          <FocusNumber label="Pending leave requests" value={pendingLeave.length} detail="Open Leave to review balances and dates." />
          <FocusNumber label="Attendance issues" value={attendanceIssues.length} detail="Incomplete or non-standard punches need context." />
          <FocusNumber label="Open lifecycle tasks" value={openProvisioning.length} detail="Onboarding and provisioning work still in progress." />
        </RoleCard>

        <RoleCard kicker="Lifecycle queue" title="Onboarding and employee operations" action="Open recruitment" onAction={() => onPage("Recruitment")}>
          {openProvisioning.length ? (
            <div className="role-focus-list">
              {openProvisioning.slice(0, 5).map((task) => {
                const employee = data.employees.find((item) => item.id === task.employeeId);
                return (
                  <div className="role-focus-row" key={task.id}>
                    <span className="role-row-icon"><ClipboardCheck size={14} /></span>
                    <div>
                      <strong>{task.title}</strong>
                      <span>{employee ? employee.firstName + " " + employee.lastName : "Employee #" + String(task.employeeId)} · {task.owner}</span>
                    </div>
                    <Status value="Open" />
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState icon={<Check size={19} />} title="Lifecycle queue is clear">
              There are no open provisioning items in this workspace.
            </EmptyState>
          )}
        </RoleCard>

        <ShortcutCard
          title="HR workspace"
          items={[
            ["Leave", "Review leave requests"],
            ["Benefits", "Maintain employee benefits"],
            ["Loans", "Payroll-impacting loan records"],
            ["Compliance", "See filing and rule context"],
          ]}
          onPage={onPage}
        />
      </section></details>
    </div>
  );
}

function PayrollDashboard(props: RoleDashboardProps) {
  const {
    data,
    currentRun,
    handoffRun,
    firstName,
    pendingTasks,
    payrollExceptions,
    pendingRetro,
    attendanceIssues,
    handoffStages,
    handoffAction,
    onPage,
    onNewRun,
  } = props;

  const jobs = data.payrollJobs ?? [];
  const failedJobs = jobs.filter((job) => job.status === "Failed");
  const queueDone = currentRun?.totalChunks
    ? (currentRun.processedChunks ?? 0) >= currentRun.totalChunks
    : data.payrollEntries.length > 0;

  const payrollAlertItems: DashboardAlertItem[] = [];
  if (failedJobs.length) payrollAlertItems.push({ id: "failed", label: `${failedJobs.length} payroll job${failedJobs.length === 1 ? "" : "s"} failed`, tone: "danger" });
  if (payrollExceptions.length) payrollAlertItems.push({ id: "exceptions", label: `${payrollExceptions.length} exception${payrollExceptions.length === 1 ? "" : "s"} need review`, tone: "warning" });
  if (pendingTasks.length) payrollAlertItems.push({ id: "approval", label: `${pendingTasks.length} checker item${pendingTasks.length === 1 ? "" : "s"} waiting`, tone: "info" });
  if (!payrollAlertItems.length) payrollAlertItems.push({ id: "clear", label: "The payroll register is ready for the next handoff", tone: "success" });

  return (
    <div className="payrollph-dashboard" data-dashboard-variant="payroll">
      <PageHeading
        eyebrow={data.selectedOrganization.legalName + " · Payroll Officer"}
        title={"Good morning, " + firstName + "!"}
        copy="Your payroll is almost ready. Resolve the remaining items before checker review."
      />

      <PayrollFocusCard
        title={currentRun?.periodLabel ?? "Next payroll"}
        status={currentRun?.status ?? "Not started"}
        payDate={currentRun?.payDate}
        employees={currentRun?.employeeCount ?? data.employees.length}
        gross={currentRun?.grossPay}
        net={currentRun?.netPay}
        actionLabel={!currentRun ? "Create payroll" : payrollExceptions.length ? "Review exceptions" : "Continue payroll"}
        onAction={currentRun ? () => onPage("Payroll") : onNewRun}
      />

      <DashboardAlertBanner
        title={failedJobs.length ? "Payroll calculation needs recovery" : queueDone ? "Payroll calculation is complete" : "Payroll calculation is in progress"}
        detail={payrollExceptions.length ? `${payrollExceptions.length} exception${payrollExceptions.length === 1 ? "" : "s"} need review before you can submit for approval.` : "Review the calculated register before the maker-checker handoff."}
        items={payrollAlertItems}
        actionLabel={currentRun ? "Review exceptions" : "Create payroll"}
        onAction={currentRun ? () => onPage("Payroll") : onNewRun}
      />

      <RecentPayrollRuns runs={data.payrollRuns} onViewAll={() => onPage("Payroll")} />

      <details className="dashboard-deep-details"><summary>More payroll details</summary><div className="dashboard-secondary-controls">
        <PayrollHandoff
          stages={handoffStages}
          period={handoffRun?.periodLabel ?? "Next payroll"}
          status={handoffRun?.status ?? "Waiting for inputs"}
          payDate={handoffRun?.payDate}
          viewerRole="payroll"
        />
        <HandoffActionBanner action={handoffAction} onPage={onPage} role="payroll" />
      </div>

      <section className="role-dashboard-grid">
        <RoleCard kicker="Run readiness" title="Prepare the handoff to checker" action="Open payroll" onAction={() => onPage("Payroll")}>
          <GateRow label="Calculation queue" detail={failedJobs.length ? String(failedJobs.length) + " failed payroll job(s)" : queueDone ? "Calculation complete" : "Still processing"} ok={queueDone && failedJobs.length === 0} />
          <GateRow label="Entry exceptions" detail={payrollExceptions.length ? String(payrollExceptions.length) + " employee entries need review" : "No flagged entries"} ok={payrollExceptions.length === 0} />
          <GateRow label="Attendance input" detail={attendanceIssues.length ? String(attendanceIssues.length) + " punch issue(s) still visible" : "No current attendance issues"} ok={attendanceIssues.length === 0} />
          <GateRow label="Maker-checker separation" detail="Payroll can prepare and submit, but cannot approve its own run." ok />
        </RoleCard>

        <RoleCard kicker="Exception queue" title="Employees to inspect before submission" action="Open register" onAction={() => onPage("Payroll")}>
          {payrollExceptions.length ? (
            <div className="role-focus-list">
              {payrollExceptions.slice(0, 5).map((entry) => {
                const employee = data.employees.find((item) => item.id === entry.employeeId);
                return (
                  <div className="role-focus-row" key={entry.id}>
                    <span className="role-row-icon warning"><AlertTriangle size={14} /></span>
                    <div>
                      <strong>{employee ? employee.firstName + " " + employee.lastName : "Employee #" + String(entry.employeeId)}</strong>
                      <span>{shortMoney(entry.grossPay)} gross · {shortMoney(entry.netPay)} net</span>
                    </div>
                    <Status value="Exception" />
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState icon={<Check size={19} />} title="No register exceptions">
              The current payroll entries are not flagged for review.
            </EmptyState>
          )}
        </RoleCard>

        <RoleCard kicker="Cutoff inputs" title="Inputs that change payroll" action="Open people" onAction={() => onPage("People")}>
          <FocusNumber label="Attendance issues" value={attendanceIssues.length} detail="Review before recalculating payroll." />
          <FocusNumber label="Pending retro adjustments" value={pendingRetro.length} detail="Settled only when a payroll containing them is released." />
          <FocusNumber label="Open checker items" value={pendingTasks.length} detail="Submitted items waiting on independent review." />
        </RoleCard>

        <ShortcutCard
          title="Payroll inputs"
          items={[
            ["Loans", "Employee loan deductions"],
            ["Benefits", "Taxable and non-taxable benefits"],
            ["De minimis", "De minimis benefit configuration"],
            ["Expenses", "Approved payroll-impacting expenses"],
          ]}
          onPage={onPage}
        />
      </section></details>
    </div>
  );
}

function CheckerDashboard(props: RoleDashboardProps) {
  const {
    data,
    currentRun,
    handoffRun,
    firstName,
    pendingTasks,
    highPriorityTasks,
    activeAdvisories,
    handoffStages,
    handoffAction,
    onPage,
  } = props;

  const checkerExceptions = data.payrollEntries.filter((entry) => entry.status === "Exception").length;
  const previousReleasedRun = data.payrollRuns.find((run) => run.id !== currentRun?.id && run.status === "Released");
  const currentNet = Number(currentRun?.netPay ?? 0);
  const previousNet = Number(previousReleasedRun?.netPay ?? 0);
  const netDelta = currentNet - previousNet;
  const comparison = previousReleasedRun
    ? `${netDelta >= 0 ? "+" : ""}${shortMoney(netDelta)} vs ${previousReleasedRun.periodLabel}`
    : "No previous released payroll";
  const checkerAlertItems: DashboardAlertItem[] = [];
  if (pendingTasks.length) checkerAlertItems.push({ id: "approval", label: `${pendingTasks.length} payroll run${pendingTasks.length === 1 ? "" : "s"} need your approval`, tone: "warning" });
  if (checkerExceptions) checkerAlertItems.push({ id: "exceptions", label: `${checkerExceptions} payroll exception${checkerExceptions === 1 ? "" : "s"} remain visible`, tone: "danger" });
  if (activeAdvisories.length) checkerAlertItems.push({ id: "advisory", label: `${activeAdvisories.length} active compliance advisor${activeAdvisories.length === 1 ? "y" : "ies"}`, tone: "info" });
  if (!checkerAlertItems.length) checkerAlertItems.push({ id: "clear", label: "No payroll is waiting for an independent decision", tone: "success" });

  return (
    <div className="payrollph-dashboard" data-dashboard-variant="checker">
      <PageHeading
        eyebrow={data.selectedOrganization.legalName + " · Checker"}
        title={"Good morning, " + firstName + "!"}
        copy="Pending payroll items for your independent review."
      />

      <PayrollFocusCard
        title={currentRun?.periodLabel ?? "Payroll review"}
        status={pendingTasks.length ? "Awaiting review" : currentRun?.status ?? "No review"}
        payDate={currentRun?.payDate}
        employees={currentRun?.employeeCount ?? data.employees.length}
        gross={currentRun?.grossPay}
        net={currentRun?.netPay}
        comparison={comparison}
        actionLabel={pendingTasks.length ? "Review changes" : "Open approvals"}
        onAction={() => onPage("Approvals")}
      />

      <DashboardAlertBanner
        title={pendingTasks.length ? `${pendingTasks.length} payroll run${pendingTasks.length === 1 ? "" : "s"} need your approval` : "Your review queue is clear"}
        detail={pendingTasks.length ? "Review the computed payroll and resolve any remaining items before recording your decision." : "Nothing is waiting for your independent payroll decision right now."}
        items={checkerAlertItems}
        actionLabel="Review payroll"
        onAction={() => onPage("Approvals")}
      />

      <RecentPayrollRuns runs={data.payrollRuns} onViewAll={() => onPage("Approvals")} />

      <details className="dashboard-deep-details"><summary>More payroll details</summary><div className="dashboard-secondary-controls">
        <PayrollHandoff
          stages={handoffStages}
          period={handoffRun?.periodLabel ?? "Next payroll"}
          status={handoffRun?.status ?? "Waiting for inputs"}
          payDate={handoffRun?.payDate}
          viewerRole="checker"
        />
        <HandoffActionBanner action={handoffAction} onPage={onPage} role="checker" />
      </div>

      <section className="role-dashboard-grid">
        <TaskQueue title="Assigned review queue" tasks={pendingTasks} empty="No approval item is currently assigned to you." onOpen={() => onPage("Approvals")} />

        <RoleCard kicker="Control boundary" title="Independent means independent" action="Open audit trail" onAction={() => onPage("Audit trail")}>
          <GateRow label="Prepare payroll" detail="Not part of the checker role." ok={false} neutral />
          <GateRow label="Approve or decline" detail="Your decision is written to the audit trail." ok />
          <GateRow label="Release payroll" detail="Owner/admin remains responsible for release." ok={false} neutral />
          <GateRow label="Review evidence" detail="Payroll context, compliance and audit are visible before deciding." ok />
        </RoleCard>

        <RoleCard kicker="Compliance before decision" title="Rule context for the current run" action="Open compliance" onAction={() => onPage("Compliance")}>
          <FocusNumber label="Rule version" value={currentRun?.ruleVersion ?? "PH-2026.01"} detail="The calculation records the rule version used." />
          <FocusNumber label="Active advisories" value={activeAdvisories.length} detail="Premium rules apply only when an advisory covers the work dates." />
          <FocusNumber label="Payroll exceptions" value={data.payrollEntries.filter((entry) => entry.status === "Exception").length} detail="Use payroll context to understand flags; do not silently clear them." />
        </RoleCard>

        <RoleCard kicker="Evidence" title="Recent recorded actions" action="Full audit trail" onAction={() => onPage("Audit trail")}>
          <AuditRows data={data} />
        </RoleCard>
      </section></details>
    </div>
  );
}


function BookkeeperDashboard(props: RoleDashboardProps) {
  const {
    data,
    currentRun,
    firstName,
    onPage,
  } = props;

  const runEvents = currentRun
    ? data.auditEvents.filter((event) => {
        if (!event.metadata || typeof event.metadata !== "object") return false;
        return Number((event.metadata as Record<string, unknown>).runId) === currentRun.id;
      })
    : [];

  const hasEvent = (actions: string[]) => runEvents.some((event) => actions.includes(event.action));
  const bankExported = hasEvent(["bank export generated"]);
  const payoutCompleted = hasEvent(["Payroll payout completed manually", "Payroll payout completed via PayMongo"]);
  const journalExported = hasEvent(["journal export generated"]);
  const governmentExported = hasEvent(["government export generated"]);
  const released = currentRun?.status === "Released";

  const closeItems: DashboardAlertItem[] = [];
  if (!released) closeItems.push({ id: "release", label: "Payroll has not been released yet", tone: "warning" });
  if (released && !bankExported) closeItems.push({ id: "bank", label: "Final bank file has not been generated", tone: "warning" });
  if (released && !payoutCompleted) closeItems.push({ id: "payout", label: "Bank payout is not reconciled", tone: "danger" });
  if (released && !journalExported) closeItems.push({ id: "journal", label: "Accounting journal has not been exported", tone: "warning" });
  if (released && !governmentExported) closeItems.push({ id: "government", label: "Government filing worksheet/evidence is still pending", tone: "info" });
  if (!closeItems.length) closeItems.push({ id: "closed", label: "The visible payroll close controls are complete", tone: "success" });

  const outstanding = closeItems.filter((item) => item.tone !== "success").length;

  return (
    <div className="payrollph-dashboard" data-dashboard-variant="bookkeeper">
      <PageHeading
        eyebrow={data.selectedOrganization.legalName + " · Bookkeeper"}
        title={"Good morning, " + firstName + "!"}
        copy="Reconcile the payroll, payout, accounting export and statutory close from one place."
      />

      <PayrollFocusCard
        title={currentRun?.periodLabel ?? "Latest payroll"}
        status={currentRun?.status ?? "No run"}
        payDate={currentRun?.payDate}
        employees={currentRun?.employeeCount}
        gross={currentRun?.grossPay}
        net={currentRun?.netPay}
        actionLabel={released ? "Open accounting" : "Open payroll"}
        onAction={() => onPage(released ? "Exports" : "Payroll")}
      />

      <DashboardAlertBanner
        title={outstanding ? `${outstanding} payroll close item${outstanding === 1 ? "" : "s"} need attention` : "Payroll close is reconciled"}
        detail={outstanding ? "Finish the remaining accounting and remittance steps before treating this payroll cycle as closed." : "The visible payroll, payout and export controls are complete."}
        items={closeItems}
        actionLabel={released ? "Open accounting" : "Open payroll"}
        onAction={() => onPage(released ? "Exports" : "Payroll")}
      />

      <RecentPayrollRuns runs={data.payrollRuns} onViewAll={() => onPage("Payroll")} />
    </div>
  );
}


type HandoffAction = {
  title: string;
  detail: string;
  page?: string;
  label?: string;
  active: boolean;
};

function selectRoleHandoffRun(
  data: DashboardData,
  fallback: PayrollRun | undefined,
  role: WorkspaceDashboardRole,
): PayrollHandoffRunSummary | PayrollRun | undefined {
  const live = data.payrollRuns.filter((run) => run.status !== "Released");
  if (role === "checker") {
    return live.find((run) => payrollHandoffRank(run.status) === 2) ?? fallback;
  }
  if (role === "owner") {
    return live.find((run) => payrollHandoffRank(run.status) === 3) ?? fallback;
  }
  if (role === "payroll") {
    return live.find((run) => payrollHandoffRank(run.status) === 1) ?? fallback;
  }
  return data.payrollHandoffRun ?? fallback;
}

function buildHandoffAction({
  role,
  run,
  pendingLeave,
  attendanceIssues,
  missingIds,
  payrollExceptions,
}: {
  role: WorkspaceDashboardRole;
  run?: PayrollHandoffRunSummary | PayrollRun;
  pendingLeave: number;
  attendanceIssues: number;
  missingIds: number;
  payrollExceptions: number;
}): HandoffAction {
  const rank = payrollHandoffRank(run?.status);

  if (role === "hr" && rank === 0) {
    if (pendingLeave > 0) {
      return {
        title: `Review ${pendingLeave} leave request${pendingLeave === 1 ? "" : "s"}`,
        detail: `Clear leave inputs before ${run?.periodLabel ?? "this payroll"} moves to Payroll.`,
        page: "Leave",
        label: "Review leave",
        active: true,
      };
    }
    if (attendanceIssues > 0) {
      return {
        title: `Resolve ${attendanceIssues} attendance issue${attendanceIssues === 1 ? "" : "s"}`,
        detail: "Add the missing context before Payroll takes the cutoff.",
        page: "Time & attendance",
        label: "Fix attendance",
        active: true,
      };
    }
    if (missingIds > 0) {
      return {
        title: `Complete ${missingIds} employee record${missingIds === 1 ? "" : "s"}`,
        detail: "Government filing IDs should be complete before the payroll handoff.",
        page: "People",
        label: "Open people",
        active: true,
      };
    }
  }

  if (role === "payroll" && rank === 1) {
    if (payrollExceptions > 0) {
      return {
        title: `Resolve ${payrollExceptions} payroll exception${payrollExceptions === 1 ? "" : "s"}`,
        detail: `${run?.periodLabel ?? "This run"} must be clean enough for an independent checker review.`,
        page: "Payroll",
        label: "Review register",
        active: true,
      };
    }
    return {
      title: `Submit ${run?.periodLabel ?? "payroll"} to Checker`,
      detail: "The register has no visible exceptions. Choose an independent checker and hand off the run.",
      page: "Payroll",
      label: "Submit to checker",
      active: true,
    };
  }

  if (role === "checker" && rank === 2) {
    return {
      title: `Review ${run?.periodLabel ?? "submitted payroll"}`,
      detail: "Inspect the evidence and record an independent approval or decline decision.",
      page: "Approvals",
      label: "Review payroll",
      active: true,
    };
  }

  if (role === "owner" && rank === 3) {
    return {
      title: `Release ${run?.periodLabel ?? "approved payroll"}`,
      detail: "Checker approval is complete. Run the release checklist before employee payslips become available.",
      page: "Payroll",
      label: "Release payroll",
      active: true,
    };
  }

  const waitingCopy: Record<WorkspaceDashboardRole, string> = {
    hr: "Payroll is currently owned by a later stage. HR has no payroll handoff action right now.",
    payroll: "There is no payroll run currently waiting on the Payroll maker.",
    checker: "No submitted payroll is waiting for an independent checker decision.",
    owner: "No checker-approved payroll is waiting for Owner release.",
    bookkeeper: "No payroll close handoff requires bookkeeping action right now.",
  };
  return {
    title: "No handoff action required",
    detail: waitingCopy[role],
    active: false,
  };
}

function HandoffActionBanner({
  action,
  onPage,
  role,
}: {
  action: HandoffAction;
  onPage: (page: string) => void;
  role: WorkspaceDashboardRole;
}) {
  return (
    <section className={"handoff-next-action " + (action.active ? "active " : "waiting ") + role} data-handoff-action={role}>
      <div>
        <span className="card-kicker">{action.active ? "NEXT ACTION" : "HANDOFF STATUS"}</span>
        <h3>{action.title}</h3>
        <p>{action.detail}</p>
      </div>
      {action.active && action.page && action.label && (
        <button className="primary-button brand" onClick={() => onPage(action.page!)}>
          {action.label} <ArrowRight size={13} />
        </button>
      )}
    </section>
  );
}

function RoleStrip({
  kicker,
  title,
  copy,
  figures,
  tone,
}: {
  kicker: string;
  title: string;
  copy: string;
  figures: Array<[string, string]>;
  tone: WorkspaceDashboardRole;
}) {
  return (
    <section className={"role-dashboard-strip " + tone}>
      <div>
        <span className="kicker">{kicker}</span>
        <h2>{title}</h2>
        <p>{copy}</p>
      </div>
      <div className="role-strip-figures">
        {figures.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function RoleCard({
  kicker,
  title,
  action,
  onAction,
  children,
}: {
  kicker: string;
  title: string;
  action?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <article className="card role-focus-card">
      <div className="card-header">
        <div>
          <div className="card-kicker">{kicker}</div>
          <h2>{title}</h2>
        </div>
        {action && onAction && (
          <button className="link-button" onClick={onAction}>
            {action} <ArrowRight size={13} />
          </button>
        )}
      </div>
      <div className="role-card-body">{children}</div>
    </article>
  );
}

function TaskQueue({
  title,
  tasks,
  empty,
  onOpen,
}: {
  title: string;
  tasks: Task[];
  empty: string;
  onOpen: () => void;
}) {
  return (
    <RoleCard kicker="Your queue" title={title} action="Open approvals" onAction={onOpen}>
      {tasks.length ? (
        <div className="role-focus-list">
          {tasks.slice(0, 5).map((task) => (
            <div className="role-focus-row" key={task.id}>
              <span className={"role-row-icon" + (task.priority === "High" ? " warning" : "")}>
                <ClipboardCheck size={14} />
              </span>
              <div>
                <strong>{task.title}</strong>
                <span>{task.detail} · {task.dueLabel}</span>
              </div>
              <Status value={task.priority === "High" ? "High" : task.status} />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={<Check size={19} />} title="Queue clear">
          {empty}
        </EmptyState>
      )}
    </RoleCard>
  );
}

function GateRow({
  label,
  detail,
  ok,
  neutral = false,
}: {
  label: string;
  detail: string;
  ok: boolean;
  neutral?: boolean;
}) {
  return (
    <div className="role-gate-row">
      <span className={"role-gate-icon " + (neutral ? "neutral" : ok ? "ok" : "warning")}>
        {neutral ? <ShieldCheck size={14} /> : ok ? <Check size={14} /> : <AlertTriangle size={14} />}
      </span>
      <div>
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
    </div>
  );
}

function FocusNumber({
  label,
  value,
  detail,
}: {
  label: string;
  value: number | string;
  detail: string;
}) {
  return (
    <div className="role-focus-number">
      <strong>{value}</strong>
      <div>
        <b>{label}</b>
        <span>{detail}</span>
      </div>
    </div>
  );
}

function ShortcutCard({
  title,
  items,
  onPage,
}: {
  title: string;
  items: Array<[string, string]>;
  onPage: (page: string) => void;
}) {
  return (
    <RoleCard kicker="Workspaces" title={title}>
      <div className="role-shortcuts">
        {items.map(([page, detail]) => (
          <button type="button" className="role-shortcut" key={page} onClick={() => onPage(page)}>
            <div>
              <strong>{page}</strong>
              <span>{detail}</span>
            </div>
            <ArrowRight size={14} />
          </button>
        ))}
      </div>
    </RoleCard>
  );
}

function AuditRows({ data }: { data: DashboardData }) {
  if (!data.auditEvents.length) {
    return (
      <EmptyState icon={<ShieldCheck size={19} />} title="No recorded activity yet">
        Payroll, approvals and exports write audit events here.
      </EmptyState>
    );
  }

  return (
    <div className="role-focus-list">
      {data.auditEvents.slice(0, 5).map((event) => (
        <div className="role-focus-row audit" key={event.id}>
          <span className="role-row-icon"><History size={14} /></span>
          <div>
            <strong>{event.action}</strong>
            <span>{event.actor} · {event.resource}</span>
          </div>
          <time>{relativeTime(event.createdAt)}</time>
        </div>
      ))}
    </div>
  );
}

function missingIdLabel(employee: DashboardData["employees"][number]) {
  const missing = [
    !employee.tin ? "TIN" : null,
    !employee.sssNo ? "SSS" : null,
    !employee.philHealthNo ? "PhilHealth" : null,
    !employee.pagIbigNo ? "Pag-IBIG" : null,
  ].filter(Boolean);
  return missing.length ? "Missing " + missing.join(", ") : "Government IDs complete";
}
