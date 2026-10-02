"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Clock3,
  FileCheck2,
  MailWarning,
  RefreshCw,
  ShieldAlert,
  UsersRound,
  WalletCards,
} from "lucide-react";
import type { DashboardData, Notify } from "./types";
import { PageHeading, Status } from "./ui";

type OutboxSummary = {
  queued: number;
  pending: number;
  sent: number;
  failed: number;
  failedPayslipReady: number;
  retried: number;
  delivered: number;
  deliveryIssues: number;
};

type FilingForm = {
  agency: string;
  form: string;
  generatorVersion: string;
};

type FilingRecord = {
  agency: string;
  form: string;
  status: string;
  submissionMethod: string | null;
  generatorVersion: string;
};

type AttentionItem = {
  id: string;
  group: "Payroll" | "People" | "Delivery" | "Compliance";
  title: string;
  detail: string;
  severity: "danger" | "review" | "info";
  page?: string;
  actionLabel?: string;
};

function countLabel(count: number, singular: string, plural = singular + "s") {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function OperationsView({
  data,
  onPage,
  onOpenOutbox,
  notify,
}: {
  data: DashboardData;
  onPage: (page: string) => void;
  onOpenOutbox: () => void;
  notify: Notify;
}) {
  const organizationId = data.selectedOrganization.id;
  const [outbox, setOutbox] = useState<OutboxSummary | null>(null);
  const [filingGapCount, setFilingGapCount] = useState<number | null>(null);
  const [loadingExternal, setLoadingExternal] = useState(true);
  const [retryingPayslips, setRetryingPayslips] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadOperationalSignals() {
      setLoadingExternal(true);
      const [outboxResponse, filingResponse] = await Promise.all([
        fetch(`/api/outbox?organizationId=${organizationId}`, { cache: "no-store" }),
        fetch(`/api/compliance/filing-validations?organizationId=${organizationId}`, { cache: "no-store" }),
      ]);

      if (!cancelled) {
        if (outboxResponse.ok) {
          const payload = await outboxResponse.json().catch(() => ({}));
          setOutbox((payload.summary ?? null) as OutboxSummary | null);
        } else {
          setOutbox(null);
        }

        if (filingResponse.ok) {
          const payload = await filingResponse.json().catch(() => ({})) as {
            forms?: FilingForm[];
            records?: FilingRecord[];
          };
          const forms = payload.forms ?? [];
          const records = payload.records ?? [];
          const gaps = forms.filter((form) =>
            !records.some((record) =>
              record.agency === form.agency
              && record.form === form.form
              && record.status === "accepted"
              && record.submissionMethod === "file_upload"
              && record.generatorVersion === form.generatorVersion,
            ),
          ).length;
          setFilingGapCount(gaps);
        } else {
          setFilingGapCount(null);
        }
        setLoadingExternal(false);
      }
    }

    void loadOperationalSignals().catch(() => {
      if (!cancelled) {
        setOutbox(null);
        setFilingGapCount(null);
        setLoadingExternal(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const signals = useMemo(() => {
    const activeEmployees = data.employees.filter((employee) => employee.status === "Active");
    const missingBank = activeEmployees.filter((employee) => !employee.bankAccount || !employee.bankCode).length;
    const missingGovernmentIds = activeEmployees.filter(
      (employee) => !employee.tin || !employee.sssNo || !employee.philHealthNo || !employee.pagIbigNo,
    ).length;
    const failedJobs = (data.payrollJobs ?? []).filter((job) => job.status === "Failed").length;
    const currentRun = data.payrollRuns.find((run) => run.status !== "Released") ?? data.payrollRuns[0] ?? null;
    const payrollExceptions = currentRun?.exceptions ?? 0;
    const pendingApprovals = data.tasks.filter((task) => task.status === "Pending").length;
    const attendanceIssues = (data.punches ?? []).filter((punch) => {
      const status = punch.status.toLowerCase();
      return !["complete", "present", "ok", "approved"].includes(status);
    }).length;
    const leavePolicyGaps = (data.leavePolicies ?? []).filter(
      (policy) => policy.active && policy.payTreatment === "unconfigured",
    ).length;

    return {
      missingBank,
      missingGovernmentIds,
      failedJobs,
      currentRun,
      payrollExceptions,
      pendingApprovals,
      attendanceIssues,
      leavePolicyGaps,
    };
  }, [data]);

  const items = useMemo<AttentionItem[]>(() => {
    const rows: AttentionItem[] = [];

    if (signals.failedJobs > 0) {
      rows.push({
        id: "payroll-jobs",
        group: "Payroll",
        title: countLabel(signals.failedJobs, "payroll calculation failed"),
        detail: "The failed job is recoverable. Open Payroll, review the failure state, and retry the calculation instead of creating a duplicate run.",
        severity: "danger",
        page: "Payroll",
        actionLabel: "Recover payroll",
      });
    }
    if (signals.payrollExceptions > 0) {
      rows.push({
        id: "payroll-exceptions",
        group: "Payroll",
        title: countLabel(signals.payrollExceptions, "payroll exception"),
        detail: `${signals.currentRun?.periodLabel ?? "The current run"} still has exception flags that should be understood before checker review or release.`,
        severity: "review",
        page: "Payroll",
        actionLabel: "Review exceptions",
      });
    }
    if (signals.pendingApprovals > 0) {
      rows.push({
        id: "approvals",
        group: "Payroll",
        title: countLabel(signals.pendingApprovals, "approval decision") + " waiting",
        detail: "Maker-checker work is still open. Clear the approval queue before treating the payroll handoff as complete.",
        severity: "review",
        page: "Approvals",
        actionLabel: "Open approvals",
      });
    }
    if (signals.missingBank > 0) {
      rows.push({
        id: "missing-bank",
        group: "People",
        title: countLabel(signals.missingBank, "active employee") + " missing payout details",
        detail: "Bank account or bank code is incomplete. Payroll should not move to payout until these records are complete.",
        severity: "danger",
        page: "People",
        actionLabel: "Fix employee data",
      });
    }
    if (signals.missingGovernmentIds > 0) {
      rows.push({
        id: "missing-ids",
        group: "People",
        title: countLabel(signals.missingGovernmentIds, "active employee") + " missing filing IDs",
        detail: "TIN, SSS, PhilHealth or Pag-IBIG identifiers are incomplete and can block government exports.",
        severity: "review",
        page: "People",
        actionLabel: "Complete IDs",
      });
    }
    if (signals.attendanceIssues > 0) {
      rows.push({
        id: "attendance",
        group: "People",
        title: countLabel(signals.attendanceIssues, "attendance record") + " needs context",
        detail: "Incomplete or non-standard attendance can change hours and pay. Resolve it before recalculating payroll.",
        severity: "review",
        page: "Time & attendance",
        actionLabel: "Review attendance",
      });
    }
    if (signals.leavePolicyGaps > 0) {
      rows.push({
        id: "leave-policy",
        group: "People",
        title: countLabel(signals.leavePolicyGaps, "leave policy") + " missing payroll treatment",
        detail: "Linaw should not guess whether this leave is paid, unpaid, or partially paid.",
        severity: "review",
        page: "Leave",
        actionLabel: "Configure leave",
      });
    }

    const deliveryProblems = (outbox?.failed ?? 0) + (outbox?.deliveryIssues ?? 0);
    if (deliveryProblems > 0) {
      rows.push({
        id: "delivery",
        group: "Delivery",
        title: countLabel(deliveryProblems, "email delivery issue"),
        detail: "Failed sends, bounces, complaints or suppressed deliveries need review. Retry only the messages that are safe to resend.",
        severity: "danger",
        actionLabel: "Open email outbox",
      });
    } else if ((outbox?.queued ?? 0) + (outbox?.pending ?? 0) > 0) {
      rows.push({
        id: "delivery-queue",
        group: "Delivery",
        title: countLabel((outbox?.queued ?? 0) + (outbox?.pending ?? 0), "email") + " still queued",
        detail: "These messages have not reached a final delivery state yet. Check the outbox before assuming employees were notified.",
        severity: "info",
        actionLabel: "Open email outbox",
      });
    }

    if (filingGapCount != null && filingGapCount > 0) {
      rows.push({
        id: "filing-evidence",
        group: "Compliance",
        title: countLabel(filingGapCount, "government file format") + " still unproven",
        detail: "A generated worksheet is not proof of agency acceptance. Record a real file-upload acceptance for each current layout.",
        severity: "review",
        page: "Exports",
        actionLabel: "Open filing evidence",
      });
    }

    return rows;
  }, [signals, outbox, filingGapCount]);

  const criticalCount = items.filter((item) => item.severity === "danger").length;
  const peopleCount = items.filter((item) => item.group === "People").length;
  const deliveryCount = items.filter((item) => item.group === "Delivery").length;
  const complianceCount = items.filter((item) => item.group === "Compliance").length;

  async function retryFailedPayslipNotices() {
    setRetryingPayslips(true);
    try {
      const response = await fetch("/api/outbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, mode: "retry-failed-payslips" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(payload.error ?? "Failed payslip notices could not be retried.", "err");
        return;
      }
      notify(payload.message ?? "Failed payslip notices retried.", payload.failed ? "err" : "ok");
      const refreshed = await fetch(`/api/outbox?organizationId=${organizationId}`, { cache: "no-store" });
      if (refreshed.ok) {
        const refreshedPayload = await refreshed.json().catch(() => ({}));
        setOutbox((refreshedPayload.summary ?? null) as OutboxSummary | null);
      }
    } catch {
      notify("The email outbox could not be reached.", "err");
    } finally {
      setRetryingPayslips(false);
    }
  }

  function act(item: AttentionItem) {
    if (item.id === "delivery" || item.id === "delivery-queue") {
      onOpenOutbox();
      return;
    }
    if (item.page) onPage(item.page);
  }

  return (
    <>
      <PageHeading
        eyebrow="OPERATIONS"
        title={items.length ? "Here’s what needs attention." : "Operations are clear."}
        copy="One queue for payroll recovery, employee-data gaps, delivery problems and compliance evidence. Fix the blocker, then return here."
        actions={
          outbox?.failedPayslipReady ? (
            <button
              className="secondary-button"
              disabled={retryingPayslips}
              onClick={() => void retryFailedPayslipNotices()}
            >
              <RefreshCw size={14} />
              {retryingPayslips ? "Retrying…" : `Retry ${outbox.failedPayslipReady} failed payslip notice${outbox.failedPayslipReady === 1 ? "" : "s"}`}
            </button>
          ) : undefined
        }
      />

      <section className="operations-metrics" aria-label="Operations summary">
        <article className="operations-metric">
          <span className={items.length ? "inline-icon amber" : "inline-icon mint"}>
            {items.length ? <ShieldAlert size={18} /> : <BadgeCheck size={18} />}
          </span>
          <div><strong>{items.length}</strong><span>attention areas</span></div>
        </article>
        <article className="operations-metric">
          <span className={criticalCount ? "inline-icon red" : "inline-icon mint"}><AlertTriangle size={18} /></span>
          <div><strong>{criticalCount}</strong><span>critical</span></div>
        </article>
        <article className="operations-metric">
          <span className={deliveryCount ? "inline-icon amber" : "inline-icon mint"}><MailWarning size={18} /></span>
          <div><strong>{loadingExternal ? "…" : deliveryCount}</strong><span>delivery</span></div>
        </article>
        <article className="operations-metric">
          <span className={complianceCount ? "inline-icon amber" : "inline-icon mint"}><FileCheck2 size={18} /></span>
          <div><strong>{loadingExternal ? "…" : complianceCount}</strong><span>compliance</span></div>
        </article>
      </section>

      {items.length === 0 && !loadingExternal ? (
        <article className="card operations-clear">
          <span className="inline-icon mint"><BadgeCheck size={20} /></span>
          <div>
            <h2>No operational blocker is visible.</h2>
            <p>Payroll, people records, delivery state and filing evidence are not reporting an item that needs action right now.</p>
          </div>
        </article>
      ) : (
        <section className="operations-board">
          {(["Payroll", "People", "Delivery", "Compliance"] as const).map((group) => {
            const groupItems = items.filter((item) => item.group === group);
            if (groupItems.length === 0) return null;
            const Icon = group === "Payroll" ? WalletCards : group === "People" ? UsersRound : group === "Delivery" ? MailWarning : FileCheck2;
            return (
              <article className="card operations-group" key={group}>
                <div className="operations-group-head">
                  <span className="inline-icon slate"><Icon size={17} /></span>
                  <div>
                    <div className="card-kicker">{group}</div>
                    <h2>{groupItems.length} item{groupItems.length === 1 ? "" : "s"} to resolve</h2>
                  </div>
                </div>
                <div className="operations-list">
                  {groupItems.map((item) => (
                    <div className="operations-item" data-severity={item.severity} key={item.id}>
                      <span className="operations-severity" aria-hidden />
                      <div className="operations-copy">
                        <div className="operations-title-row">
                          <strong>{item.title}</strong>
                          <Status value={item.severity === "danger" ? "Blocked" : item.severity === "review" ? "Needs review" : "Pending"} />
                        </div>
                        <p>{item.detail}</p>
                      </div>
                      {item.actionLabel && (
                        <button className="secondary-button" onClick={() => act(item)}>
                          {item.actionLabel}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </section>
      )}

      <article className="card operations-shortcuts">
        <div className="card-header">
          <div>
            <div className="card-kicker">TOOLS</div>
            <h2>Go deeper only when you need to.</h2>
            <p>The primary sidebar stays focused. Specialist modules remain available here, under More tools, and in ⌘K search.</p>
          </div>
        </div>
        <div className="operations-shortcut-grid">
          <button onClick={() => onPage("Analytics")}><strong>Reports</strong><span>Payroll and workforce analytics</span></button>
          <button onClick={() => onPage("Exports")}><strong>Exports</strong><span>Bank, accounting and government files</span></button>
          <button onClick={() => onPage("Compliance")}><strong>Compliance</strong><span>Rules and government validation</span></button>
          <button onClick={() => onPage("Audit trail")}><strong>Audit trail</strong><span>Recorded operator actions</span></button>
        </div>
      </article>
    </>
  );
}
