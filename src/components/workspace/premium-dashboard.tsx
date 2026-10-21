"use client";

import { useSyncExternalStore } from "react";
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileText,
  ShieldCheck,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { dashboardDate, dashboardMoney } from "@/lib/dashboard-presentation";
import { buildPremiumDashboardModel } from "@/lib/premium-dashboard-model";
import { derivePayrollPayoutState } from "@/lib/payroll-payout-state";
import type { DashboardData, PayrollRun } from "./types";
import { relativeTime } from "./ui";

type Props = {
  data: DashboardData;
  currentRun?: PayrollRun;
  role: "owner" | "payroll";
  onPage: (page: string) => void;
  onNewRun: () => void;
};

const WORKFLOW_STAGES = [
  { label: "Prepare", detail: "Calculate payroll" },
  { label: "Review", detail: "Check exceptions" },
  { label: "Approve", detail: "Independent approval" },
  { label: "Release", detail: "Lock and publish" },
  { label: "Bank payout", detail: "Submit funds separately" },
] as const;

// useSyncExternalStore renders the stable server date during SSR and hydration,
// then reads the client snapshot for relative timestamps without an effect write.
const subscribeHydration = () => () => {};
const browserHydrated = () => true;
const serverHydrated = () => false;

/**
 * An overview of actual stored workspace data, not a transaction screen.
 * All irreversible payroll actions remain inside the existing guarded flows.
 */
export function PremiumDashboard({ data, currentRun: run, role, onPage, onNewRun }: Props) {
  // Relative timestamps depend on wall time and can cross minute boundaries between SSR and hydration.
  // Render a stable UTC date until the browser has hydrated, then show relative time.
  const clientTimeReady = useSyncExternalStore(subscribeHydration, browserHydrated, serverHydrated);
  const view = buildPremiumDashboardModel(data, run);
  const firstName = data.user?.name?.trim().split(/\s+/)[0] || "there";
  const released = run?.status === "Released";
  const payout = run ? derivePayrollPayoutState(data.auditEvents, run.id) : null;
  const payoutCompleted = released && payout?.payout.status === "completed";

  const currentStage =
    !run ? 0
    : payoutCompleted ? 5
    : released ? 4
    : run.status === "Ready for release" ? 3
    : run.status === "Pending approval" ? 2
    : view.calculated ? 1
    : 0;

  const actionText =
    !run ? "Create payroll"
    : released ? "View payout status"
    : role === "owner" && run.status === "Ready for release" ? "Review release checks"
    : run.status === "Pending approval" ? "Track payroll approval"
    : view.calculated ? "Review payroll"
    : "Continue payroll";

  const openPayroll = () => {
    if (run) onPage("Payroll");
    else onNewRun();
  };

  const activity = [...data.auditEvents]
    .sort((a, b) => {
      const left = new Date(a.createdAt).getTime();
      const right = new Date(b.createdAt).getTime();
      return (Number.isFinite(right - left) ? right - left : 0) || b.id - a.id;
    })
    .slice(0, 4);
  const issueCount = view.issues.length;

  return (
    <section className="premium-dashboard" data-role-dashboard={role} aria-label="Workspace dashboard">
      <header className="pd-page-heading">
        <div>
          <p className="pd-eyebrow">{data.selectedOrganization.name} · {role === "owner" ? "Owner" : "Payroll officer"} workspace</p>
          <h1>Welcome back, {firstName}.</h1>
          <p className="pd-intro">Here is what needs your attention before the next payday.</p>
        </div>
      </header>

      <div className="pd-content-grid">
        <div className="pd-main-column">
          <section className="pd-hero" aria-label="Current payroll">
            <div className="pd-hero-topline">
              <span>UP NEXT</span>
              {issueCount > 0 ? (
                <span className="pd-issue-count"><AlertCircle size={15} /> {issueCount} item {issueCount === 1 ? "category" : "categories"} to review</span>
              ) : (
                <span className="pd-quiet-pill"><Check size={15} /> No issues detected in overview</span>
              )}
            </div>
            <div className="pd-hero-content">
              <div className="pd-run-heading">
                <div className="pd-run-symbol" aria-hidden><WalletCards size={25} /></div>
                <div className="pd-run-title">
                  <h2>{run ? run.periodLabel : "Your next payroll"}</h2>
                  <div className="pd-run-status-line">
                    {view.preliminary && <span className="pd-tag preliminary">Preliminary calculation</span>}
                    <span className="pd-tag state">{run?.status ?? "Not started"}</span>
                  </div>
                  <p>{run ? run.scopeLabel + " · Scheduled payday " + dashboardDate(run.payDate) : "Create a run to see the payroll period and schedule."}</p>
                </div>
              </div>

              <div className="pd-figures">
                <div className="pd-figure">
                  <span>Employees in run</span>
                  <strong>{view.payrollEmployeeCount ?? "—"}</strong>
                </div>
                <div className="pd-figure">
                  <span>Gross payroll</span>
                  <strong>{dashboardMoney(view.gross)}</strong>
                </div>
                <div className="pd-figure">
                  <span>{view.preliminary ? "Estimated net payouts" : "Net employee payouts"}</span>
                  <strong>{dashboardMoney(view.net)}</strong>
                </div>
                <div className="pd-figure">
                  <span>{view.preliminary ? "Estimated total cost" : "Total payroll cost"}</span>
                  <strong>{dashboardMoney(view.totalCost)}</strong>
                  {!view.employerCostComplete && <small>Awaiting complete employer-cost trace</small>}
                </div>
              </div>

              <ol className="pd-progress" aria-label="Payroll workflow">
                {WORKFLOW_STAGES.map((stage, index) => {
                  const state = index < currentStage ? "done" : index === currentStage ? "current" : "upcoming";
                  return (
                    <li className={"pd-step " + state} key={stage.label} aria-current={index === currentStage ? "step" : undefined}>
                      <span className="pd-step-dot" aria-hidden>{state === "done" ? <Check size={15} /> : index + 1}</span>
                      <div>
                        <strong>{stage.label}</strong>
                        <small>{stage.detail}</small>
                      </div>
                    </li>
                  );
                })}
              </ol>

              {view.preliminary && (
                <div className="pd-preliminary-note" role="status">
                  <Clock3 size={17} />
                  <p>The pay period is still open. Confirm attendance and recalculate after the cutoff before requesting final approval.</p>
                </div>
              )}
              {released && (
                <div className="pd-release-note" role="status">
                  <ShieldCheck size={18} />
                  <p><strong>Payroll is released, but this does not confirm payment.</strong> {payout?.payout.label ?? "Open Payroll to verify the separate bank payout."}</p>
                </div>
              )}
              <div className="pd-hero-actions">
                <button className="pd-primary-action" type="button" onClick={openPayroll}>
                  {actionText} <ArrowRight size={18} />
                </button>
                {run && <button className="pd-secondary-action" type="button" onClick={() => onPage("Payroll")}>View payroll details</button>}
              </div>
              <p className="pd-hero-footnote">Figures are based on stored payroll data. Final release eligibility is checked inside Payroll. Employer costs are shown only when complete traces are available.</p>
            </div>
          </section>

          <section className="pd-card pd-task-panel" aria-labelledby="pd-tasks">
            <div className="pd-card-header">
              <div>
                <p className="pd-section-overline">TO TAKE CARE OF</p>
                <h2 id="pd-tasks">Your next actions</h2>
              </div>
              <span className="pd-small-count">{issueCount} categories</span>
            </div>
            {view.issues.length ? (
              <div className="pd-action-list">
                {view.issues.map((issue) => (
                  <button className="pd-action-item" key={issue.id} type="button" onClick={() => onPage(issue.page)}>
                    <span className={"pd-action-icon " + issue.tone} aria-hidden><AlertCircle size={18} /></span>
                    <span className="pd-action-copy">
                      <strong>{issue.title}</strong>
                      <small>{issue.description}</small>
                    </span>
                    <span className="pd-action-link">Review <ChevronRight size={17} /></span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="pd-empty">
                <Check size={20} />
                <div><strong>No immediate record or calculation issues shown.</strong><p>Payroll assurance and release checks are performed separately inside Payroll.</p></div>
              </div>
            )}
            <div className="pd-card-footer"><span>Record checks are not release authorization.</span><button type="button" onClick={() => onPage("Payroll")}>Open payroll controls <ArrowRight size={15} /></button></div>
          </section>

          <section className="pd-card pd-activity" aria-labelledby="pd-activity-title">
            <div className="pd-card-header">
              <div><p className="pd-section-overline">RECENTLY</p><h2 id="pd-activity-title">Recent activity</h2></div>
              <button type="button" className="pd-text-link" onClick={() => onPage("Audit trail")}>Audit trail <ArrowRight size={15} /></button>
            </div>
            {activity.length ? (
              <ul className="pd-activity-list">
                {activity.map((event) => (
                  <li key={event.id}>
                    <span className="pd-activity-dot" aria-hidden />
                    <div><strong>{event.action}</strong><small>{event.actor || "System"}</small></div>
                    <time dateTime={new Date(event.createdAt).toISOString()}>{clientTimeReady ? relativeTime(event.createdAt) : new Date(event.createdAt).toISOString().slice(0, 10)}</time>
                  </li>
                ))}
              </ul>
            ) : <p className="pd-muted-empty">No recorded activity is available yet.</p>}
          </section>
        </div>

        <aside className="pd-side-column" aria-label="Workspace overview">
          <section className="pd-card pd-side-summary" aria-labelledby="pd-overview-title">
            <div className="pd-card-header">
              <div><p className="pd-section-overline">AT A GLANCE</p><h2 id="pd-overview-title">Your workspace</h2></div>
            </div>
            <div className="pd-summary-line">
              <span className="pd-summary-icon people" aria-hidden><UsersRound size={18} /></span>
              <div><strong>{view.activeCount} active employees</strong><small>{view.totalCount} employee records in this workspace</small></div>
              <button type="button" aria-label="Open employees" onClick={() => onPage("People")}><ChevronRight size={18} /></button>
            </div>
            <div className="pd-summary-line">
              <span className="pd-summary-icon approvals" aria-hidden><ClipboardCheck size={18} /></span>
              <div><strong>{view.pendingApprovals} pending approvals</strong><small>Workspace-wide queue, not necessarily assigned to you</small></div>
              <button type="button" aria-label="Open approvals" onClick={() => onPage("Approvals")}><ChevronRight size={18} /></button>
            </div>
            {role === "owner" ? (
              <div className="pd-summary-line">
                <span className="pd-summary-icon leave" aria-hidden><CalendarDays size={18} /></span>
                <div><strong>{view.pendingLeave} pending leave requests</strong><small>Requests awaiting a recorded decision</small></div>
                <button type="button" aria-label="Open leave requests" onClick={() => onPage("Leave")}><ChevronRight size={18} /></button>
              </div>
            ) : (
              <div className="pd-summary-line">
                <span className="pd-summary-icon leave" aria-hidden><Clock3 size={18} /></span>
                <div><strong>{view.attendanceEmployees} employees with time entries to review</strong><small>Within the selected payroll period</small></div>
                <button type="button" aria-label="Open time and attendance" onClick={() => onPage("Time & attendance")}><ChevronRight size={18} /></button>
              </div>
            )}
          </section>

          <section className="pd-card pd-dates" aria-labelledby="pd-dates-title">
            <div className="pd-card-header">
              <div><p className="pd-section-overline">ON THE CALENDAR</p><h2 id="pd-dates-title">Upcoming dates</h2></div>
            </div>
            {view.scheduledDates.length ? (
              <ul>
                {view.scheduledDates.map((item) => (
                  <li key={item.key}>
                    <span className="pd-date-icon" aria-hidden><CalendarDays size={17} /></span>
                    <div><strong>{item.label}</strong><span>{dashboardDate(item.date)}</span></div>
                    <button type="button" onClick={() => onPage(item.page)} aria-label={"Open " + item.label}><ChevronRight size={17} /></button>
                  </li>
                ))}
              </ul>
            ) : <p className="pd-muted-empty">No scheduled payroll or tracked compliance dates available.</p>}
            <p className="pd-date-footnote">Displays scheduled payroll dates and recorded compliance actions only. Always verify filing requirements before submission.</p>
          </section>

          <section className="pd-shortcut-card">
            <FileText size={21} aria-hidden />
            <h2>Everything you need, in one place.</h2>
            <p>Explore reports, exports, and compliance tools without crowding your day-to-day workspace.</p>
            <button type="button" onClick={() => onPage("Analytics")}>View reports <ArrowRight size={16} /></button>
          </section>
        </aside>
      </div>
    </section>
  );
}
