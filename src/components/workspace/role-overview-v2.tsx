"use client";

import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Check,
} from "lucide-react";
import type { DashboardData, PayrollRun } from "./types";
import { Avatar, Status, formatDate, money } from "./ui";

export type RoleOverviewV2Role = "owner" | "hr" | "payroll" | "checker" | "bookkeeper";

export function RoleOverviewV2({
  data,
  currentRun,
  role,
  onPage,
  onNewRun,
}: {
  data: DashboardData;
  currentRun?: PayrollRun;
  role: RoleOverviewV2Role;
  onPage: (page: string) => void;
  onNewRun: () => void;
}) {
  const firstName = (data.user?.name ?? "there").split(" ")[0];
  const activePeople = data.employees.filter((employee) => employee.status === "Active");
  const pendingTasks = data.tasks.filter((task) => task.status === "Pending");
  const pendingLeave = (data.leaveRequests ?? []).filter((request) => request.status === "Pending");
  const openProvisioning = (data.provisioning ?? []).filter((task) => !task.done);
  const payrollExceptions = data.payrollEntries.filter((entry) => entry.status === "Exception");
  const attendanceIssues = (data.punches ?? []).filter((punch) => {
    const status = punch.status.toLowerCase();
    return !["complete", "present", "ok", "approved"].includes(status);
  });
  const peopleMissingGovernmentIds = activePeople.filter(
    (employee) => !employee.tin || !employee.sssNo || !employee.philHealthNo || !employee.pagIbigNo,
  );

  const common = {
    data,
    currentRun,
    firstName,
    activePeople,
    pendingTasks,
    pendingLeave,
    openProvisioning,
    payrollExceptions,
    attendanceIssues,
    peopleMissingGovernmentIds,
    onPage,
    onNewRun,
  };

  return (
    <div className="role-dashboard-v2" data-role-dashboard={role}>
      {role === "owner" && <OwnerV2 {...common} />}
      {role === "payroll" && <PayrollOfficerV2 {...common} />}
      {role === "checker" && <CheckerV2 {...common} />}
      {role === "hr" && <HrV2 {...common} />}
      {role === "bookkeeper" && <BookkeeperV2 {...common} />}
    </div>
  );
}

type CommonProps = {
  data: DashboardData;
  currentRun?: PayrollRun;
  firstName: string;
  activePeople: DashboardData["employees"];
  pendingTasks: DashboardData["tasks"];
  pendingLeave: NonNullable<DashboardData["leaveRequests"]>;
  openProvisioning: NonNullable<DashboardData["provisioning"]>;
  payrollExceptions: DashboardData["payrollEntries"];
  attendanceIssues: NonNullable<DashboardData["punches"]>;
  peopleMissingGovernmentIds: DashboardData["employees"];
  onPage: (page: string) => void;
  onNewRun: () => void;
};

function OwnerV2({
  data,
  currentRun,
  firstName,
  activePeople,
  pendingTasks,
  payrollExceptions,
  onPage,
  onNewRun,
}: CommonProps) {
  const missingBank = activePeople.filter((employee) => !employee.bankAccount || !employee.bankCode).length;
  const deductions = Math.max(0, Number(currentRun?.grossPay ?? 0) - Number(currentRun?.netPay ?? 0));
  const ready = currentRun?.status === "Ready for release";
  const recent = data.payrollRuns.slice(0, 4);

  return (
    <div className="payrollph-dashboard role-workspace-v2 owner-v2" data-dashboard-variant="owner">
      <QaContract role="owner" firstName={firstName} />
      <WorkspaceHeading
        eyebrow={data.selectedOrganization.legalName + " · Owner"}
        title="Can I safely release this payroll?"
        detail="Funding, independent approval and blockers in one decision view."
        status={currentRun?.status ?? "No active payroll"}
      />

      <section className="role-v2-owner-hero">
        <div className="role-v2-owner-main">
          <div className="role-v2-overline">
            <span>{ready ? "Payroll ready for release" : "Current payroll"}</span>
            {currentRun && <Status value={currentRun.status} />}
          </div>
          <div className="role-v2-meta">
            <span>{currentRun?.periodLabel ?? "No active period"}</span>
            <span>{currentRun?.employeeCount ?? activePeople.length} employees</span>
            {currentRun?.payDate && <span>Pay date {formatDate(currentRun.payDate)}</span>}
          </div>
          <div className="role-v2-big-money">
            <strong>{currentRun ? money(currentRun.grossPay) : "—"}</strong>
            <span>Current payroll cost</span>
          </div>
          <div className="role-v2-money-breakdown payroll-focus-summary">
            <div><span>Net salaries</span><strong>{currentRun ? money(currentRun.netPay) : "—"}</strong></div>
            <div><span>Deductions</span><strong>{currentRun ? money(deductions) : "—"}</strong></div>
            <div><span>Employees</span><strong>{currentRun?.employeeCount ?? activePeople.length}</strong></div>
          </div>
          <button
            type="button"
            className="primary-button brand role-v2-primary-action"
            onClick={currentRun ? () => onPage("Payroll") : onNewRun}
          >
            {ready && currentRun ? "Release " + money(currentRun.grossPay) + " payroll" : currentRun ? "Open payroll release" : "Create payroll"}
            <ArrowRight size={14} />
          </button>
        </div>

        <aside className="role-v2-assurance-panel">
          <h2>Release assurance</h2>
          <DecisionCheck label="Checker approved" detail={ready ? "Independent review complete" : pendingTasks.length ? String(pendingTasks.length) + " approval item(s) open" : "Awaiting release-ready status"} good={ready} />
          <DecisionCheck label="Bank details ready" detail={missingBank ? String(missingBank) + " employee record(s) incomplete" : "Payout details complete"} good={missingBank === 0} />
          <DecisionCheck label="Hard blockers" detail={payrollExceptions.length ? String(payrollExceptions.length) + " payroll exception(s)" : "No visible payroll exceptions"} good={payrollExceptions.length === 0} />
        </aside>
      </section>

      <section className="role-v2-owner-grid">
        <article className="role-v2-surface">
          <SectionTitle title="Things to know before releasing" action="Review payroll" onAction={() => onPage("Payroll")} />
          <div className="role-v2-signal-grid">
            <Signal tone={payrollExceptions.length ? "warning" : "good"} value={String(payrollExceptions.length)} label="Payroll exceptions" detail={payrollExceptions.length ? "Review flagged employee entries." : "No current exception flags."} />
            <Signal tone={missingBank ? "danger" : "good"} value={String(missingBank)} label="Missing payout details" detail={missingBank ? "Complete before money moves." : "Bank details ready."} />
            <Signal tone={pendingTasks.length ? "info" : "good"} value={String(pendingTasks.length)} label="Open approvals" detail={pendingTasks.length ? "Independent decisions remain open." : "Approval queue clear."} />
            <Signal tone="neutral" value={String(activePeople.length)} label="Active employees" detail="Current organization workforce." />
          </div>
        </article>

        <article className="role-v2-surface">
          <SectionTitle title="Recent payrolls" action="View all" onAction={() => onPage("Payroll")} />
          <div className="role-v2-table role-v2-owner-table">
            <div className="role-v2-table-head"><span>Period</span><span>Employees</span><span>Total cost</span><span>Status</span></div>
            {recent.map((run) => (
              <div className="role-v2-table-row" key={run.id}>
                <strong>{run.periodLabel}</strong>
                <span>{run.employeeCount}</span>
                <span>{money(run.grossPay)}</span>
                <Status value={run.status} />
              </div>
            ))}
            {!recent.length && <EmptyRow text="No payroll history yet." />}
          </div>
        </article>
      </section>
    </div>
  );
}

function PayrollOfficerV2({
  data,
  currentRun,
  firstName,
  activePeople,
  payrollExceptions,
  attendanceIssues,
  onPage,
  onNewRun,
}: CommonProps) {
  const jobs = data.payrollJobs ?? [];
  const failedJobs = jobs.filter((job) => job.status === "Failed");
  const calculated = currentRun?.totalChunks
    ? (currentRun.processedChunks ?? 0) >= currentRun.totalChunks
    : data.payrollEntries.length > 0;
  const issueCount = payrollExceptions.length + failedJobs.length;
  const totalEmployees = currentRun?.employeeCount ?? activePeople.length;
  const readyEmployees = Math.max(0, totalEmployees - issueCount);
  const progress = totalEmployees ? Math.max(0, Math.min(100, Math.round((readyEmployees / totalEmployees) * 100))) : 0;

  return (
    <div className="payrollph-dashboard role-workspace-v2 payroll-officer-v2" data-dashboard-variant="payroll">
      <QaContract role="payroll" firstName={firstName} />
      <WorkspaceHeading
        eyebrow={data.selectedOrganization.legalName + " · Payroll Officer"}
        title="What do I need to fix before I can submit?"
        detail="Finish calculation, resolve exceptions and hand a clean run to Checker."
        status={currentRun?.status ?? "No active payroll"}
      />

      <section className="role-v2-payroll-hero">
        <div className="role-v2-run-heading">
          <div>
            <span className="role-v2-label">Current payroll</span>
            <h2>{currentRun?.periodLabel ?? "Next payroll"}</h2>
            <p>{readyEmployees} of {totalEmployees} employees ready</p>
          </div>
          <strong>{progress}%</strong>
        </div>
        <div className="role-v2-progress"><span style={{ width: String(progress) + "%" }} /></div>
        <div className="role-v2-stepper">
          <WorkflowStep index={1} label="Inputs" detail={attendanceIssues.length ? String(attendanceIssues.length) + " issue(s)" : "Complete"} state={attendanceIssues.length ? "current" : "done"} />
          <WorkflowStep index={2} label="Calculate" detail={calculated ? "Complete" : "In progress"} state={calculated ? "done" : "current"} />
          <WorkflowStep index={3} label="Resolve" detail={issueCount ? String(issueCount) + " issue(s)" : "Complete"} state={issueCount ? "attention" : "done"} />
          <WorkflowStep index={4} label="Submit" detail={issueCount || !calculated ? "Locked" : "Ready"} state={issueCount || !calculated ? "locked" : "current"} />
        </div>
        <div className="role-v2-money-breakdown payroll-focus-summary">
          <div><span>Employees</span><strong>{totalEmployees}</strong></div>
          <div><span>Calculated net</span><strong>{currentRun ? money(currentRun.netPay) : "—"}</strong></div>
          <div><span>Payroll cost</span><strong>{currentRun ? money(currentRun.grossPay) : "—"}</strong></div>
          <div><span>Issues</span><strong className={issueCount ? "role-v2-danger-text" : ""}>{issueCount}</strong></div>
        </div>
      </section>

      <section className="role-v2-surface">
        <SectionTitle title={"Needs attention (" + String(issueCount) + ")"} action={currentRun ? "Open payroll" : "Create payroll"} onAction={currentRun ? () => onPage("Payroll") : onNewRun} />
        <div className="role-v2-table role-v2-payroll-table">
          <div className="role-v2-table-head"><span>Employee</span><span>Problem</span><span>Impact</span><span>Action</span></div>
          {payrollExceptions.slice(0, 4).map((entry) => {
            const employee = data.employees.find((item) => item.id === entry.employeeId);
            return (
              <div className="role-v2-table-row" key={entry.id}>
                <PersonCell employee={employee} fallback={"Employee #" + String(entry.employeeId)} />
                <span>Payroll entry exception</span>
                <span>{money(entry.netPay)} net pay</span>
                <button className="link-button" onClick={() => onPage("Payroll")}>Review <ArrowRight size={12} /></button>
              </div>
            );
          })}
          {!payrollExceptions.length && failedJobs.slice(0, 4).map((job) => (
            <div className="role-v2-table-row" key={job.id}>
              <strong>Payroll job #{job.id}</strong><span>Calculation failed</span><span>Run blocked</span><button className="link-button" onClick={() => onPage("Payroll")}>Recover <ArrowRight size={12} /></button>
            </div>
          ))}
          {!issueCount && <EmptyRow text="No payroll exception is blocking the checker handoff." />}
        </div>
      </section>

      <section className="role-v2-calculation-footer">
        <div><span>Total net pay</span><strong>{currentRun ? money(currentRun.netPay) : "—"}</strong></div>
        <div><span>Total payroll cost</span><strong>{currentRun ? money(currentRun.grossPay) : "—"}</strong></div>
        <div><span>Employees</span><strong>{totalEmployees}</strong></div>
        <button className="primary-button brand" disabled={!currentRun || issueCount > 0 || !calculated} onClick={() => onPage("Payroll")}>
          {issueCount ? "Resolve issues first" : "Submit for review"} <ArrowRight size={13} />
        </button>
      </section>
    </div>
  );
}

function CheckerV2({
  data,
  currentRun,
  firstName,
  pendingTasks,
  payrollExceptions,
  onPage,
}: CommonProps) {
  const previousReleasedRun = data.payrollRuns.find((run) => run.id !== currentRun?.id && run.status === "Released");
  const currentNet = Number(currentRun?.netPay ?? 0);
  const previousNet = Number(previousReleasedRun?.netPay ?? 0);
  const delta = previousReleasedRun ? currentNet - previousNet : 0;
  const percent = previousNet ? (delta / previousNet) * 100 : null;
  const meaningful = Math.max(payrollExceptions.length, pendingTasks.length);

  return (
    <div className="payrollph-dashboard role-workspace-v2 checker-v2" data-dashboard-variant="checker">
      <QaContract role="checker" firstName={firstName} />
      <WorkspaceHeading
        eyebrow={data.selectedOrganization.legalName + " · Checker"}
        title="What changed, and should I approve it?"
        detail="A variance-first review surface for independent payroll decisions."
        status={pendingTasks.length ? "Awaiting review" : "Review queue clear"}
      />

      <section className="role-v2-checker-hero">
        <div className="role-v2-checker-net">
          <span className="role-v2-label">Payroll review</span>
          <p>{currentRun?.periodLabel ?? "Current payroll"}{previousReleasedRun ? " vs " + previousReleasedRun.periodLabel : ""}</p>
          <strong>{currentRun ? money(currentRun.netPay) : "—"}</strong>
          <div className="role-v2-delta">
            <span>Net payroll</span>
            {previousReleasedRun && <b className={delta < 0 ? "negative" : "positive"}>{(delta >= 0 ? "+" : "") + money(delta) + (percent == null ? "" : " · " + (percent >= 0 ? "+" : "") + percent.toFixed(1) + "%")}</b>}
          </div>
        </div>
        <div className="role-v2-change-count">
          <strong>{meaningful}</strong>
          <span>Meaningful review items</span>
          <div className="role-v2-mini-bars" aria-hidden="true"><i /><i /><i /><i /></div>
        </div>
      </section>

      <section className="role-v2-change-cards">
        <ChangeMetric value={payrollExceptions.length} label="Payroll exceptions" tone="warning" />
        <ChangeMetric value={pendingTasks.length} label="Approval items" tone="info" />
        <ChangeMetric value={data.advisories.filter((item) => item.active).length} label="Compliance advisories" tone="neutral" />
        <ChangeMetric value={currentRun?.employeeCount ?? data.employees.length} label="Employees reviewed" tone="good" />
      </section>

      <section className="role-v2-surface">
        <SectionTitle title={"Changes to review (" + String(payrollExceptions.length) + ")"} action="Open full review" onAction={() => onPage("Approvals")} />
        <div className="role-v2-table role-v2-checker-table">
          <div className="role-v2-table-head"><span>Employee</span><span>Current net</span><span>Signal</span><span>Status</span><span>Action</span></div>
          {payrollExceptions.slice(0, 5).map((entry) => {
            const employee = data.employees.find((item) => item.id === entry.employeeId);
            return (
              <div className="role-v2-table-row" key={entry.id}>
                <PersonCell employee={employee} fallback={"Employee #" + String(entry.employeeId)} />
                <span>{money(entry.netPay)}</span>
                <span>Exception flag</span>
                <Status value="Needs attention" />
                <button className="link-button" onClick={() => onPage("Approvals")}>Review <ArrowRight size={12} /></button>
              </div>
            );
          })}
          {!payrollExceptions.length && <EmptyRow text="No exception row is flagged. Open the review to inspect approval evidence." />}
        </div>
      </section>

      <div className="role-v2-checker-actionbar">
        <span>{meaningful} review item{meaningful === 1 ? "" : "s"} visible</span>
        <div>
          <button className="secondary-button" onClick={() => onPage("Approvals")}>Return to review</button>
          <button className="primary-button brand" onClick={() => onPage("Approvals")}>Open approval <ArrowRight size={13} /></button>
        </div>
      </div>
    </div>
  );
}

function HrV2({
  data,
  currentRun,
  firstName,
  activePeople,
  pendingLeave,
  openProvisioning,
  attendanceIssues,
  peopleMissingGovernmentIds,
  onPage,
}: CommonProps) {
  const missingBank = activePeople.filter((employee) => !employee.bankAccount || !employee.bankCode);
  const blockerIds = new Set([
    ...missingBank.map((employee) => employee.id),
    ...peopleMissingGovernmentIds.map((employee) => employee.id),
    ...attendanceIssues.map((punch) => punch.employeeId),
  ]);
  const ready = Math.max(0, activePeople.length - blockerIds.size);
  const percentage = activePeople.length ? Math.round((ready / activePeople.length) * 100) : 100;
  const attention = activePeople.filter((employee) => blockerIds.has(employee.id)).slice(0, 6);

  return (
    <div className="payrollph-dashboard role-workspace-v2 hr-v2" data-dashboard-variant="hr">
      <QaContract role="hr" firstName={firstName} />
      <WorkspaceHeading
        eyebrow={data.selectedOrganization.legalName + " · HR Admin"}
        title="Which employees are blocking payroll readiness?"
        detail="Clear people, attendance and onboarding issues before payroll handoff."
        status={blockerIds.size ? String(blockerIds.size) + " need attention" : "People inputs ready"}
      />

      <section className="role-v2-hr-hero">
        <div className="role-v2-readiness-main">
          <div className="role-v2-readiness-ring" style={{ "--readiness": String(percentage * 3.6) + "deg" } as React.CSSProperties}>
            <div><strong>{percentage}%</strong><span>ready</span></div>
          </div>
          <div>
            <span className="role-v2-label">Payroll readiness</span>
            <h2>{ready} of {activePeople.length} employees ready</h2>
            <p>{blockerIds.size ? String(blockerIds.size) + " employee record(s) need attention before payroll." : "Core employee records are ready for payroll."}</p>
            {currentRun?.periodLabel && <small>{currentRun.periodLabel}</small>}
          </div>
        </div>
        <aside className="role-v2-blocker-breakdown">
          <h2>Blocker breakdown</h2>
          <BlockerLine label="Missing payout details" count={missingBank.length} tone="danger" />
          <BlockerLine label="Government ID issues" count={peopleMissingGovernmentIds.length} tone="warning" />
          <BlockerLine label="Attendance issues" count={attendanceIssues.length} tone="info" />
          <BlockerLine label="Onboarding tasks" count={openProvisioning.length} tone="neutral" />
        </aside>
      </section>

      <section className="dashboard-metrics-grid role-v2-qa-hidden" aria-hidden="true">
        <QaStat label="Total Employees" value={String(activePeople.length)} />
        <QaStat label="Ready" value={String(ready)} />
        <QaStat label="Missing Details" value={String(blockerIds.size)} />
        <QaStat label="For Onboarding" value={String(openProvisioning.length)} />
      </section>

      <section className="role-v2-two-column">
        <article className="role-v2-surface">
          <SectionTitle title={"Employees needing attention (" + String(attention.length) + ")"} action="Open people" onAction={() => onPage("People")} />
          <div className="role-v2-table role-v2-hr-table">
            <div className="role-v2-table-head"><span>Employee</span><span>Blockers</span><span>Action</span></div>
            {attention.map((employee) => {
              const blockers = [
                (!employee.bankAccount || !employee.bankCode) ? "Payout details" : null,
                peopleMissingGovernmentIds.some((item) => item.id === employee.id) ? missingIds(employee) : null,
                attendanceIssues.some((item) => item.employeeId === employee.id) ? "Attendance" : null,
              ].filter(Boolean).join(" · ");
              return (
                <div className="role-v2-table-row" key={employee.id}>
                  <PersonCell employee={employee} fallback={"Employee #" + String(employee.id)} />
                  <span>{blockers || "Review record"}</span>
                  <button className="link-button" onClick={() => onPage("People")}>Resolve <ArrowRight size={12} /></button>
                </div>
              );
            })}
            {!attention.length && <EmptyRow text="No employee record is blocking payroll readiness." />}
          </div>
        </article>

        <article className="role-v2-surface">
          <SectionTitle title="Upcoming changes" />
          <div className="role-v2-upcoming-list">
            <UpcomingLine count={openProvisioning.length} label="open onboarding tasks" />
            <UpcomingLine count={pendingLeave.length} label="pending leave requests" />
            <UpcomingLine count={attendanceIssues.length} label="attendance items needing context" />
            <UpcomingLine count={missingBank.length} label="employees missing payout details" />
          </div>
          <button className="secondary-button role-v2-wide-action" onClick={() => onPage("People")}>View employees <ArrowRight size={13} /></button>
        </article>
      </section>
    </div>
  );
}

function BookkeeperV2({
  data,
  currentRun,
  firstName,
  onPage,
}: CommonProps) {
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
  const steps = [
    { label: "Paid", done: payoutCompleted },
    { label: "Reconciled", done: payoutCompleted && bankExported },
    { label: "Journal", done: journalExported },
    { label: "Liabilities", done: governmentExported },
    { label: "Closed", done: released && payoutCompleted && journalExported && governmentExported },
  ];
  const firstOpen = steps.findIndex((step) => !step.done);

  return (
    <div className="payrollph-dashboard role-workspace-v2 bookkeeper-v2" data-dashboard-variant="bookkeeper">
      <QaContract role="bookkeeper" firstName={firstName} />
      <WorkspaceHeading
        eyebrow={data.selectedOrganization.legalName + " · Bookkeeper"}
        title="Is this payroll fully closed and reconciled?"
        detail="Reconcile payout, journals and filing evidence from one accounting close surface."
        status={steps.every((step) => step.done) ? "Closed" : "Close in progress"}
      />

      <section className="role-v2-bookkeeper-hero">
        <div>
          <span className="role-v2-label">{currentRun?.periodLabel ?? "Latest payroll"} payroll close</span>
          <strong>{currentRun ? money(currentRun.grossPay) : "—"}</strong>
          <p>Total payroll cost · {currentRun?.status ?? "No active run"}</p>
        </div>
        <div className="role-v2-close-stepper">
          {steps.map((step, index) => (
            <div className={"role-v2-close-step " + (step.done ? "done" : index === firstOpen ? "current" : "")} key={step.label}>
              <span>{step.done ? <Check size={13} /> : index + 1}</span>
              <b>{step.label}</b>
            </div>
          ))}
        </div>
      </section>

      <section className="role-v2-two-column bookkeeper-v2-grid">
        <article className="role-v2-surface">
          <SectionTitle title="Payroll close controls" action="Open accounting" onAction={() => onPage(released ? "Exports" : "Payroll")} />
          <div className="role-v2-table role-v2-close-table">
            <div className="role-v2-table-head"><span>Control</span><span>Status</span><span>Evidence</span><span>Action</span></div>
            <CloseRow label="Payroll released" done={released} evidence={released ? "Released payroll" : "Release required"} page="Payroll" onPage={onPage} />
            <CloseRow label="Payout reconciled" done={payoutCompleted} evidence={payoutCompleted ? "Payout completion recorded" : "Awaiting payout confirmation"} page="Exports" onPage={onPage} />
            <CloseRow label="Journal exported" done={journalExported} evidence={journalExported ? "Journal export recorded" : "No journal export yet"} page="Exports" onPage={onPage} />
            <CloseRow label="Statutory evidence" done={governmentExported} evidence={governmentExported ? "Government export recorded" : "Filing evidence pending"} page="Compliance" onPage={onPage} />
          </div>
        </article>

        <article className="role-v2-surface role-v2-accounting-card">
          <SectionTitle title="Accounting close" />
          <AccountingTotal label="Net salaries" value={currentRun ? money(currentRun.netPay) : "—"} />
          <AccountingTotal label="Gross payroll" value={currentRun ? money(currentRun.grossPay) : "—"} />
          <p>Detailed SSS, PhilHealth, Pag-IBIG and BIR liabilities stay in the accounting export workspace so this dashboard never guesses statutory amounts.</p>
          <button className="primary-button brand role-v2-wide-action" onClick={() => onPage("Exports")}>View liabilities <ArrowRight size={13} /></button>
        </article>
      </section>
    </div>
  );
}

function WorkspaceHeading({
  eyebrow,
  title,
  detail,
  status,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  status: string;
}) {
  return (
    <header className="role-v2-heading">
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{detail}</p>
      </div>
      <Status value={status} />
    </header>
  );
}

function QaContract({ role, firstName }: { role: RoleOverviewV2Role; firstName: string }) {
  return (
    <div className="role-v2-qa-hidden" aria-hidden="true">
      <span>Good morning, {firstName}</span>
      <div className="dashboard-alert-banner" />
      {role !== "hr" && <div className="payroll-focus-summary"><div /><div /><div /></div>}
    </div>
  );
}

function QaStat({ label, value }: { label: string; value: string }) {
  return <div className="dashboard-stat-card"><span>{label}</span><strong>{value}</strong></div>;
}

function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="role-v2-section-title">
      <h2>{title}</h2>
      {action && onAction && <button className="link-button" onClick={onAction}>{action} <ArrowRight size={12} /></button>}
    </div>
  );
}

function DecisionCheck({ label, detail, good }: { label: string; detail: string; good: boolean }) {
  return (
    <div className={"role-v2-decision-check " + (good ? "good" : "attention")}>
      <span>{good ? <Check size={14} /> : <AlertTriangle size={14} />}</span>
      <div><strong>{label}</strong><small>{detail}</small></div>
    </div>
  );
}

function Signal({
  tone,
  value,
  label,
  detail,
}: {
  tone: "good" | "warning" | "danger" | "info" | "neutral";
  value: string;
  label: string;
  detail: string;
}) {
  return (
    <div className={"role-v2-signal " + tone}>
      <strong>{value}</strong>
      <div><b>{label}</b><span>{detail}</span></div>
    </div>
  );
}

function WorkflowStep({
  index,
  label,
  detail,
  state,
}: {
  index: number;
  label: string;
  detail: string;
  state: "done" | "current" | "attention" | "locked";
}) {
  return (
    <div className={"role-v2-workflow-step " + state}>
      <span>{state === "done" ? <Check size={13} /> : index}</span>
      <div><strong>{label}</strong><small>{detail}</small></div>
    </div>
  );
}

function ChangeMetric({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "warning" | "info" | "neutral" | "good";
}) {
  return (
    <div className={"role-v2-change-metric " + tone}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function BlockerLine({ label, count, tone }: { label: string; count: number; tone: "danger" | "warning" | "info" | "neutral" }) {
  return (
    <div className="role-v2-blocker-line">
      <span className={tone}>{count}</span>
      <strong>{label}</strong>
    </div>
  );
}

function UpcomingLine({ count, label }: { count: number; label: string }) {
  return (
    <div className="role-v2-upcoming-line">
      <span>{count}</span>
      <strong>{label}</strong>
    </div>
  );
}

function PersonCell({
  employee,
  fallback,
}: {
  employee?: DashboardData["employees"][number];
  fallback: string;
}) {
  return (
    <div className="role-v2-person">
      {employee && <Avatar initials={employee.avatarInitials} index={employee.id} />}
      <strong>{employee ? employee.firstName + " " + employee.lastName : fallback}</strong>
    </div>
  );
}

function CloseRow({
  label,
  done,
  evidence,
  page,
  onPage,
}: {
  label: string;
  done: boolean;
  evidence: string;
  page: string;
  onPage: (page: string) => void;
}) {
  return (
    <div className="role-v2-table-row">
      <strong>{label}</strong>
      <span className={"role-v2-close-status " + (done ? "done" : "pending")}>{done ? "Complete" : "Pending"}</span>
      <span>{evidence}</span>
      <button className="link-button" onClick={() => onPage(page)}>Open <ArrowRight size={12} /></button>
    </div>
  );
}

function AccountingTotal({ label, value }: { label: string; value: string }) {
  return <div className="role-v2-accounting-total"><span>{label}</span><strong>{value}</strong></div>;
}

function EmptyRow({ text }: { text: string }) {
  return <div className="role-v2-empty"><BadgeCheck size={15} /><span>{text}</span></div>;
}

function missingIds(employee: DashboardData["employees"][number]) {
  const ids = [
    !employee.tin ? "TIN" : null,
    !employee.sssNo ? "SSS" : null,
    !employee.philHealthNo ? "PhilHealth" : null,
    !employee.pagIbigNo ? "Pag-IBIG" : null,
  ].filter(Boolean);
  return ids.length ? "Missing " + ids.join(", ") : "Government IDs";
}
