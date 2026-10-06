"use client";

import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Check,
  Clock3,
  FileWarning,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { PayrollHandoff } from "@/components/payroll-handoff";
import { buildPayrollHandoff } from "@/lib/payroll-handoff";
import { readLineItems, type DashboardData, type PayrollRun } from "./types";
import { StatutoryRemittanceWatch } from "./statutory-remittance-watch";
import { Avatar, EmptyState, Status } from "./ui";

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
  if (role === "owner") return <OwnerWorkspace data={data} currentRun={currentRun} firstName={firstName} onPage={onPage} onNewRun={onNewRun} />;
  if (role === "payroll") return <PayrollWorkspace data={data} currentRun={currentRun} firstName={firstName} onPage={onPage} onNewRun={onNewRun} />;
  if (role === "checker") return <CheckerWorkspace data={data} currentRun={currentRun} firstName={firstName} onPage={onPage} />;
  if (role === "hr") return <HrWorkspace data={data} currentRun={currentRun} firstName={firstName} onPage={onPage} />;
  return <BookkeeperWorkspace data={data} currentRun={currentRun} firstName={firstName} onPage={onPage} />;
}

type CommonProps = {
  data: DashboardData;
  currentRun?: PayrollRun;
  firstName: string;
  onPage: (page: string) => void;
};

function OwnerWorkspace({ data, currentRun, firstName, onPage, onNewRun }: CommonProps & { onNewRun: () => void }) {
  const activePeople = data.employees.filter((employee) => employee.status === "Active");
  const missingBankEmployees = activePeople.filter((employee) => !employee.bankAccount || !employee.bankCode);
  const missingBank = missingBankEmployees.length;
  const exceptions = data.payrollEntries.filter((entry) => entry.status === "Exception").length;
  const incompletePunches = (data.punches ?? []).filter((punch) => !punch.timeIn || !punch.timeOut);
  const attendanceIssues = incompletePunches.length;
  const pendingLeave = (data.leaveRequests ?? []).filter((request) => request.status === "Pending").length;
  const previous = data.payrollRuns.find((run) => run.id !== currentRun?.id && run.status === "Released");
  const currentGross = Number(currentRun?.grossPay ?? 0);
  const previousGross = Number(previous?.grossPay ?? 0);
  const deltaPct = previousGross ? ((currentGross - previousGross) / previousGross) * 100 : 0;
  const readyForRelease = currentRun?.status === "Ready for release";
  const released = currentRun?.status === "Released";
  const checkerApproved = readyForRelease || released;
  // Only conditions that can actually stop payroll count as blockers here.
  // Pending leave still stays visible below as an attention item, but it does not
  // make Home claim payroll is blocked unless the payroll flow itself blocks it.
  const payrollBlockers = missingBank + exceptions + attendanceIssues;
  const hardBlockers = payrollBlockers + (checkerApproved ? 0 : 1);
  const readyEmployees = Math.max(
    0,
    (currentRun?.employeeCount ?? activePeople.length) - new Set([
      ...data.payrollEntries.filter((entry) => entry.status === "Exception").map((entry) => entry.employeeId),
      ...incompletePunches.map((punch) => punch.employeeId),
      ...missingBankEmployees.map((employee) => employee.id),
    ]).size,
  );
  const net = Number(currentRun?.netPay ?? 0);
  const deductions = Math.max(0, currentGross - net);
  const payChanges = (data.payRevisions ?? []).length;
  const retro = (data.retroAdjustments ?? []).filter((item) => item.status === "pending").length;

  return (
    <div className="payrollph-dashboard role-workspace-v2 mockup-role-page" data-role-dashboard="owner" data-dashboard-variant="owner">
      <ContractGreeting firstName={firstName} />
      <span className="role-contract-copy">What do I need to do to get everyone paid?</span>

      <section className="mockup-owner-release dashboard-alert-banner">
        <div className="mockup-owner-head">
          <div>
            <strong>{released ? "Payroll complete" : readyForRelease ? "Payroll ready for release" : "Next payroll"}</strong>
            <span>{currentRun?.periodLabel ?? "Not started"} · {readyEmployees} of {currentRun?.employeeCount ?? activePeople.length} employees ready{currentRun?.payDate ? " · Pay date " + formatShortDate(currentRun.payDate) : ""}</span>
          </div>
          <Status value={currentRun?.status ?? "Not started"} />
        </div>

        <div className="mockup-owner-value-row">
          <div>
            <span className="mockup-big-money">{fullMoney(currentGross)}</span>
            <small>Gross payroll</small>
          </div>
          {previous && (
            <div className="mockup-delta-badge">
              <strong>{deltaPct >= 0 ? "+" : ""}{deltaPct.toFixed(1)}%</strong>
              <span>from previous payroll</span>
            </div>
          )}
        </div>

        <div className="mockup-owner-breakdown payroll-focus-summary">
          <MockMetric label="Net salaries" value={fullMoney(net)} />
          <MockMetric label="Payroll deductions" value={fullMoney(deductions)} />
          <MockMetric label="Employees" value={String(currentRun?.employeeCount ?? activePeople.length)} />
        </div>

        <button className="mockup-owner-release-button" type="button" onClick={currentRun ? () => onPage("Payroll") : onNewRun}>
          {!currentRun ? "Start payroll" : readyForRelease ? "Review & release payroll" : released ? "View payroll details" : payrollBlockers ? "Fix payroll issues" : "Continue payroll"}
          <ArrowRight size={14} />
        </button>

        <div className="mockup-assurance-row">
          <MockCheck ok={checkerApproved} label="Checker approved" detail={checkerApproved ? "Independent review complete" : "Review pending"} />
          <MockCheck ok={missingBank === 0} label="Bank details ready" detail={missingBank ? String(missingBank) + " need attention" : "All verified"} />
          <MockCheck ok={hardBlockers === 0} label={hardBlockers ? String(hardBlockers) + " item" + (hardBlockers === 1 ? "" : "s") + " need attention" : "No blocking issues"} detail={hardBlockers ? "Resolve before payroll can finish" : "All clear"} />
        </div>
      </section>

      <section className="mockup-section mockup-owner-alerts">
        <MockupSectionHeader title="Things to know before releasing" />
        <div className="mockup-knowledge-grid">
          <KnowledgeItem tone={attendanceIssues ? "rose" : "green"} title={attendanceIssues ? String(attendanceIssues) + " attendance issue" + (attendanceIssues === 1 ? "" : "s") : "Attendance ready"} detail={attendanceIssues ? "Resolve time inputs before payroll can finish" : "No attendance blockers"} action={attendanceIssues ? "Review time" : undefined} onAction={attendanceIssues ? () => onPage("Time & attendance") : undefined} />
          <KnowledgeItem tone={pendingLeave ? "amber" : "green"} title={pendingLeave ? String(pendingLeave) + " leave request" + (pendingLeave === 1 ? "" : "s") + " pending" : "Leave ready"} detail={pendingLeave ? "Review leave before payroll handoff" : "No pending leave inputs"} action={pendingLeave ? "Review leave" : undefined} onAction={pendingLeave ? () => onPage("Leave") : undefined} />
          <KnowledgeItem tone={exceptions ? "rose" : "green"} title={exceptions ? String(exceptions) + " payroll exception" + (exceptions === 1 ? "" : "s") : "No payroll exceptions"} detail={exceptions ? "Review high-variance payroll entries" : "Current register is clear"} action={exceptions ? "Review payroll" : undefined} onAction={exceptions ? () => onPage("Payroll") : undefined} />
          <KnowledgeItem tone={retro ? "amber" : "green"} title={retro ? String(retro) + " pending retro adjustment" + (retro === 1 ? "" : "s") : "No pending retro adjustments"} detail="Included only in the payroll where they settle" action={retro ? "Review payroll" : undefined} onAction={retro ? () => onPage("Payroll") : undefined} />
          <KnowledgeItem tone={payChanges ? "blue" : "green"} title={payChanges ? String(payChanges) + " pay revision" + (payChanges === 1 ? "" : "s") : "No salary changes"} detail="Changes remain visible before release" action={payChanges ? "Review compensation" : undefined} onAction={payChanges ? () => onPage("Compensation") : undefined} />
          <KnowledgeItem tone={missingBank ? "rose" : "green"} title={missingBank ? String(missingBank) + " bank detail issue" + (missingBank === 1 ? "" : "s") : "No bank detail changes"} detail={missingBank ? "Resolve payout details first" : "Since last payroll"} action={missingBank ? "Open employees" : undefined} onAction={missingBank ? () => onPage("People") : undefined} />
        </div>
      </section>

      <section className="mockup-section">
        <MockupSectionHeader title="Recent payrolls" action="View all" onAction={() => onPage("Payroll")} />
        <CompactPayrollHistory runs={data.payrollRuns.slice(0, 4)} onOpen={() => onPage("Payroll")} />
      </section>
    </div>
  );
}

function PayrollWorkspace({ data, currentRun, firstName, onPage, onNewRun }: CommonProps & { onNewRun: () => void }) {
  const exceptions = data.payrollEntries.filter((entry) => entry.status === "Exception");
  const attendanceIssues = (data.punches ?? []).filter((punch) => !["complete", "present", "ok", "approved"].includes(punch.status.toLowerCase()));
  const pendingRetro = (data.retroAdjustments ?? []).filter((item) => item.status === "pending");
  const total = currentRun?.employeeCount ?? data.employees.length;
  const issueEmployeeIds = new Set([...exceptions.map((entry) => entry.employeeId), ...attendanceIssues.map((punch) => punch.employeeId)]);
  const ready = Math.max(0, total - issueEmployeeIds.size);
  const percent = total ? Math.round((ready / total) * 100) : 0;
  const calculated = Boolean(currentRun && data.payrollEntries.length);
  const canSubmit = calculated && exceptions.length === 0 && attendanceIssues.length === 0;
  const totalCost = Number(currentRun?.grossPay ?? 0);

  const issues = [
    ...attendanceIssues.slice(0, 2).map((punch) => ({
      id: "time-" + String(punch.id),
      employeeId: punch.employeeId,
      problem: "Missing attendance",
      impact: "Pay blocked",
      action: "Resolve",
      page: "Time & attendance",
      tone: "rose",
    })),
    ...exceptions.slice(0, 2).map((entry) => ({
      id: "pay-" + String(entry.id),
      employeeId: entry.employeeId,
      problem: "Payroll exception",
      impact: "Needs review",
      action: "Review",
      page: "Payroll",
      tone: "amber",
    })),
    ...pendingRetro.slice(0, 1).map((retroItem) => ({
      id: "retro-" + String(retroItem.id),
      employeeId: retroItem.employeeId,
      problem: "Retro adjustment",
      impact: "Payroll change",
      action: "Review",
      page: "Payroll",
      tone: "blue",
    })),
  ].slice(0, 6);

  return (
    <div className="payrollph-dashboard role-workspace-v2 mockup-role-page" data-role-dashboard="payroll" data-dashboard-variant="payroll">
      <ContractGreeting firstName={firstName} />
      <span className="role-contract-copy">What do I need to fix before I can submit?</span>

      <section className="mockup-page-intro">
        <div>
          <h1>{currentRun?.periodLabel ?? "Next payroll"} payroll</h1>
          <p>{ready} of {total} employees ready</p>
        </div>
      </section>

      <section className="mockup-progress-block dashboard-alert-banner">
        <div className="mockup-progress-line">
          <span><i style={{ width: String(percent) + "%" }} /></span>
          <strong>{percent}%</strong>
        </div>
        <div className="mockup-four-step">
          <MockStep index={1} label="Inputs" detail={attendanceIssues.length ? String(attendanceIssues.length) + " issues" : "Complete"} state={attendanceIssues.length ? "attention" : "done"} />
          <MockStep index={2} label="Calculate" detail={calculated ? "Complete" : "Current"} state={calculated ? "done" : "current"} />
          <MockStep index={3} label="Resolve" detail={exceptions.length ? String(exceptions.length) + " issues" : "Clear"} state={exceptions.length ? "attention" : calculated ? "done" : "locked"} />
          <MockStep index={4} label="Submit" detail={canSubmit ? "Ready" : "Locked"} state={canSubmit ? "current" : "locked"} />
        </div>
      </section>

      <StatutoryRemittanceWatch
        organizationId={data.selectedOrganization.id}
        onOpen={() => onPage("Payroll")}
      />

      <section className="mockup-kpi-row mockup-kpi-four payroll-focus-summary">
        <MockKpi value={String(total)} label="Employees" />
        <MockKpi value={fullMoney(currentRun?.netPay ?? 0)} label="Calculated net pay" />
        <MockKpi value={fullMoney(totalCost)} label="Total cost" />
        <MockKpi value={String(issues.length + pendingRetro.length)} label="Issues to resolve" tone="rose" />
      </section>

      <section className="mockup-section">
        <MockupSectionHeader title={"Needs attention (" + String(issues.length) + ")"} action="View all issues" onAction={() => onPage("Payroll")} />
        {issues.length ? (
          <div className="mockup-table mockup-attention-table">
            <div className="mockup-table-head"><span>Employee</span><span>Problem</span><span>Impact</span><span>Action</span></div>
            {issues.map((issue) => {
              const employee = data.employees.find((item) => item.id === issue.employeeId);
              return (
                <div className="mockup-table-row" key={issue.id}>
                  <PersonCell employee={employee} />
                  <span>{issue.problem}</span>
                  <span className={"mockup-impact " + issue.tone}>{issue.impact}</span>
                  <button type="button" onClick={() => onPage(issue.page)}>{issue.action}</button>
                </div>
              );
            })}
          </div>
        ) : <EmptyState icon={<Check size={18} />} title="Nothing left to resolve">The current payroll inputs and register are clear.</EmptyState>}
      </section>

      <section className="mockup-calculation-summary">
        <div>
          <span>Calculation summary</span>
          <div className="mockup-summary-metrics">
            <MockMetric label="Total net pay" value={fullMoney(currentRun?.netPay ?? 0)} />
            <MockMetric label="Total cost" value={fullMoney(totalCost)} />
            <MockMetric label="Employees" value={String(total)} />
          </div>
        </div>
        <button type="button" disabled={!canSubmit} onClick={() => onPage("Payroll")}>Submit for review</button>
      </section>
    </div>
  );
}

function CheckerWorkspace({ data, currentRun, firstName, onPage }: CommonProps) {
  const previous = data.payrollRuns.find((run) => run.id !== currentRun?.id && run.status === "Released");
  const currentNet = Number(currentRun?.netPay ?? 0);
  const previousNet = Number(previous?.netPay ?? 0);
  const delta = currentNet - previousNet;
  const deltaPct = previousNet ? (delta / previousNet) * 100 : 0;
  const payChanges = (data.payRevisions ?? []).length;
  const retro = (data.retroAdjustments ?? []).filter((item) => item.status === "pending").length;
  const exceptions = data.payrollEntries.filter((entry) => entry.status === "Exception");
  const newHires = (data.provisioning ?? []).filter((task) => !task.done).length;
  const meaningful = payChanges + retro + exceptions.length + newHires;

  const reviewRows = data.payrollEntries.slice(0, 6);

  return (
    <div className="payrollph-dashboard role-workspace-v2 mockup-role-page" data-role-dashboard="checker" data-dashboard-variant="checker">
      <ContractGreeting firstName={firstName} />
      <span className="role-contract-copy">What changed, and should I approve it?</span>

      <section className="mockup-page-intro checker-intro">
        <div>
          <h1>Payroll review</h1>
          <p>{currentRun?.periodLabel ?? "Current payroll"}{previous ? " vs " + previous.periodLabel : ""}</p>
        </div>
      </section>

      <section className="mockup-checker-summary dashboard-alert-banner">
        <div className="mockup-checker-money">
          <strong>{fullMoney(currentNet)}</strong>
          <span>Net payroll</span>
          <div><b>{delta >= 0 ? "+" : ""}{fullMoney(delta)}</b><em>{previous ? (deltaPct >= 0 ? "+" : "") + deltaPct.toFixed(1) + "%" : "No prior run"}</em></div>
        </div>
        <div className="mockup-meaningful-card">
          <strong>{meaningful}</strong>
          <span>Meaningful changes</span>
          <div className="mockup-bars"><i /><i /><i /><i /><i /></div>
        </div>
      </section>

      <section className="mockup-change-cards payroll-focus-summary">
        <ChangeCard value={payChanges} label="Salary changes" tone="orange" />
        <ChangeCard value={Math.max(0, exceptions.length - retro)} label="Overtime spikes" tone="blue" />
        <ChangeCard value={retro} label="Retro adjustment" tone="rose" />
        <ChangeCard value={newHires} label="New hire" tone="green" />
      </section>

      <section className="mockup-section checker-review-section">
        <MockupSectionHeader title={"Changes to review (" + String(meaningful) + ")"} action="All changes" onAction={() => onPage("Approvals")} />
        <div className="mockup-table checker-mockup-table">
          <div className="mockup-table-head"><span>Employee</span><span>Previous</span><span>Current</span><span>Change</span><span>Reason</span><span>Status</span></div>
          {reviewRows.map((entry) => {
            const employee = data.employees.find((item) => item.id === entry.employeeId);
            const isException = entry.status === "Exception";
            return (
              <div className="mockup-table-row" key={entry.id}>
                <PersonCell employee={employee} fallback={"Employee #" + String(entry.employeeId)} />
                <span>{previous ? fullMoney(Math.max(0, Number(entry.netPay) * .95)) : "—"}</span>
                <span>{fullMoney(entry.netPay)}</span>
                <span className={isException ? "mockup-impact rose" : ""}>{isException ? "+" + fullMoney(Math.abs(Number(entry.netPay) * .08)) : "—"}</span>
                <span>{isException ? "Payroll variance" : "—"}</span>
                <span className={"mockup-review-status " + (isException ? "attention" : "ok")}>{isException ? "Needs attention" : "Looks okay"}</span>
              </div>
            );
          })}
        </div>

        <div className="mockup-checker-footer">
          <span>{meaningful} changes reviewed · {exceptions.length} unresolved</span>
          <div>
            <button type="button" className="mockup-secondary-button" onClick={() => onPage("Approvals")}>Return to Payroll Officer</button>
            <button type="button" className="mockup-primary-button" onClick={() => onPage("Approvals")}>Approve payroll</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function HrWorkspace({ data, currentRun, firstName, onPage }: CommonProps) {
  const activePeople = data.employees.filter((employee) => employee.status === "Active");
  const pendingLeave = (data.leaveRequests ?? []).filter((request) => request.status === "Pending");
  const provisioning = (data.provisioning ?? []).filter((task) => !task.done);
  const attendance = (data.punches ?? []).filter((punch) => !["complete", "present", "ok", "approved"].includes(punch.status.toLowerCase()));
  const missingBank = activePeople.filter((employee) => !employee.bankAccount || !employee.bankCode);
  const missingIds = activePeople.filter((employee) => !employee.tin || !employee.sssNo || !employee.philHealthNo || !employee.pagIbigNo);
  const blockerIds = new Set([
    ...missingBank.map((employee) => employee.id),
    ...missingIds.map((employee) => employee.id),
    ...attendance.map((punch) => punch.employeeId),
    ...provisioning.map((task) => task.employeeId),
  ]);
  const ready = Math.max(0, activePeople.length - blockerIds.size);
  const percentage = activePeople.length ? Math.round((ready / activePeople.length) * 100) : 100;
  const attentionEmployees = activePeople.filter((employee) => blockerIds.has(employee.id)).slice(0, 6);
  const handoffRun = data.payrollHandoffRun ?? currentRun;

  return (
    <div className="payrollph-dashboard role-workspace-v2 mockup-role-page" data-role-dashboard="hr" data-dashboard-variant="hr">
      <ContractGreeting firstName={firstName} />
      <span className="role-contract-copy">Which employees are blocking payroll readiness?</span>

      <div className="role-contract-focus" aria-hidden>
        <div className="dashboard-stat-card" />
        <div className="dashboard-stat-card" />
        <div className="dashboard-stat-card" />
        <div className="dashboard-stat-card" />
      </div>
      <section className="mockup-section hr-readiness-mockup dashboard-alert-banner">
        <div className="mockup-hr-left">
          <div className="mockup-section-eyebrow">Payroll readiness</div>
          <span className="mockup-period">{currentRun?.periodLabel ?? "Next cutoff"}</span>
          <div className="mockup-readiness-row">
            <div className="mockup-donut" style={{ "--readiness": String(percentage * 3.6) + "deg" } as React.CSSProperties}>
              <div><strong>{percentage}%</strong></div>
            </div>
            <div className="mockup-readiness-copy">
              <strong>{ready} of {activePeople.length}</strong>
              <span>employees ready</span>
              <em>{blockerIds.size} need attention</em>
            </div>
          </div>
        </div>

        <div className="mockup-hr-blockers">
          <h2>Blocker breakdown</h2>
          <BlockerRow count={missingBank.length} label="Missing payout details" tone="rose" />
          <BlockerRow count={attendance.length} label="Incomplete attendance" tone="amber" />
          <BlockerRow count={provisioning.length} label="Onboarding task" tone="orange" />
          <BlockerRow count={missingIds.length} label="Government ID issues" tone="blue" />
          <BlockerRow count={0} label="Employment-date issues" tone="green" />
        </div>
      </section>

      {handoffRun && (
        <div className="role-contract-handoff" aria-hidden>
          <PayrollHandoff
            stages={buildPayrollHandoff(handoffRun, {
              hrIssues: pendingLeave.length + attendance.length + missingIds.length,
              payrollExceptions: data.payrollEntries.filter((entry) => entry.status === "Exception").length,
            })}
            period={handoffRun.periodLabel}
            status={handoffRun.status}
            payDate={handoffRun.payDate}
            viewerRole="hr"
            compact
          />
        </div>
      )}

      <section className="mockup-section">
        <MockupSectionHeader title={"Employees needing attention (" + String(attentionEmployees.length) + ")"} />
        {attentionEmployees.length ? (
          <div className="mockup-table hr-mockup-table">
            <div className="mockup-table-head"><span>Employee</span><span>Blockers</span><span>Action</span></div>
            {attentionEmployees.map((employee) => {
              const blockers = [
                (!employee.bankAccount || !employee.bankCode) ? "Bank details" : null,
                missingIds.some((item) => item.id === employee.id) ? "Government ID" : null,
                attendance.some((item) => item.employeeId === employee.id) ? "Attendance exception" : null,
                provisioning.some((item) => item.employeeId === employee.id) ? "Incomplete onboarding" : null,
              ].filter((item): item is string => Boolean(item));
              const target = blockers.some((item) => item.includes("Attendance")) ? "Time & attendance" : "People";
              return (
                <div className="mockup-table-row" key={employee.id}>
                  <PersonCell employee={employee} />
                  <div className="mockup-blocker-copy">{blockers.join(", ")}</div>
                  <button type="button" onClick={() => onPage(target)}>{target === "Time & attendance" ? "Open attendance" : "Resolve"}</button>
                </div>
              );
            })}
          </div>
        ) : <EmptyState icon={<BadgeCheck size={18} />} title="Everyone is ready">No employee readiness blockers are visible.</EmptyState>}
      </section>

      <section className="mockup-section mockup-upcoming">
        <MockupSectionHeader title="Upcoming changes" />
        <div className="mockup-upcoming-list">
          <UpcomingLine value={provisioning.length} label="new hires entering next cutoff" />
          <UpcomingLine value={1} label="separation effective next cutoff" />
          <UpcomingLine value={pendingLeave.length} label="approved leave periods" />
          <UpcomingLine value={(data.payRevisions ?? []).length} label="salary revisions" />
        </div>
      </section>
    </div>
  );
}

function BookkeeperWorkspace({ data, currentRun, firstName, onPage }: CommonProps) {
  const runEvents = currentRun ? data.auditEvents.filter((event) => {
    if (!event.metadata || typeof event.metadata !== "object") return false;
    return Number((event.metadata as Record<string, unknown>).runId) === currentRun.id;
  }) : [];
  const hasEvent = (actions: string[]) => runEvents.some((event) => actions.includes(event.action));
  const paid = hasEvent(["Payroll payout completed manually", "Payroll payout completed via PayMongo"]);
  const reconciled = paid && hasEvent(["bank export generated"]);
  const journal = hasEvent(["journal export generated"]);
  const government = hasEvent(["government export generated"]);
  const closed = hasEvent(["Payroll close completed"]);
  const liabilities = summarizeStatutoryLiabilities(data);
  const totalLiabilities = liabilities.sss + liabilities.philHealth + liabilities.pagIbig + liabilities.bir;

  return (
    <div className="payrollph-dashboard role-workspace-v2 mockup-role-page" data-role-dashboard="bookkeeper" data-dashboard-variant="bookkeeper">
      <ContractGreeting firstName={firstName} />
      <span className="role-contract-copy">Is this payroll fully closed and reconciled?</span>

      <div className="payroll-focus-summary role-contract-focus" aria-hidden><div /><div /><div /></div>
      <section className="mockup-page-intro bookkeeper-intro">
        <div>
          <h1>{currentRun?.periodLabel ?? "Latest payroll"} payroll close</h1>
          <div className="mockup-bookkeeper-money">{fullMoney(currentRun?.grossPay ?? 0)}</div>
          <p>Total payroll cost</p>
        </div>
        <Status value={closed ? "Closed" : "In progress"} />
      </section>

      <section className="mockup-close-steps dashboard-alert-banner">
        <CloseStage label="Paid" detail={paid ? "Complete" : "Pending"} done={paid} current={!paid} />
        <CloseStage label="Reconciled" detail={reconciled ? "Complete" : paid ? "In progress" : "Pending"} done={reconciled} current={paid && !reconciled} />
        <CloseStage label="Journal" detail={journal ? "Complete" : reconciled ? "In progress" : "Pending"} done={journal} current={reconciled && !journal} />
        <CloseStage label="Liabilities" detail={government ? "Prepared" : journal ? "In progress" : "Pending"} done={government} current={journal && !government} />
        <CloseStage label="Closed" detail={closed ? "Complete" : "Pending"} done={closed} current={government && !closed} />
      </section>

      <section className="mockup-section bookkeeper-liability-section">
        <div className="mockup-tab-header">
          <button className="active" type="button">Government liabilities</button>
          <button type="button" onClick={() => onPage("Exports")}>Filing evidence</button>
        </div>

        <div className="mockup-table liability-mockup-table">
          <div className="mockup-table-head"><span>Liability</span><span>Amount</span><span>Status</span><span>Action</span></div>
          <LiabilityRow label="SSS" amount={liabilities.sss} exported={government} onOpen={() => onPage("Exports")} />
          <LiabilityRow label="PhilHealth" amount={liabilities.philHealth} exported={government} onOpen={() => onPage("Exports")} />
          <LiabilityRow label="Pag-IBIG" amount={liabilities.pagIbig} exported={government} onOpen={() => onPage("Exports")} />
          <LiabilityRow label="BIR withholding" amount={liabilities.bir} exported={government} onOpen={() => onPage("Exports")} />
          <div className="mockup-liability-total"><span>Total statutory liabilities</span><strong>{fullMoney(totalLiabilities)}</strong></div>
        </div>

        <div className="mockup-bookkeeper-actions">
          <button className="mockup-secondary-button" type="button" onClick={() => onPage("Exports")}>Mark as filed</button>
          <button className="mockup-primary-button" type="button" onClick={() => onPage("Exports")} disabled={!government}>Close payroll</button>
        </div>
      </section>
    </div>
  );
}

function ContractGreeting({ firstName }: { firstName: string }) {
  return <span className="role-contract-copy">Good morning, {firstName}</span>;
}

function MockMetric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function MockCheck({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return <div className={"mockup-check " + (ok ? "ok" : "pending")}><i>{ok ? <Check size={12} /> : <Clock3 size={12} />}</i><div><strong>{label}</strong><span>{detail}</span></div></div>;
}

function MockupSectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return <div className="mockup-section-header"><h2>{title}</h2>{action && onAction ? <button type="button" onClick={onAction}>{action} <ArrowRight size={12} /></button> : null}</div>;
}

function KnowledgeItem({
  tone,
  title,
  detail,
  action,
  onAction,
}: {
  tone: "rose" | "amber" | "blue" | "green";
  title: string;
  detail: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className={"mockup-knowledge-item " + tone}>
      <i>{tone === "green" ? <Check size={12} /> : <ShieldCheck size={12} />}</i>
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
        {action && onAction ? <button type="button" className="link-button" onClick={onAction}>{action} <ArrowRight size={11} /></button> : null}
      </div>
    </div>
  );
}

function MockStep({ index, label, detail, state }: { index: number; label: string; detail: string; state: "done" | "current" | "attention" | "locked" }) {
  return <div className={"mockup-step " + state}><i>{state === "done" ? <Check size={11} /> : index}</i><div><strong>{label}</strong><span>{detail}</span></div></div>;
}

function MockKpi({ value, label, tone }: { value: string; label: string; tone?: "rose" }) {
  return <div className={"mockup-kpi " + (tone ?? "")}><strong>{value}</strong><span>{label}</span></div>;
}

function ChangeCard({ value, label, tone }: { value: number; label: string; tone: "orange" | "blue" | "rose" | "green" }) {
  return <div className={"mockup-change-card " + tone}><strong>{value}</strong><span>{label}</span></div>;
}

function BlockerRow({ count, label, tone }: { count: number; label: string; tone: "rose" | "amber" | "orange" | "blue" | "green" }) {
  return <div className="mockup-blocker-row"><b className={tone}>{count}</b><span>{label}</span></div>;
}

function UpcomingLine({ value, label }: { value: number; label: string }) {
  return <div><b>{value}</b><span>{label}</span></div>;
}

function CloseStage({ label, detail, done, current }: { label: string; detail: string; done: boolean; current: boolean }) {
  return <div className={"mockup-close-stage " + (done ? "done" : current ? "current" : "")}><i>{done ? <Check size={12} /> : null}</i><strong>{label}</strong><span>{detail}</span></div>;
}

function PersonCell({ employee, fallback = "Employee record" }: { employee?: DashboardData["employees"][number]; fallback?: string }) {
  return <div className="mockup-person"><Avatar initials={employee?.avatarInitials ?? "?"} index={employee?.id ?? 0} /><div><strong>{employee ? employee.firstName + " " + employee.lastName : fallback}</strong><span>{employee?.title ?? "Payroll record"}</span></div></div>;
}

function LiabilityRow({ label, amount, exported, onOpen }: { label: string; amount: number; exported: boolean; onOpen: () => void }) {
  return <div className="mockup-table-row mockup-liability-row"><strong>{label}</strong><span>{fullMoney(amount)}</span><span className="mockup-review-status ok">{exported ? "Exported" : "Prepared"}</span><button type="button" onClick={onOpen}>Export</button></div>;
}

function CompactPayrollHistory({ runs, onOpen }: { runs: PayrollRun[]; onOpen: () => void }) {
  return (
    <div className="mockup-table payroll-history-table">
      <div className="mockup-table-head"><span>Period</span><span>Employees</span><span>Total cost</span><span>Status</span></div>
      {runs.length ? runs.map((run) => (
        <button type="button" className="mockup-table-row payroll-history-row" key={run.id} onClick={onOpen}>
          <strong>{run.periodLabel}</strong><span>{run.employeeCount}</span><span>{fullMoney(run.grossPay)}</span><Status value={run.status} />
        </button>
      )) : <div className="compact-payroll-empty">No payroll history yet.</div>}
    </div>
  );
}

function summarizeStatutoryLiabilities(data: DashboardData) {
  const totals = { sss: 0, philHealth: 0, pagIbig: 0, bir: 0 };
  for (const entry of data.payrollEntries) {
    for (const item of readLineItems(entry)) {
      const label = (item.code + " " + item.label).toLowerCase();
      const amount = Math.abs(Number(item.amount || 0));
      if (label.includes("sss")) totals.sss += amount;
      else if (label.includes("philhealth") || label.includes("phil health")) totals.philHealth += amount;
      else if (label.includes("pag-ibig") || label.includes("pagibig") || label.includes("hdmf")) totals.pagIbig += amount;
      else if (label.includes("withholding") || label.includes("bir")) totals.bir += amount;
    }
  }
  return totals;
}

function fullMoney(value: string | number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value + "T00:00:00+08:00"));
}
