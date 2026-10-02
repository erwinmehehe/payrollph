export type OperationsAttentionSeverity = "critical" | "warning" | "info";

export type OperationsAttentionAction =
  | { kind: "page"; page: string; label: string }
  | { kind: "outbox"; label: string };

export type OperationsAttentionItem = {
  key: string;
  severity: OperationsAttentionSeverity;
  count: number;
  title: string;
  detail: string;
  action: OperationsAttentionAction;
};

export type OperationsAttention = {
  critical: number;
  warning: number;
  info: number;
  total: number;
  items: OperationsAttentionItem[];
};

export type OperationsAttentionInput = {
  role: string;
  missingBankDetails: number;
  missingGovernmentIds: number;
  pendingApprovals: number;
  payrollExceptions: number;
  failedPayrollJobs: number;
  emailFailures: number;
  emailDeliveryIssues: number;
  webhookRetrying: number;
  webhookExhausted: number;
  payoutFailed: number;
  payoutPending: number;
  payoutRegressed: boolean;
};

function plural(count: number, one: string, many = `${one}s`) {
  return count === 1 ? one : many;
}

export function buildOperationsAttention(input: OperationsAttentionInput): OperationsAttention {
  const items: OperationsAttentionItem[] = [];
  const canSeePeople = ["owner", "admin", "bookkeeper", "hr"].includes(input.role);
  const canSeePayroll = ["owner", "admin", "bookkeeper", "payroll"].includes(input.role);
  const canSeeApprovals = ["owner", "admin", "bookkeeper", "hr", "manager", "checker"].includes(input.role);
  const canSeeDelivery = ["owner", "admin", "bookkeeper"].includes(input.role);
  const canSeeDeveloper = ["owner", "admin", "bookkeeper"].includes(input.role);
  const canSeePayout = input.role === "owner";

  if (canSeePayroll && input.failedPayrollJobs > 0) {
    items.push({
      key: "payroll-jobs-failed",
      severity: "critical",
      count: input.failedPayrollJobs,
      title: `${input.failedPayrollJobs} payroll ${plural(input.failedPayrollJobs, "job")} failed`,
      detail: "Calculation work stopped before the run completed. Review the failed job and retry the payroll calculation.",
      action: { kind: "page", page: "Payroll", label: "Recover payroll" },
    });
  }

  if (canSeePayout && (input.payoutRegressed || input.payoutFailed > 0)) {
    const count = Math.max(input.payoutFailed, input.payoutRegressed ? 1 : 0);
    items.push({
      key: "payout-failed",
      severity: "critical",
      count,
      title: input.payoutRegressed
        ? "A completed payout changed to a failed state"
        : `${input.payoutFailed} payout ${plural(input.payoutFailed, "transfer")} failed`,
      detail: input.payoutRegressed
        ? "Provider state changed after settlement. Reconcile the payroll before retrying any transfer."
        : "Retry failed transfers only. Pending and successful transfers must not be sent again.",
      action: { kind: "page", page: "Payroll", label: "Review payout" },
    });
  } else if (canSeePayout && input.payoutPending > 0) {
    items.push({
      key: "payout-pending",
      severity: "info",
      count: input.payoutPending,
      title: `${input.payoutPending} payout ${plural(input.payoutPending, "transfer")} still pending`,
      detail: "Refresh provider reconciliation before treating the payroll payout as complete.",
      action: { kind: "page", page: "Payroll", label: "Check payout" },
    });
  }

  if (canSeeDelivery) {
    const mailProblems = input.emailFailures + input.emailDeliveryIssues;
    if (mailProblems > 0) {
      items.push({
        key: "email-delivery",
        severity: input.emailFailures > 0 ? "critical" : "warning",
        count: mailProblems,
        title: `${mailProblems} email delivery ${plural(mailProblems, "issue")} need attention`,
        detail: "Inspect failed, bounced, suppressed or complained messages and retry only messages that are safe to resend.",
        action: { kind: "outbox", label: "Open email outbox" },
      });
    }
  }

  if (canSeeDeveloper) {
    const webhookProblems = input.webhookRetrying + input.webhookExhausted;
    if (webhookProblems > 0) {
      items.push({
        key: "webhook-delivery",
        severity: input.webhookExhausted > 0 ? "critical" : "warning",
        count: webhookProblems,
        title: `${webhookProblems} webhook ${plural(webhookProblems, "delivery", "deliveries")} need attention`,
        detail: input.webhookExhausted > 0
          ? "At least one webhook exhausted its retry budget. Inspect the endpoint before sending more events."
          : "Webhook retries are still in progress. Check the endpoint if the queue does not clear.",
        action: { kind: "page", page: "Developer", label: "Open developer tools" },
      });
    }
  }

  if (canSeePayroll && input.payrollExceptions > 0) {
    items.push({
      key: "payroll-exceptions",
      severity: "warning",
      count: input.payrollExceptions,
      title: `${input.payrollExceptions} payroll ${plural(input.payrollExceptions, "exception")} need review`,
      detail: "Resolve or explicitly sign off exceptions before the run moves to release.",
      action: { kind: "page", page: "Payroll", label: "Review exceptions" },
    });
  }

  if (canSeePeople && input.missingBankDetails > 0) {
    items.push({
      key: "missing-bank-details",
      severity: "warning",
      count: input.missingBankDetails,
      title: `${input.missingBankDetails} active ${plural(input.missingBankDetails, "employee")} missing payout details`,
      detail: "Complete bank code and account details before generating a final payout file.",
      action: { kind: "page", page: "People", label: "Fix employee records" },
    });
  }

  if (canSeePeople && input.missingGovernmentIds > 0) {
    items.push({
      key: "missing-government-ids",
      severity: "warning",
      count: input.missingGovernmentIds,
      title: `${input.missingGovernmentIds} active ${plural(input.missingGovernmentIds, "employee")} missing filing IDs`,
      detail: "TIN, SSS, PhilHealth and Pag-IBIG identifiers should be complete before statutory filing exports are treated as final.",
      action: { kind: "page", page: "People", label: "Complete filing IDs" },
    });
  }

  if (canSeeApprovals && input.pendingApprovals > 0) {
    items.push({
      key: "pending-approvals",
      severity: "info",
      count: input.pendingApprovals,
      title: `${input.pendingApprovals} approval ${plural(input.pendingApprovals, "item")} waiting`,
      detail: "Pending decisions can block payroll handoff or release.",
      action: { kind: "page", page: "Approvals", label: "Open approvals" },
    });
  }

  const rank: Record<OperationsAttentionSeverity, number> = { critical: 0, warning: 1, info: 2 };
  items.sort((a, b) => rank[a.severity] - rank[b.severity] || b.count - a.count || a.key.localeCompare(b.key));

  return {
    critical: items.filter((item) => item.severity === "critical").length,
    warning: items.filter((item) => item.severity === "warning").length,
    info: items.filter((item) => item.severity === "info").length,
    total: items.length,
    items,
  };
}
