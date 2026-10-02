"use client";

import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Building2,
  CheckCircle2,
  Clock3,
  MailWarning,
  RefreshCw,
  ShieldAlert,
  UserRoundCheck,
  WalletCards,
} from "lucide-react";
import type { DashboardData } from "@/components/workspace/types";
import type { Notification } from "@/components/workspace/shell";

type AttentionTone = "danger" | "warning" | "info";

type AttentionItem = {
  id: string;
  title: string;
  detail: string;
  action: string;
  page?: string;
  tone: AttentionTone;
  kind?: "retry-payroll" | "outbox";
  icon: typeof AlertTriangle;
};

export function NeedsAttentionView({
  data,
  notifications,
  availablePages,
  canRetryPayroll,
  canOpenOutbox,
  onPage,
  onRetryPayroll,
  onOpenOutbox,
}: {
  data: DashboardData;
  notifications: Notification[];
  availablePages: readonly string[];
  canRetryPayroll: boolean;
  canOpenOutbox: boolean;
  onPage: (page: string) => void;
  onRetryPayroll: (runId: number) => void;
  onOpenOutbox: () => void;
}) {
  const activeEmployees = data.employees.filter((employee) => employee.status === "Active");
  const liveRun = data.payrollRuns.find((run) => run.status !== "Released") ?? null;
  const failedJobs = (data.payrollJobs ?? []).filter((job) => job.status === "Failed").length;
  const pendingApprovals = data.tasks.filter((task) => task.status === "Pending").length;
  const missingPayout = activeEmployees.filter((employee) => !employee.bankAccount || !employee.bankCode).length;
  const missingGovernmentIds = activeEmployees.filter(
    (employee) => !employee.tin || !employee.sssNo || !employee.philHealthNo || !employee.pagIbigNo,
  ).length;
  const attendanceIssues = (data.punches ?? []).filter((punch) => {
    const status = punch.status.toLowerCase();
    return !["complete", "present", "ok", "approved"].includes(status);
  }).length;
  const failedMailNotice = notifications.find((item) => item.id === "payslip-email-delivery-failures");

  const items: AttentionItem[] = [];

  if (failedJobs > 0 && liveRun && availablePages.includes("Payroll")) {
    items.push({
      id: "failed-payroll-jobs",
      title: `${failedJobs} payroll calculation job${failedJobs === 1 ? "" : "s"} failed`,
      detail: `${liveRun.periodLabel} needs a safe recalculation before the register can move forward.`,
      action: canRetryPayroll ? "Retry calculation" : "Open payroll",
      page: "Payroll",
      tone: "danger",
      kind: canRetryPayroll ? "retry-payroll" : undefined,
      icon: RefreshCw,
    });
  }

  if ((liveRun?.exceptions ?? 0) > 0 && availablePages.includes("Payroll")) {
    items.push({
      id: "payroll-exceptions",
      title: `${liveRun!.exceptions} payroll exception${liveRun!.exceptions === 1 ? "" : "s"} need review`,
      detail: "Resolve or explicitly sign off exceptions before the run reaches release.",
      action: "Review payroll",
      page: "Payroll",
      tone: "warning",
      icon: WalletCards,
    });
  }

  if (pendingApprovals > 0 && availablePages.includes("Approvals")) {
    items.push({
      id: "pending-approvals",
      title: `${pendingApprovals} approval${pendingApprovals === 1 ? "" : "s"} waiting`,
      detail: "A maker-checker handoff or people decision is still open.",
      action: "Open approvals",
      page: "Approvals",
      tone: "warning",
      icon: UserRoundCheck,
    });
  }

  if (missingPayout > 0 && availablePages.includes("People")) {
    items.push({
      id: "missing-payout-details",
      title: `${missingPayout} employee${missingPayout === 1 ? "" : "s"} missing payout details`,
      detail: "Complete bank information before generating the final payout file.",
      action: "Fix employee records",
      page: "People",
      tone: "danger",
      icon: Building2,
    });
  }

  if (missingGovernmentIds > 0 && availablePages.includes("People")) {
    items.push({
      id: "missing-government-ids",
      title: `${missingGovernmentIds} employee${missingGovernmentIds === 1 ? "" : "s"} missing filing IDs`,
      detail: "TIN, SSS, PhilHealth and Pag-IBIG identifiers affect statutory outputs.",
      action: "Complete records",
      page: "People",
      tone: "warning",
      icon: ShieldAlert,
    });
  }

  if (attendanceIssues > 0 && availablePages.includes("Time & attendance")) {
    items.push({
      id: "attendance-issues",
      title: `${attendanceIssues} attendance issue${attendanceIssues === 1 ? "" : "s"} need context`,
      detail: "Incomplete or non-standard punches can flow into payroll exceptions.",
      action: "Review attendance",
      page: "Time & attendance",
      tone: "info",
      icon: Clock3,
    });
  }

  if (failedMailNotice) {
    items.push({
      id: "email-delivery",
      title: failedMailNotice.title,
      detail: failedMailNotice.detail,
      action: canOpenOutbox ? "Open email outbox" : "Open exports",
      page: canOpenOutbox ? undefined : "Exports",
      tone: "danger",
      kind: canOpenOutbox ? "outbox" : undefined,
      icon: MailWarning,
    });
  }

  for (const notification of notifications) {
    if (items.some((item) => item.id === notification.id)) continue;
    if (notification.page && !availablePages.includes(notification.page)) continue;
    if (items.some((item) => item.title === notification.title)) continue;
    items.push({
      id: notification.id,
      title: notification.title,
      detail: notification.detail,
      action: notification.page ? "Open " + notification.page.toLowerCase() : "Review",
      page: notification.page,
      tone: notification.tone === "danger" ? "danger" : notification.tone === "review" ? "warning" : "info",
      icon: AlertTriangle,
    });
  }

  const urgent = items.filter((item) => item.tone === "danger").length;
  const warning = items.filter((item) => item.tone === "warning").length;

  function act(item: AttentionItem) {
    if (item.kind === "retry-payroll" && liveRun) {
      onRetryPayroll(liveRun.id);
      return;
    }
    if (item.kind === "outbox") {
      onOpenOutbox();
      return;
    }
    if (item.page) onPage(item.page);
  }

  return (
    <div className="attention-center">
      <section className="attention-center-head">
        <div>
          <div className="card-kicker">OPERATIONS</div>
          <h1>Needs attention</h1>
          <p>One place for payroll blockers, people-data gaps, approvals, delivery failures and the next recovery action.</p>
        </div>
        <div className="attention-center-summary" aria-label={`${items.length} items need attention`}>
          <strong>{items.length}</strong>
          <span>{items.length === 1 ? "open item" : "open items"}</span>
        </div>
      </section>

      <section className="attention-summary-grid">
        <div><span>Critical</span><strong>{urgent}</strong><small>Blocks or risks payroll completion</small></div>
        <div><span>Review</span><strong>{warning}</strong><small>Needs an operator decision</small></div>
        <div><span>Clear</span><strong>{items.length === 0 ? "Yes" : "Not yet"}</strong><small>{items.length === 0 ? "No visible operational issues" : "Work the queue from the top"}</small></div>
      </section>

      {items.length === 0 ? (
        <section className="attention-clear-state">
          <span><CheckCircle2 size={22} /></span>
          <div>
            <h2>Nothing needs intervention right now.</h2>
            <p>The visible payroll, people, approval and delivery checks are clear for your role.</p>
          </div>
        </section>
      ) : (
        <section className="attention-queue" aria-label="Operational attention queue">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <article className={`attention-queue-item tone-${item.tone}`} key={item.id}>
                <span className="attention-queue-icon"><Icon size={17} /></span>
                <div className="attention-queue-copy">
                  <div className="attention-queue-title">
                    <strong>{item.title}</strong>
                    <span>{item.tone === "danger" ? "Critical" : item.tone === "warning" ? "Review" : "Follow up"}</span>
                  </div>
                  <p>{item.detail}</p>
                </div>
                <button className={item.tone === "danger" ? "primary-button" : "secondary-button"} onClick={() => act(item)}>
                  {item.kind === "retry-payroll" ? <RefreshCw size={14} /> : <ArrowRight size={14} />}
                  {item.action}
                </button>
              </article>
            );
          })}
        </section>
      )}

      <section className="attention-center-note">
        <BadgeCheck size={16} />
        <span>This queue is derived from the current workspace data. Actions still use the same server-side role, tenant and MFA protections as their destination workflows.</span>
      </section>
    </div>
  );
}
