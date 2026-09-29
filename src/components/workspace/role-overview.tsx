"use client";

import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  Check,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  FileWarning,
  History,
  ShieldCheck,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { PayrollHandoff } from "@/components/payroll-handoff";
import { buildPayrollHandoff, type PayrollHandoffStage } from "@/lib/payroll-handoff";
import { getPayrollActions, type PayrollActionItem } from "@/lib/payroll-action-center";
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

export type WorkspaceDashboardRole = "owner" | "hr" | "payroll" | "checker";

export function RoleOverviewView({
  data,
  currentRun,
  role,
  onPage,
  onNewRun,
}: {
  data: DashboardData;
  currentRun?: PayrollRun;
  role: WorkspaceDashboardRole;
  onPage: (page: string) => void;
  onNewRun: () => void;
}) {
  const firstName = (data.user?.name ?? "there").split(" ")[0];
  const activePeople = data.employees.filter((employee) => employee.status === "Active");
  const pendingTasks = data.tasks.filter((task) => task.status === "Pending");
  const highPriorityTasks = pendingTasks.filter((task) => task.priority === "High");
  const pendingLeave = (data.leaveRequests ?? []).filter((request) => request.status === "Pending");
  const openProvisioning = (data.provisioning ?? []).filter((task) => !task.done);
  const payrollExceptions = data.payrollEntries.filter((entry) => entry.status === "Exception");
  const pendingRetro = (data.retroAdjustments ?? []).filter((item) => item.status === "pending");
  const attendanceIssues = (data.punches ?? []).filter((punch) => {
    const status = punch.status.toLowerCase();
    return !["complete", "present", "ok", "approved"].includes(status);
  });
  const peopleMissingGovernmentIds = data.employees.filter(
    (employee) =>
      employee.status === "Active" &&
      (!employee.tin || !employee.sssNo || !employee.philHealthNo || !employee.pagIbigNo),
  );
  const activeAdvisories = data.advisories.filter((advisory) => advisory.active);
  const handoffRun = currentRun ?? data.payrollHandoffRun ?? undefined;
  const payrollApproval = handoffRun
    ? data.tasks
        .filter((task) => task.detail.includes(`Payroll run #${handoffRun.id}`))
        .sort((a, b) => b.id - a.id)[0] ?? null
    : null;
  const handoffStages = buildPayrollHandoff(handoffRun, {
    hrIssues: pendingLeave.length + attendanceIssues.length + peopleMissingGovernmentIds.length,
    payrollExceptions: payrollExceptions.length,
    approvalTask: payrollApproval,
  });
  const roleActions = getPayrollActions(data, role);

  const common = {
    data,
    currentRun,
    handoffRun,
    firstName,
    activePeople,
    pendingTasks,
    highPriorityTasks,
    pendingLeave,
    openProvisioning,
    payrollExceptions,
    pendingRetro,
    attendanceIssues,
    peopleMissingGovernmentIds,
    activeAdvisories,
    handoffStages,
    roleActions,
    onPage,
    onNewRun,
  };

  return (
    <div className="role-dashboard" data-role-dashboard={role}>
      {role === "owner" && <OwnerDashboard {...common} />}
      {role === "hr" && <HrDashboard {...common} />}
      {role === "payroll" && <PayrollDashboard {...common} />}
      {role === "checker" && <CheckerDashboard {...common} />}
    </div>
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
  roleActions: PayrollActionItem[];
  onPage: (page: string) => void;
  onNewRun: () => void;
};

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
    roleActions,
    onPage,
    onNewRun,
  } = props;

  const releaseBlocked =
    !currentRun ||
    (currentRun.status !== "Released" &&
      (payrollExceptions.length > 0 || pendingTasks.length > 0 || currentRun.status !== "Approved"));

  return (
    <>
      <PageHeading
        eyebrow={data.selectedOrganization.legalName + " · Owner"}
        title={"Company control center, " + firstName + "."}
        copy="See payroll release risk, people health and recorded decisions without working through every module."
        actions={
          <>
            <button className="secondary-button" onClick={() => onPage("Analytics")}>Analytics</button>
            <button className="primary-button brand" onClick={onNewRun}>New payroll</button>
          </>
        }
      />

      <RoleStrip
        kicker="Owner focus"
        title={currentRun ? currentRun.periodLabel + " · " + currentRun.status : "No payroll is in progress"}
        copy={
          currentRun
            ? releaseBlocked
              ? "This run still has conditions to clear before release."
              : "The current run has cleared the visible release gates."
            : "Create the next payroll when the cutoff is ready."
        }
        figures={[
          ["Net payroll", currentRun ? shortMoney(currentRun.netPay) : "—"],
          ["Open decisions", String(pendingTasks.length)],
          ["People", String(activePeople.length)],
        ]}
        tone="owner"
      />

      <PayrollHandoff
        stages={handoffStages}
        period={handoffRun?.periodLabel ?? "Next payroll"}
        status={handoffRun?.status ?? "Waiting for inputs"}
        payDate={handoffRun?.payDate}
        viewerRole="owner"
      />

      <ActionCenter role="owner" actions={roleActions} onPage={onPage} />

      <section className="stats-grid">
        <Metric
          label="Release status"
          value={currentRun?.status ?? "No run"}
          hint={releaseBlocked ? "still needs attention" : "visible gates are clear"}
          icon={<WalletCards size={16} />}
          tone={releaseBlocked ? "amber" : "mint"}
          compact
        />
        <Metric
          label="Payroll exceptions"
          value={String(payrollExceptions.length)}
          hint={payrollExceptions.length ? "must be understood before release" : "no entry exceptions"}
          icon={<AlertTriangle size={16} />}
          tone={payrollExceptions.length ? "amber" : "mint"}
        />
        <Metric
          label="People data gaps"
          value={String(peopleMissingGovernmentIds.length)}
          hint="active people missing at least one filing ID"
          icon={<UsersRound size={16} />}
          tone={peopleMissingGovernmentIds.length ? "purple" : "mint"}
        />
        <Metric
          label="Active advisories"
          value={String(activeAdvisories.length)}
          hint={activeAdvisories.length ? "may affect payroll rules" : "no active hazard advisory"}
          icon={<ShieldCheck size={16} />}
          tone={activeAdvisories.length ? "amber" : "blue"}
        />
      </section>

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
      </section>
    </>
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
    roleActions,
    onPage,
  } = props;

  return (
    <>
      <PageHeading
        eyebrow={data.selectedOrganization.legalName + " · HR Admin"}
        title={"People operations today, " + firstName + "."}
        copy="Work the people issues that can block attendance, leave, onboarding and the next payroll cutoff."
        actions={
          <>
            <button className="secondary-button" onClick={() => onPage("Time & attendance")}>Attendance</button>
            <button className="primary-button brand" onClick={() => onPage("People")}>Open people</button>
          </>
        }
      />

      <RoleStrip
        kicker="HR focus"
        title={String(activePeople.length) + " active people · " + String(pendingLeave.length + attendanceIssues.length + openProvisioning.length) + " open people items"}
        copy="Prioritize records and attendance that affect payroll before the cutoff reaches the payroll officer."
        figures={[
          ["Leave waiting", String(pendingLeave.length)],
          ["Attendance issues", String(attendanceIssues.length)],
          ["Onboarding items", String(openProvisioning.length)],
        ]}
        tone="hr"
      />

      <PayrollHandoff
        stages={handoffStages}
        period={handoffRun?.periodLabel ?? "Next payroll"}
        status={handoffRun?.status ?? "Waiting for inputs"}
        payDate={handoffRun?.payDate}
        viewerRole="hr"
      />

      <ActionCenter role="hr" actions={roleActions} onPage={onPage} />

      <section className="stats-grid">
        <Metric label="Active people" value={String(activePeople.length)} hint={"of " + String(data.employees.length) + " employee records"} icon={<UsersRound size={16} />} tone="purple" />
        <Metric label="Pending leave" value={String(pendingLeave.length)} hint={pendingLeave.length ? "needs HR review" : "leave queue clear"} icon={<CalendarClock size={16} />} tone={pendingLeave.length ? "amber" : "mint"} />
        <Metric label="Attendance issues" value={String(attendanceIssues.length)} hint={attendanceIssues.length ? "punches need context" : "no current punch issues"} icon={<Clock3 size={16} />} tone={attendanceIssues.length ? "amber" : "blue"} />
        <Metric label="Missing filing IDs" value={String(peopleMissingGovernmentIds.length)} hint="active people with an incomplete government identity" icon={<FileWarning size={16} />} tone={peopleMissingGovernmentIds.length ? "amber" : "mint"} />
      </section>

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
      </section>
    </>
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
    roleActions,
    onPage,
    onNewRun,
  } = props;

  const jobs = data.payrollJobs ?? [];
  const failedJobs = jobs.filter((job) => job.status === "Failed");
  const queueDone = currentRun?.totalChunks
    ? (currentRun.processedChunks ?? 0) >= currentRun.totalChunks
    : data.payrollEntries.length > 0;

  return (
    <>
      <PageHeading
        eyebrow={data.selectedOrganization.legalName + " · Payroll Officer"}
        title={"Cutoff control center, " + firstName + "."}
        copy="Resolve payroll inputs, calculate the register and hand the run to an independent checker. Release stays outside the payroll-maker role."
        actions={
          <>
            <button className="secondary-button" onClick={() => onPage("Exports")}>Exports</button>
            <button className="primary-button brand" onClick={currentRun ? () => onPage("Payroll") : onNewRun}>
              {currentRun ? "Open payroll" : "New payroll"}
            </button>
          </>
        }
      />

      <RoleStrip
        kicker="Payroll focus"
        title={currentRun ? currentRun.periodLabel + " · " + currentRun.status : "No open payroll run"}
        copy={
          currentRun
            ? payrollExceptions.length
              ? "Resolve " + String(payrollExceptions.length) + " exception(s), then send the run to checker review."
              : "The register has no entry exceptions. Confirm cutoff inputs before submission."
            : "Create the next run after HR closes the cutoff inputs."
        }
        figures={[
          ["Net pay", currentRun ? shortMoney(currentRun.netPay) : "—"],
          ["Exceptions", String(payrollExceptions.length)],
          ["Retro items", String(pendingRetro.length)],
        ]}
        tone="payroll"
      />

      <PayrollHandoff
        stages={handoffStages}
        period={handoffRun?.periodLabel ?? "Next payroll"}
        status={handoffRun?.status ?? "Waiting for inputs"}
        payDate={handoffRun?.payDate}
        viewerRole="payroll"
      />

      <ActionCenter role="payroll" actions={roleActions} onPage={onPage} />

      <section className="stats-grid">
        <Metric label="Run status" value={currentRun?.status ?? "No run"} hint={queueDone ? "calculation queue complete" : "calculation still in progress"} icon={<WalletCards size={16} />} tone={currentRun ? "blue" : "slate"} compact />
        <Metric label="Entry exceptions" value={String(payrollExceptions.length)} hint={payrollExceptions.length ? "review before checker handoff" : "register is clean"} icon={<AlertTriangle size={16} />} tone={payrollExceptions.length ? "amber" : "mint"} />
        <Metric label="Pending retro" value={String(pendingRetro.length)} hint="effective-dated corrections waiting for settlement" icon={<History size={16} />} tone={pendingRetro.length ? "purple" : "mint"} />
        <Metric label="Checker queue" value={String(pendingTasks.length)} hint={pendingTasks.length ? "approval items still open" : "no pending approval"} icon={<ClipboardCheck size={16} />} tone={pendingTasks.length ? "amber" : "mint"} />
      </section>

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
      </section>
    </>
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
    roleActions,
    onPage,
  } = props;

  return (
    <>
      <PageHeading
        eyebrow={data.selectedOrganization.legalName + " · Checker"}
        title={"Independent review queue, " + firstName + "."}
        copy="Review what the payroll maker submitted, inspect compliance context and record an independent decision. You do not prepare or release payroll."
        actions={
          <>
            <button className="secondary-button" onClick={() => onPage("Audit trail")}>Audit trail</button>
            <button className="primary-button brand" onClick={() => onPage("Approvals")}>Open approvals</button>
          </>
        }
      />

      <RoleStrip
        kicker="Checker focus"
        title={pendingTasks.length ? String(pendingTasks.length) + " review item(s) waiting" : "Your review queue is clear"}
        copy={pendingTasks.length ? "Work high-priority items first, then verify compliance context before deciding." : "There is nothing waiting for your independent decision right now."}
        figures={[
          ["High priority", String(highPriorityTasks.length)],
          ["Run status", currentRun?.status ?? "No run"],
          ["Advisories", String(activeAdvisories.length)],
        ]}
        tone="checker"
      />

      <PayrollHandoff
        stages={handoffStages}
        period={handoffRun?.periodLabel ?? "Next payroll"}
        status={handoffRun?.status ?? "Waiting for inputs"}
        payDate={handoffRun?.payDate}
        viewerRole="checker"
      />

      <ActionCenter role="checker" actions={roleActions} onPage={onPage} />

      <section className="stats-grid">
        <Metric label="Assigned reviews" value={String(pendingTasks.length)} hint={pendingTasks.length ? "awaiting your decision" : "queue clear"} icon={<ClipboardCheck size={16} />} tone={pendingTasks.length ? "amber" : "mint"} />
        <Metric label="High priority" value={String(highPriorityTasks.length)} hint={highPriorityTasks.length ? "review these first" : "no urgent item"} icon={<AlertTriangle size={16} />} tone={highPriorityTasks.length ? "amber" : "mint"} />
        <Metric label="Payroll context" value={currentRun?.status ?? "No run"} hint={currentRun?.periodLabel ?? "no payroll currently visible"} icon={<CircleDollarSign size={16} />} tone="blue" compact />
        <Metric label="Active advisories" value={String(activeAdvisories.length)} hint={activeAdvisories.length ? "check rule impact before approval" : "no active hazard advisory"} icon={<ShieldCheck size={16} />} tone={activeAdvisories.length ? "amber" : "mint"} />
      </section>

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
      </section>
    </>
  );
}

function ActionCenter({
  role,
  actions,
  onPage,
}: {
  role: WorkspaceDashboardRole;
  actions: PayrollActionItem[];
  onPage: (page: string) => void;
}) {
  const clearCopy: Record<WorkspaceDashboardRole, string> = {
    owner: "No approved payroll is waiting for release.",
    hr: "No HR cutoff blockers are visible. Payroll can work from the current people and attendance inputs.",
    payroll: "No payroll-maker action is waiting right now. The run is either with another role or already released.",
    checker: "No payroll review is currently assigned to you.",
  };

  return (
    <section className="card payroll-action-center" data-payroll-action-center={role}>
      <div className="card-header">
        <div>
          <div className="card-kicker">NEXT ACTION</div>
          <h2>{actions.length ? "Move the payroll forward" : "Nothing waiting on you"}</h2>
          <p>{actions.length ? "These items come from live payroll, people, attendance and approval state." : clearCopy[role]}</p>
        </div>
        {!actions.length && <span className="status status-approved"><Check size={12} /> Clear</span>}
      </div>

      {actions.length > 0 && (
        <div className="payroll-action-list">
          {actions.map((action) => (
            <button
              type="button"
              className={`payroll-action-item ${action.tone} ${action.blocking ? "blocking" : ""}`}
              key={action.id}
              data-action-page={action.page}
              onClick={() => onPage(action.page)}
            >
              <span className="payroll-action-icon" aria-hidden>
                {action.blocking ? <AlertTriangle size={15} /> : <ShieldCheck size={15} />}
              </span>
              <span className="payroll-action-copy">
                <strong>{action.title}</strong>
                <small>{action.detail}</small>
              </span>
              <span className="payroll-action-cta">{action.actionLabel} <ArrowRight size={13} /></span>
            </button>
          ))}
        </div>
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
